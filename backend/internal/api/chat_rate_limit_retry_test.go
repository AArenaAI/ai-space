package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"io"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type scriptedAIService struct {
	calls int
}

func (s *scriptedAIService) ChatCompletion(ctx context.Context, model string, messages []services.Message, stream bool, reasoning bool, reasoningEffort services.ReasoningEffort, search bool, textFormat map[string]any) (*services.AICompletionResponse, error) {
	s.calls++
	if s.calls == 1 {
		return &services.AICompletionResponse{
			Body:      io.NopCloser(&emptyReader{}),
			Decoder:   &scriptedDecoder{events: []*services.AIStreamEvent{{Type: services.EventError, Message: "rate limited", ErrorKind: string(services.ProviderErrorRateLimit), Code: "rate_limit_exceeded", Recoverable: true, RetryAfterMs: 1000, Provider: "openai", Model: model}}},
			ModelType: "openai_responses",
			Provider:  "openai",
			Model:     model,
		}, nil
	}
	return &services.AICompletionResponse{
		Body: io.NopCloser(&emptyReader{}),
		Decoder: &scriptedDecoder{events: []*services.AIStreamEvent{
			{Type: services.EventTextDelta, Delta: "完整"},
			{Type: services.EventTextDelta, Delta: "答案"},
			{Type: services.EventDone},
		}},
		ModelType: "openai_responses",
		Provider:  "openai",
		Model:     model,
	}, nil
}

func (s *scriptedAIService) RetrieveOpenAIResponse(ctx context.Context, responseID string) (map[string]any, error) {
	return nil, nil
}

type scriptedDecoder struct {
	events []*services.AIStreamEvent
	idx    int
}

func (d *scriptedDecoder) Next() (*services.AIStreamEvent, error) {
	if d.idx >= len(d.events) {
		return nil, io.EOF
	}
	e := d.events[d.idx]
	d.idx++
	return e, nil
}

type emptyReader struct{}

func (r *emptyReader) Read(p []byte) (int, error) { return 0, io.EOF }

func TestRunGenerationTaskRetriesStreamRateLimitAndPersistsCompleteAnswer(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.Conversation{}, &models.Message{}, &models.AIBackgroundTask{}, &models.AIBackgroundTaskEvent{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	conv := models.Conversation{UserID: 1, Title: "retry test", Model: "gpt-5.5"}
	if err := db.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	assistant := models.Message{ConversationID: conv.ID, Role: "assistant", Content: "", Model: "gpt-5.5"}
	if err := db.Create(&assistant).Error; err != nil {
		t.Fatalf("create assistant: %v", err)
	}
	task := models.AIBackgroundTask{ResponseID: "stream:test", UserID: 1, ConversationID: conv.ID, AssistantMessageID: assistant.ID, Model: "gpt-5.5", Provider: "openai", Status: "running"}
	if err := db.Create(&task).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}

	fake := &scriptedAIService{}
	h := NewChatHandler(db, &config.Config{}, fake, nil, nil, nil, nil, nil)

	var sleeps []time.Duration
	origSleep := generationRetrySleep
	generationRetrySleep = func(d time.Duration) { sleeps = append(sleeps, d) }
	defer func() { generationRetrySleep = origSleep }()

	h.runGenerationTask(GenerationTaskRunRequest{
		Task:               &task,
		Messages:           []services.Message{{Role: "user", Content: "test"}},
		Model:              "gpt-5.5",
		UserID:             1,
		ConversationID:     conv.ID,
		AssistantMessageID: assistant.ID,
	})

	if fake.calls != 2 {
		t.Fatalf("expected 2 ChatCompletion calls, got %d", fake.calls)
	}
	if len(sleeps) != 1 || sleeps[0] != time.Minute {
		t.Fatalf("expected one normalized 1m retry sleep, got %#v", sleeps)
	}
	if err := db.First(&assistant, assistant.ID).Error; err != nil {
		t.Fatalf("reload assistant: %v", err)
	}
	if assistant.Content != "完整答案" {
		t.Fatalf("expected complete answer persisted, got %q", assistant.Content)
	}
	if err := db.First(&task, task.ID).Error; err != nil {
		t.Fatalf("reload task: %v", err)
	}
	if task.Status != "completed" || task.Result != "完整答案" {
		t.Fatalf("expected completed task with full result, got status=%q result=%q", task.Status, task.Result)
	}
	var doneCount int64
	if err := db.Model(&models.AIBackgroundTaskEvent{}).Where("task_id = ? AND event_type = ?", task.ID, "done").Count(&doneCount).Error; err != nil {
		t.Fatalf("count done events: %v", err)
	}
	if doneCount != 1 {
		t.Fatalf("expected exactly one done event after final DB write, got %d", doneCount)
	}
}
