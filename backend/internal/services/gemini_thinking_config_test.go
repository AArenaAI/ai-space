package services

import (
	"testing"

	"google.golang.org/genai"
)

func TestGemini25UsesThinkingBudgetNotThinkingLevel(t *testing.T) {
	cfg := geminiThinkingConfigForModel("gemini-2.5-pro", ReasoningEffortMedium)
	if cfg == nil {
		t.Fatal("thinking config is nil")
	}
	if cfg.ThinkingBudget == nil {
		t.Fatal("Gemini 2.5 should use thinkingBudget")
	}
	if got := *cfg.ThinkingBudget; got != -1 {
		t.Fatalf("thinkingBudget = %d, want -1 dynamic thinking", got)
	}
	if cfg.ThinkingLevel != "" {
		t.Fatalf("Gemini 2.5 should not set thinkingLevel, got %q", cfg.ThinkingLevel)
	}
	if !cfg.IncludeThoughts {
		t.Fatal("IncludeThoughts should stay enabled")
	}
}

func TestGemini3UsesThinkingLevelNotThinkingBudget(t *testing.T) {
	cfg := geminiThinkingConfigForModel("gemini-3.1-pro-preview", ReasoningEffortHigh)
	if cfg == nil {
		t.Fatal("thinking config is nil")
	}
	if cfg.ThinkingBudget != nil {
		t.Fatalf("Gemini 3 should not set thinkingBudget, got %d", *cfg.ThinkingBudget)
	}
	if cfg.ThinkingLevel != genai.ThinkingLevelHigh {
		t.Fatalf("thinkingLevel = %q, want high", cfg.ThinkingLevel)
	}
	if !cfg.IncludeThoughts {
		t.Fatal("IncludeThoughts should stay enabled")
	}
}

func TestGemini25BudgetMappingAvoidsUnsupportedZeroForPro(t *testing.T) {
	if got := ReasoningEffortLow.ToGemini25ThinkingBudget(); got != 1024 {
		t.Fatalf("low budget = %d, want 1024", got)
	}
	if got := ReasoningEffortMedium.ToGemini25ThinkingBudget(); got != -1 {
		t.Fatalf("medium budget = %d, want -1", got)
	}
	if got := ReasoningEffortHigh.ToGemini25ThinkingBudget(); got != 32768 {
		t.Fatalf("high budget = %d, want 32768", got)
	}
	if got := ParseReasoningEffort("1024").ToGemini25ThinkingBudget(); got != 1024 {
		t.Fatalf("numeric budget = %d, want 1024", got)
	}
	if got := ParseReasoningEffort("-1").ToGemini25ThinkingBudget(); got != -1 {
		t.Fatalf("dynamic budget = %d, want -1", got)
	}
}
