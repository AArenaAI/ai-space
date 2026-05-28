package api

import (
	"aipool-backend/internal/services"
	"context"
	"time"
)

type chatAIService interface {
	ChatCompletion(ctx context.Context, model string, messages []services.Message, stream bool, reasoning bool, reasoningEffort services.ReasoningEffort, search bool, textFormat map[string]any) (*services.AICompletionResponse, error)
	RetrieveOpenAIResponse(ctx context.Context, responseID string) (map[string]any, error)
}

var generationRetrySleep = func(d time.Duration) {
	time.Sleep(d)
}
