package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

type openAIModelLimiter struct {
	sem chan struct{}

	mu      sync.Mutex
	records []tokenBudgetRecord
}

type tokenBudgetRecord struct {
	at     time.Time
	tokens int
}

var (
	openAILimitersMu sync.Mutex
	openAILimiters   = map[string]*openAIModelLimiter{}
)

func openAIModelLimiterFor(model string, maxConcurrency int) *openAIModelLimiter {
	if maxConcurrency <= 0 {
		maxConcurrency = 1
	}
	key := strings.ToLower(strings.TrimSpace(model))
	openAILimitersMu.Lock()
	defer openAILimitersMu.Unlock()
	limiter := openAILimiters[key]
	if limiter == nil || cap(limiter.sem) != maxConcurrency {
		limiter = &openAIModelLimiter{sem: make(chan struct{}, maxConcurrency)}
		openAILimiters[key] = limiter
	}
	return limiter
}

func (l *openAIModelLimiter) acquire(ctx context.Context) (func(), error) {
	select {
	case l.sem <- struct{}{}:
		var once sync.Once
		return func() { once.Do(func() { <-l.sem }) }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (l *openAIModelLimiter) reserveTPM(model string, requestedTokens int, softLimit int) *ProviderError {
	if l == nil || softLimit <= 0 || requestedTokens <= 0 {
		return nil
	}
	now := time.Now()
	windowStart := now.Add(-time.Minute)

	l.mu.Lock()
	defer l.mu.Unlock()

	kept := l.records[:0]
	used := 0
	oldest := now
	for _, r := range l.records {
		if r.at.After(windowStart) {
			kept = append(kept, r)
			used += r.tokens
			if r.at.Before(oldest) {
				oldest = r.at
			}
		}
	}
	l.records = kept

	if requestedTokens > softLimit || used+requestedTokens > softLimit {
		retryMs := 15000
		if len(l.records) > 0 {
			until := oldest.Add(time.Minute).Sub(now)
			if until > 0 {
				retryMs = int(until.Milliseconds())
			}
		}
		return &ProviderError{
			Provider:         "openai",
			Model:            model,
			Kind:             ProviderErrorRateLimit,
			Code:             "local_tpm_budget_exceeded",
			Type:             "tokens",
			Message:          fmt.Sprintf("本地 TPM 预算不足：limit=%d used=%d requested=%d", softLimit, used, requestedTokens),
			RetryAfterMs:     retryMs,
			LimitTokens:      softLimit,
			UsedTokens:       used,
			RequestedTokens:  requestedTokens,
			LimitType:        "tokens_per_minute",
			SuggestedActions: []string{"retry_after", "switch_model", "reduce_output_tokens"},
		}
	}

	l.records = append(l.records, tokenBudgetRecord{at: now, tokens: requestedTokens})
	return nil
}

func isGPT55Pro(model string) bool {
	model = strings.ToLower(strings.TrimSpace(model))
	return model == "gpt-5.5-pro" || strings.HasPrefix(model, "gpt-5.5-pro-")
}

func estimateOpenAIRequestedTokens(messages []Message, maxOutputTokens int) int {
	chars := 0
	for _, msg := range messages {
		chars += len([]rune(msg.Role)) + len([]rune(msg.Content))
		for _, img := range msg.Images {
			chars += len([]rune(img)) / 16
		}
	}
	inputTokens := chars / 4
	if chars > 0 && inputTokens == 0 {
		inputTokens = 1
	}
	return inputTokens + maxOutputTokens
}

func maxOutputTokensFromBody(reqBody map[string]any) int {
	if reqBody == nil {
		return 0
	}
	switch v := reqBody["max_output_tokens"].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	default:
		return 0
	}
}
