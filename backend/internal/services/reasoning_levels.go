package services

import (
	"strconv"
	"strings"
)

// Public reasoning levels exposed to the product/admin UI. Keep these stable even
// when provider-specific parameters differ.
const (
	ReasoningLevelOff      = "off"
	ReasoningLevelFast     = "fast"
	ReasoningLevelThinking = "thinking"
	ReasoningLevelExpert   = "expert"
)

func NormalizeReasoningLevel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "off", "none", "disabled", "disable", "false":
		return ReasoningLevelOff
	case "fast", "quick", "low", "light", "minimal":
		return ReasoningLevelFast
	case "expert", "deep", "high", "heavy", "max", "xhigh":
		return ReasoningLevelExpert
	case "thinking", "standard", "medium", "":
		return ReasoningLevelThinking
	default:
		return ReasoningLevelThinking
	}
}

func ReasoningLevelName(level string) string {
	switch NormalizeReasoningLevel(level) {
	case ReasoningLevelOff:
		return "关闭"
	case ReasoningLevelFast:
		return "快速"
	case ReasoningLevelExpert:
		return "专家"
	default:
		return "思考"
	}
}

// ReasoningEffortForPublicLevel maps the three product-facing levels onto the
// internal provider-agnostic effort enum. Provider adapters then convert the
// effort into OpenAI/Gemini/DeepSeek-specific fields.
func ReasoningEffortForPublicLevel(level string) ReasoningEffort {
	switch NormalizeReasoningLevel(level) {
	case ReasoningLevelOff:
		return ReasoningEffortOff
	case ReasoningLevelFast:
		return ReasoningEffortLow
	case ReasoningLevelExpert:
		return ReasoningEffortHigh
	default:
		return ReasoningEffortMedium
	}
}

// ReasoningEffortOverrides holds per-model custom mappings from the three public
// levels to provider-specific effort strings. Empty values fall back to the
// default ReasoningEffortForPublicLevel mapping.
type ReasoningEffortOverrides struct {
	Fast    string
	Thinking string
	Expert  string
}

// ReasoningEffortForPublicLevelWithOverrides returns the effort for a public
// level, using custom overrides when present. If the override is empty or
// invalid, it falls back to the default mapping.
func ReasoningEffortForPublicLevelWithOverrides(level string, overrides ReasoningEffortOverrides) ReasoningEffort {
	var overrideValue string
	switch NormalizeReasoningLevel(level) {
	case ReasoningLevelOff:
		overrideValue = ReasoningEffortOff.String()
	case ReasoningLevelFast:
		overrideValue = strings.TrimSpace(overrides.Fast)
	case ReasoningLevelExpert:
		overrideValue = strings.TrimSpace(overrides.Expert)
	default:
		overrideValue = strings.TrimSpace(overrides.Thinking)
	}
	if overrideValue != "" {
		// Try to parse the override as a known effort value.
		if effort := ParseReasoningEffort(overrideValue); effort != ReasoningEffortMedium || overrideValue == "medium" || overrideValue == "standard" {
			return effort
		}
		// If it's not a known effort, pass it through as-is by parsing.
		// ParseReasoningEffort handles common aliases and returns Medium for unknowns.
		return ParseReasoningEffort(overrideValue)
	}
	return ReasoningEffortForPublicLevel(level)
}

func DefaultReasoningOverrideValuesForModel(model string) (fast string, thinking string, expert string) {
	model = strings.ToLower(strings.TrimSpace(model))
	if strings.HasPrefix(model, "gemini-2.5-") {
		return strconv.Itoa(int(ReasoningEffortLow.ToGemini25ThinkingBudget())), strconv.Itoa(int(ReasoningEffortMedium.ToGemini25ThinkingBudget())), strconv.Itoa(int(ReasoningEffortHigh.ToGemini25ThinkingBudget()))
	}
	if strings.HasPrefix(model, "gemini-") {
		return ReasoningEffortLow.String(), ReasoningEffortMedium.String(), ReasoningEffortHigh.String()
	}
	if strings.HasPrefix(model, "deepseek-") {
		return ReasoningEffortOff.String(), ReasoningEffortHigh.ToDeepSeekValue(), ReasoningEffortMax.ToDeepSeekValue()
	}
	if strings.HasPrefix(model, "gpt-5") {
		return ReasoningEffortLow.ToOpenAIValue(), ReasoningEffortMedium.ToOpenAIValue(), ReasoningEffortHigh.ToOpenAIValue()
	}
	return ReasoningEffortForPublicLevel(ReasoningLevelFast).String(), ReasoningEffortForPublicLevel(ReasoningLevelThinking).String(), ReasoningEffortForPublicLevel(ReasoningLevelExpert).String()
}

func EffectiveReasoningOverrideValuesForModel(model string, overrides ReasoningEffortOverrides) (fast string, thinking string, expert string) {
	fast, thinking, expert = DefaultReasoningOverrideValuesForModel(model)
	if v := strings.TrimSpace(overrides.Fast); v != "" {
		fast = v
	}
	if v := strings.TrimSpace(overrides.Thinking); v != "" {
		thinking = v
	}
	if v := strings.TrimSpace(overrides.Expert); v != "" {
		expert = v
	}
	return fast, thinking, expert
}

func ReasoningParameterName(model string) string {
	model = strings.ToLower(strings.TrimSpace(model))
	switch {
	case strings.HasPrefix(model, "gpt-5"):
		return "reasoning.effort"
	case strings.HasPrefix(model, "gemini-2.5-"):
		return "thinking_config.thinking_budget"
	case strings.HasPrefix(model, "gemini-"):
		return "thinking_config.thinking_level"
	case strings.HasPrefix(model, "deepseek-"):
		return "reasoning_effort"
	default:
		return "provider_default"
	}
}
