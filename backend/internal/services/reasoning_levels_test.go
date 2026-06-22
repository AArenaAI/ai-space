package services

import "testing"

func TestDeepSeekDefaultReasoningOverrides(t *testing.T) {
	fast, thinking, expert := DefaultReasoningOverrideValuesForModel("deepseek-v4-pro")
	if fast != "off" || thinking != "high" || expert != "max" {
		t.Fatalf("deepseek defaults = %q/%q/%q, want off/high/max", fast, thinking, expert)
	}
}

func TestReasoningOverrideOff(t *testing.T) {
	if got := NormalizeReasoningLevel("off"); got != ReasoningLevelOff {
		t.Fatalf("NormalizeReasoningLevel(off) = %q, want off", got)
	}
	if got := ReasoningEffortForPublicLevel("off"); got != ReasoningEffortOff {
		t.Fatalf("ReasoningEffortForPublicLevel(off) = %q, want off", got)
	}
	effort := ReasoningEffortForPublicLevelWithOverrides(ReasoningLevelFast, ReasoningEffortOverrides{Fast: "off"})
	if effort != ReasoningEffortOff {
		t.Fatalf("fast override off parsed as %q", effort)
	}
	if got := effort.ToDeepSeekValue(); got != "" {
		t.Fatalf("off ToDeepSeekValue = %q, want empty", got)
	}
}
