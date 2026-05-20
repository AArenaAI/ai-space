package services

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

type ProviderErrorKind string

const (
	ProviderErrorRateLimit ProviderErrorKind = "rate_limit"
	ProviderErrorQuota     ProviderErrorKind = "quota"
	ProviderErrorUpstream  ProviderErrorKind = "upstream_error"
)

type ProviderError struct {
	Provider          string
	Model             string
	Kind              ProviderErrorKind
	Code              string
	Type              string
	Message           string
	RetryAfterMs      int
	LimitTokens       int
	UsedTokens        int
	RequestedTokens   int
	LimitType         string
	SuggestedActions  []string
	OriginalErrorText string
}

func (e *ProviderError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return e.Message
	}
	return string(e.Kind)
}

func (e *ProviderError) Retriable() bool {
	return e != nil && e.Kind == ProviderErrorRateLimit
}

func (e *ProviderError) RetryAfterSeconds() float64 {
	if e == nil || e.RetryAfterMs <= 0 {
		return 0
	}
	return float64(e.RetryAfterMs) / 1000
}

func (e *ProviderError) UserMessage() string {
	if e == nil {
		return "上游模型暂时不可用。"
	}
	modelName := e.Model
	if modelName == "" {
		modelName = "OpenAI 模型"
	}
	switch e.Kind {
	case ProviderErrorRateLimit:
		wait := "稍后"
		if e.RetryAfterMs > 0 {
			seconds := (e.RetryAfterMs + 999) / 1000
			wait = fmt.Sprintf("约 %d 秒后", seconds)
		}
		return fmt.Sprintf("%s 当前达到官方速率限制，建议等待%s重试，或切换 GPT-5.5。", modelName, wait)
	case ProviderErrorQuota:
		return "OpenAI 项目额度或预算不足，请检查 API 余额、项目预算或 usage limit。"
	default:
		if strings.TrimSpace(e.Message) != "" {
			return e.Message
		}
		return "OpenAI 上游暂时不可用，请稍后重试。"
	}
}

func (e *ProviderError) ToMeta() map[string]any {
	if e == nil {
		return nil
	}
	category := string(e.Kind)
	if e.Kind == ProviderErrorRateLimit {
		category = "rate_limit"
	}
	meta := map[string]any{
		"type":              "_error_meta",
		"provider":          e.Provider,
		"model":             e.Model,
		"category":          category,
		"code":              e.Code,
		"limit_type":        e.LimitType,
		"limit":             e.LimitTokens,
		"used":              e.UsedTokens,
		"requested":         e.RequestedTokens,
		"retry_after_ms":    e.RetryAfterMs,
		"retry_after_seconds": e.RetryAfterSeconds(),
		"retriable":         e.Retriable(),
		"user_message":      e.UserMessage(),
		"suggested_actions": e.SuggestedActions,
	}
	return meta
}

func providerErrorToStreamEvent(e *ProviderError) *AIStreamEvent {
	if e == nil {
		return nil
	}
	return &AIStreamEvent{
		Type:              EventError,
		Code:              e.Code,
		Message:           e.UserMessage(),
		ErrorKind:         string(e.Kind),
		Recoverable:       e.Retriable(),
		RetryAfterMs:      e.RetryAfterMs,
		Provider:          e.Provider,
		Model:             e.Model,
		LimitType:         e.LimitType,
		LimitTokens:       e.LimitTokens,
		UsedTokens:        e.UsedTokens,
		RequestedTokens:   e.RequestedTokens,
		SuggestedActions:  e.SuggestedActions,
	}
}

func ParseOpenAIProviderError(err error, model string) *ProviderError {
	if err == nil {
		return nil
	}
	return ParseOpenAIProviderErrorText(err.Error(), model)
}

func ParseOpenAIProviderErrorText(text string, model string) *ProviderError {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}

	pe := &ProviderError{Provider: "openai", Model: model, Kind: ProviderErrorUpstream, OriginalErrorText: text}
	if errObj := extractOpenAIErrorObject(text); errObj != nil {
		if msg, ok := errObj["message"].(string); ok {
			pe.Message = msg
		}
		if code, ok := errObj["code"].(string); ok {
			pe.Code = code
		}
		if typ, ok := errObj["type"].(string); ok {
			pe.Type = typ
		}
	} else {
		pe.Message = text
	}

	lower := strings.ToLower(text + " " + pe.Code + " " + pe.Type + " " + pe.Message)
	switch {
	case strings.Contains(lower, "insufficient_quota") || strings.Contains(lower, "quota") || strings.Contains(lower, "billing"):
		pe.Kind = ProviderErrorQuota
		if pe.Code == "" {
			pe.Code = "insufficient_quota"
		}
		pe.SuggestedActions = []string{"check_billing", "increase_budget"}
	case strings.Contains(lower, "rate_limit_exceeded") || strings.Contains(lower, "rate limit") || strings.Contains(lower, "tokens per min") || strings.Contains(lower, "requests per min") || pe.Type == "tokens" || pe.Type == "requests":
		pe.Kind = ProviderErrorRateLimit
		if pe.Code == "" {
			pe.Code = "rate_limit_exceeded"
		}
		pe.SuggestedActions = []string{"retry_after", "switch_model", "reduce_output_tokens"}
	default:
		if pe.Code == "" {
			pe.Code = "upstream_error"
		}
	}

	pe.RetryAfterMs = parseRetryAfterMs(text)
	pe.LimitTokens, pe.UsedTokens, pe.RequestedTokens = parseOpenAITokenLimitNumbers(text)
	if strings.Contains(lower, "tokens per min") || pe.Type == "tokens" || pe.RequestedTokens > 0 {
		pe.LimitType = "tokens_per_minute"
	} else if strings.Contains(lower, "requests per min") || pe.Type == "requests" {
		pe.LimitType = "requests_per_minute"
	}

	if pe.Kind == ProviderErrorUpstream && pe.Code == "upstream_error" && !strings.Contains(lower, "429") {
		return nil
	}
	return pe
}

func extractOpenAIErrorObject(text string) map[string]any {
	var outer map[string]any
	if err := json.Unmarshal([]byte(text), &outer); err == nil {
		if errObj, ok := outer["error"].(map[string]any); ok {
			return errObj
		}
		if _, hasMsg := outer["message"]; hasMsg {
			return outer
		}
	}

	for start := 0; start < len(text); start++ {
		if text[start] != '{' {
			continue
		}
		for end := len(text); end > start; end-- {
			candidate := text[start:end]
			var decoded map[string]any
			if err := json.Unmarshal([]byte(candidate), &decoded); err == nil {
				if errObj, ok := decoded["error"].(map[string]any); ok {
					return errObj
				}
				if _, hasMsg := decoded["message"]; hasMsg {
					return decoded
				}
			}
		}
	}
	return nil
}

func parseRetryAfterMs(text string) int {
	patterns := []string{
		`(?i)try again in\s+([0-9]+(?:\.[0-9]+)?)s`,
		`(?i)retry after\s+([0-9]+(?:\.[0-9]+)?)s`,
		`(?i)retry-after[:=]\s*([0-9]+(?:\.[0-9]+)?)`,
	}
	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		m := re.FindStringSubmatch(text)
		if len(m) < 2 {
			continue
		}
		v, err := strconv.ParseFloat(m[1], 64)
		if err == nil && v > 0 {
			return int(v*1000 + 0.5)
		}
	}
	return 0
}

func parseOpenAITokenLimitNumbers(text string) (limit int, used int, requested int) {
	re := regexp.MustCompile(`(?i)Limit\s+([0-9]+),\s*Used\s+([0-9]+),\s*Requested\s+([0-9]+)`) 
	m := re.FindStringSubmatch(text)
	if len(m) == 4 {
		limit, _ = strconv.Atoi(m[1])
		used, _ = strconv.Atoi(m[2])
		requested, _ = strconv.Atoi(m[3])
	}
	return
}
