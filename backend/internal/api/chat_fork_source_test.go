package api

import (
	"testing"
	"time"

	"aipool-backend/internal/models"
)

func TestFindForkUserMessageBeforeAssistantFallsBackToIDWhenTimestampsMatch(t *testing.T) {
	at := time.Date(2026, 6, 11, 12, 0, 0, 0, time.UTC)
	source := models.Message{ID: 11, ConversationID: 7, Role: "assistant", CreatedAt: at}
	messages := []models.Message{
		{ID: 10, ConversationID: 7, Role: "user", Content: "prompt", CreatedAt: at},
	}

	userMsg, ok := findForkUserMessage(source, messages)
	if !ok {
		t.Fatalf("expected matching user message when timestamp ties but id is before assistant")
	}
	if userMsg.ID != 10 {
		t.Fatalf("expected user message id 10, got %d", userMsg.ID)
	}
}

func TestFindForkUserMessageIgnoresLaterMessagesWithSameTimestamp(t *testing.T) {
	at := time.Date(2026, 6, 11, 12, 0, 0, 0, time.UTC)
	source := models.Message{ID: 11, ConversationID: 7, Role: "assistant", CreatedAt: at}
	messages := []models.Message{
		{ID: 12, ConversationID: 7, Role: "user", Content: "later", CreatedAt: at},
		{ID: 9, ConversationID: 7, Role: "user", Content: "previous", CreatedAt: at.Add(-time.Second)},
	}

	userMsg, ok := findForkUserMessage(source, messages)
	if !ok {
		t.Fatalf("expected previous user message")
	}
	if userMsg.ID != 9 {
		t.Fatalf("expected earlier user message id 9, got %d", userMsg.ID)
	}
}

func TestFindForkUserMessageReturnsSourceForUserMessage(t *testing.T) {
	source := models.Message{ID: 5, ConversationID: 7, Role: "user", Content: "prompt", CreatedAt: time.Now()}
	userMsg, ok := findForkUserMessage(source, nil)
	if !ok || userMsg.ID != source.ID {
		t.Fatalf("expected source user message, got %#v ok=%v", userMsg, ok)
	}
}
