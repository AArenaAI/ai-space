package api

import (
	"strings"
	"testing"
	"time"

	"aipool-backend/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupChatFailureSmokeTest(t *testing.T) (*ChatHandler, *gorm.DB, models.Conversation) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite memory db: %v", err)
	}
	if err := db.AutoMigrate(&models.Conversation{}, &models.Message{}, &models.AIBackgroundTask{}, &models.AIBackgroundTaskEvent{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	conv := models.Conversation{Title: "smoke", Model: "gpt-5.5", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	return &ChatHandler{db: db}, db, conv
}

func TestFailGenerationTaskPreservesStreamedContentOnRateLimit(t *testing.T) {
	h, db, conv := setupChatFailureSmokeTest(t)
	existing := "已有长回答：评测维度、数学、代码、推理、指令遵循……"
	assistant := models.Message{ConversationID: conv.ID, Role: "assistant", Model: "gpt-5.5", Content: existing, CreatedAt: time.Now()}
	if err := db.Create(&assistant).Error; err != nil {
		t.Fatalf("create assistant: %v", err)
	}
	task := models.AIBackgroundTask{ResponseID: "resp_smoke_rate_limit", ConversationID: conv.ID, AssistantMessageID: assistant.ID, Model: "gpt-5.5", Status: "streaming", Result: existing, LastSequenceNumber: 1647, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&task).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}

	rateLimitMessage := "gpt-5.5 当前达到官方速率限制，建议等待约 4 秒后重试，或切换 GPT-5.5。"
	h.failGenerationTaskWithMeta(&task, assistant.ID, conv.ID, rateLimitMessage, "rate_limit_exceeded", map[string]interface{}{"category": "rate_limit"})

	var got models.Message
	if err := db.First(&got, assistant.ID).Error; err != nil {
		t.Fatalf("load assistant: %v", err)
	}
	if got.Content != existing {
		t.Fatalf("streamed content should be preserved\nwant: %q\n got: %q", existing, got.Content)
	}
	var gotTask models.AIBackgroundTask
	if err := db.First(&gotTask, task.ID).Error; err != nil {
		t.Fatalf("load task: %v", err)
	}
	if gotTask.Result != existing {
		t.Fatalf("task result should preserve streamed content\nwant: %q\n got: %q", existing, gotTask.Result)
	}
	if gotTask.ErrorMessage != rateLimitMessage || gotTask.Status != "failed" {
		t.Fatalf("task should keep failed status and error message, status=%q error=%q", gotTask.Status, gotTask.ErrorMessage)
	}
	var events []models.AIBackgroundTaskEvent
	if err := db.Where("assistant_message_id = ?", assistant.ID).Order("sequence_number asc").Find(&events).Error; err != nil {
		t.Fatalf("load events: %v", err)
	}
	if len(events) != 2 || events[0].EventType != "error" || events[1].EventType != "done" || events[1].Payload != "[DONE]" {
		t.Fatalf("expected error event followed by DONE, got %#v", events)
	}
	if !strings.Contains(events[0].Payload, "_error_meta") {
		t.Fatalf("expected error meta payload, got %q", events[0].Payload)
	}
}

func TestRateLimitRetryDelayHasOneMinuteMinimum(t *testing.T) {
	cases := []struct {
		name   string
		waitMs int
		want   time.Duration
	}{
		{name: "no retry after", waitMs: 0, want: time.Minute},
		{name: "short retry after", waitMs: 1234, want: time.Minute},
		{name: "local tpm default", waitMs: 15000, want: time.Minute},
		{name: "long retry after", waitMs: 90000, want: 90 * time.Second},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := rateLimitRetryDelay(tc.waitMs); got != tc.want {
				t.Fatalf("rateLimitRetryDelay(%d)=%v, want %v", tc.waitMs, got, tc.want)
			}
		})
	}
}

func TestFailGenerationTaskUsesErrorMessageWhenNoStreamedContent(t *testing.T) {
	h, db, conv := setupChatFailureSmokeTest(t)
	assistant := models.Message{ConversationID: conv.ID, Role: "assistant", Model: "gpt-5.5", Content: "", CreatedAt: time.Now()}
	if err := db.Create(&assistant).Error; err != nil {
		t.Fatalf("create assistant: %v", err)
	}
	task := models.AIBackgroundTask{ResponseID: "resp_smoke_rate_limit_empty", ConversationID: conv.ID, AssistantMessageID: assistant.ID, Model: "gpt-5.5", Status: "streaming", LastSequenceNumber: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&task).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}

	rateLimitMessage := "gpt-5.5 当前达到官方速率限制，建议等待约 4 秒后重试，或切换 GPT-5.5。"
	h.failGenerationTaskWithMeta(&task, assistant.ID, conv.ID, rateLimitMessage, "rate_limit_exceeded", map[string]interface{}{"category": "rate_limit"})

	var got models.Message
	if err := db.First(&got, assistant.ID).Error; err != nil {
		t.Fatalf("load assistant: %v", err)
	}
	if got.Content != rateLimitMessage {
		t.Fatalf("empty streamed content should fall back to error message\nwant: %q\n got: %q", rateLimitMessage, got.Content)
	}
}
