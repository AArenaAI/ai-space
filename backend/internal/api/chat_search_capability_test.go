package api

import (
	"testing"

	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/services"
)

func TestPreprocessSearchUsesNativeToolOnlyForSearchCapableModels(t *testing.T) {
	h := &ChatHandler{}
	messages := []services.Message{{Role: "user", Content: "今天有什么新闻"}}

	processed, sources, useSearchTool := h.preprocessSearch(messages, "gpt-5.4-mini", true, "127.0.0.1")
	if !useSearchTool {
		t.Fatalf("search-capable OpenAI model should use native search tool")
	}
	if len(sources) != 0 {
		t.Fatalf("native search tool path should not have preprocessed sources, got %d", len(sources))
	}
	if len(processed) != len(messages) || processed[0].Content != messages[0].Content {
		t.Fatalf("native search path should not mutate messages, got %#v", processed)
	}
}

func TestPreprocessSearchDoesNotPassNativeSearchToUnsupportedModel(t *testing.T) {
	h := &ChatHandler{}
	messages := []services.Message{{Role: "user", Content: "今天有什么新闻"}}

	processed, sources, useSearchTool := h.preprocessSearch(messages, "deepseek-v4-pro", true, "127.0.0.1")
	if useSearchTool {
		t.Fatalf("DeepSeek does not advertise search capability and must not receive native search=true")
	}
	if len(sources) != 0 {
		t.Fatalf("nil search service fallback should not produce sources, got %d", len(sources))
	}
	if len(processed) != len(messages) || processed[0].Content != messages[0].Content {
		t.Fatalf("without fallback search service, messages should remain unchanged, got %#v", processed)
	}
}

func TestSearchCapabilityMetadataMatchesProviderGate(t *testing.T) {
	if !modelmeta.SupportsSearch("gpt-5.4-mini") {
		t.Fatalf("gpt-5.4-mini should advertise search capability")
	}
	if modelmeta.SupportsSearch("deepseek-v4-pro") {
		t.Fatalf("deepseek-v4-pro should not advertise native search capability")
	}
}
