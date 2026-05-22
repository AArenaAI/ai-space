package services

import (
	"strings"

	"google.golang.org/genai"
)

// ReasoningEffort 是统一的思考强度等级。
// 各 Provider 的具体值通过 ToXxx 方法映射，业务层只需使用这个统一类型。
type ReasoningEffort string

const (
	ReasoningEffortMinimal ReasoningEffort = "minimal"
	ReasoningEffortLow     ReasoningEffort = "low"
	ReasoningEffortMedium  ReasoningEffort = "medium"
	ReasoningEffortHigh    ReasoningEffort = "high"
	ReasoningEffortMax     ReasoningEffort = "max"
)

// ParseReasoningEffort 从字符串解析为统一的思考强度等级。
// 支持的输入值包括：minimal / light / low / standard / medium / extended / high / heavy / max / xhigh。
// 空字符串或无效值默认返回 Medium。
func ParseReasoningEffort(s string) ReasoningEffort {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "minimal":
		return ReasoningEffortMinimal
	case "light", "low":
		return ReasoningEffortLow
	case "standard", "medium":
		return ReasoningEffortMedium
	case "extended", "high":
		return ReasoningEffortHigh
	case "heavy", "max", "xhigh":
		return ReasoningEffortMax
	default:
		return ReasoningEffortMedium
	}
}

// String 返回统一的字符串表示。
func (e ReasoningEffort) String() string {
	return string(e)
}

// ToOpenAIValue 返回 OpenAI Responses API 的 reasoning.effort 值。
// OpenAI 支持: low / medium / high / xhigh
// minimal 映射为 low，max 映射为 xhigh。
func (e ReasoningEffort) ToOpenAIValue() string {
	switch e {
	case ReasoningEffortMinimal, ReasoningEffortLow:
		return "low"
	case ReasoningEffortHigh:
		return "high"
	case ReasoningEffortMax:
		return "xhigh"
	default:
		return "medium"
	}
}

// ToDeepSeekValue 返回 DeepSeek API 的 reasoning_effort 值。
// DeepSeek 只支持两档: high 和 max。
// 兼容性映射: low / medium → high，xhigh → max。
func (e ReasoningEffort) ToDeepSeekValue() string {
	switch e {
	case ReasoningEffortMax:
		return "max"
	default:
		// minimal / low / medium / high 全部映射为 high
		return "high"
	}
}

// ToGeminiValue 返回 Gemini SDK 的 ThinkingLevel。
func (e ReasoningEffort) ToGeminiValue() genai.ThinkingLevel {
	switch e {
	case ReasoningEffortMinimal:
		return genai.ThinkingLevelMinimal
	case ReasoningEffortLow:
		return genai.ThinkingLevelLow
	case ReasoningEffortHigh, ReasoningEffortMax:
		return genai.ThinkingLevelHigh
	default:
		return genai.ThinkingLevelMedium
	}
}
