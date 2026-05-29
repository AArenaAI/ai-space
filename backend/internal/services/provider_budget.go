package services

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

type ProviderBudgetPolicy struct {
	Provider       string
	Model          string
	MaxConcurrency int
	TPMSoftLimit   int
	RPMSoftLimit   int
}

type providerBudgetLimiter struct {
	sem chan struct{}

	mu      sync.Mutex
	tokens  []tokenBudgetRecord
	requests []time.Time
}

type providerBudgetKey struct {
	provider string
	model    string
}

var (
	providerBudgetMu       sync.Mutex
	providerBudgetLimiters = map[providerBudgetKey]*providerBudgetLimiter{}
)

func providerBudgetLimiterFor(provider string, model string, maxConcurrency int) *providerBudgetLimiter {
	key := providerBudgetKey{provider: strings.ToLower(strings.TrimSpace(provider)), model: strings.ToLower(strings.TrimSpace(model))}
	providerBudgetMu.Lock()
	defer providerBudgetMu.Unlock()
	limiter := providerBudgetLimiters[key]
	if maxConcurrency <= 0 {
		maxConcurrency = 0
	}
	if limiter == nil || cap(limiter.sem) != maxConcurrency {
		var sem chan struct{}
		if maxConcurrency > 0 {
			sem = make(chan struct{}, maxConcurrency)
		}
		limiter = &providerBudgetLimiter{sem: sem}
		providerBudgetLimiters[key] = limiter
	}
	return limiter
}

func (l *providerBudgetLimiter) acquire(ctx context.Context) (func(), error) {
	if l == nil || l.sem == nil {
		return func() {}, nil
	}
	select {
	case l.sem <- struct{}{}:
		var once sync.Once
		return func() { once.Do(func() { <-l.sem }) }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (l *providerBudgetLimiter) reserve(provider string, model string, requestedTokens int, policy ProviderBudgetPolicy) *ProviderError {
	if l == nil || (policy.TPMSoftLimit <= 0 && policy.RPMSoftLimit <= 0) {
		return nil
	}
	now := time.Now()
	windowStart := now.Add(-time.Minute)

	l.mu.Lock()
	defer l.mu.Unlock()

	var tokenUsed int
	var oldestToken time.Time
	if policy.TPMSoftLimit > 0 {
		kept := l.tokens[:0]
		for _, r := range l.tokens {
			if r.at.After(windowStart) {
				kept = append(kept, r)
				tokenUsed += r.tokens
				if oldestToken.IsZero() || r.at.Before(oldestToken) {
					oldestToken = r.at
				}
			}
		}
		l.tokens = kept
		if requestedTokens > 0 && (requestedTokens > policy.TPMSoftLimit || tokenUsed+requestedTokens > policy.TPMSoftLimit) {
			retryMs := budgetRetryMs(now, oldestToken)
			return &ProviderError{
				Provider:         provider,
				Model:            model,
				Kind:             ProviderErrorRateLimit,
				Code:             "local_tpm_budget_exceeded",
				Type:             "tokens",
				Message:          fmt.Sprintf("本地 TPM 预算不足：provider=%s model=%s limit=%d used=%d requested=%d", provider, model, policy.TPMSoftLimit, tokenUsed, requestedTokens),
				RetryAfterMs:     retryMs,
				LimitTokens:      policy.TPMSoftLimit,
				UsedTokens:       tokenUsed,
				RequestedTokens:  requestedTokens,
				LimitType:        "tokens_per_minute",
				SuggestedActions: []string{"retry_after", "switch_model", "reduce_output_tokens"},
			}
		}
	}

	if policy.RPMSoftLimit > 0 {
		kept := l.requests[:0]
		var oldestReq time.Time
		for _, at := range l.requests {
			if at.After(windowStart) {
				kept = append(kept, at)
				if oldestReq.IsZero() || at.Before(oldestReq) {
					oldestReq = at
				}
			}
		}
		l.requests = kept
		if len(l.requests)+1 > policy.RPMSoftLimit {
			retryMs := budgetRetryMs(now, oldestReq)
			return &ProviderError{
				Provider:         provider,
				Model:            model,
				Kind:             ProviderErrorRateLimit,
				Code:             "local_rpm_budget_exceeded",
				Type:             "requests",
				Message:          fmt.Sprintf("本地 RPM 预算不足：provider=%s model=%s limit=%d used=%d requested=1", provider, model, policy.RPMSoftLimit, len(l.requests)),
				RetryAfterMs:     retryMs,
				LimitType:        "requests_per_minute",
				SuggestedActions: []string{"retry_after", "switch_model"},
			}
		}
	}

	if policy.TPMSoftLimit > 0 && requestedTokens > 0 {
		l.tokens = append(l.tokens, tokenBudgetRecord{at: now, tokens: requestedTokens})
	}
	if policy.RPMSoftLimit > 0 {
		l.requests = append(l.requests, now)
	}
	return nil
}

func budgetRetryMs(now time.Time, oldest time.Time) int {
	if oldest.IsZero() {
		return 15000
	}
	until := oldest.Add(time.Minute).Sub(now)
	if until <= 0 {
		return 1000
	}
	return int(until.Milliseconds())
}

func (s *AIService) providerBudgetPolicy(provider string, model string) ProviderBudgetPolicy {
	providerNorm := strings.ToLower(strings.TrimSpace(provider))
	modelNorm := strings.ToLower(strings.TrimSpace(model))
	policy := ProviderBudgetPolicy{Provider: providerNorm, Model: modelNorm}

	// Provider defaults. New AI_LIMIT_* names are preferred; legacy OpenAI GPT-5.5 Pro names are kept below.
	providerPrefix := "AI_LIMIT_" + budgetEnvName(providerNorm)
	policy.MaxConcurrency = envIntFirst(0, providerPrefix+"_MAX_CONCURRENCY")
	policy.TPMSoftLimit = envIntFirst(0, providerPrefix+"_TPM_SOFT_LIMIT")
	policy.RPMSoftLimit = envIntFirst(0, providerPrefix+"_RPM_SOFT_LIMIT")

	// Model-family defaults, e.g. AI_LIMIT_OPENAI_GPT5_* and AI_LIMIT_OPENAI_GPT55_*.
	for _, family := range budgetModelFamilies(modelNorm) {
		prefix := providerPrefix + "_" + family
		policy.MaxConcurrency = envIntFirst(policy.MaxConcurrency, prefix+"_MAX_CONCURRENCY")
		policy.TPMSoftLimit = envIntFirst(policy.TPMSoftLimit, prefix+"_TPM_SOFT_LIMIT")
		policy.RPMSoftLimit = envIntFirst(policy.RPMSoftLimit, prefix+"_RPM_SOFT_LIMIT")
	}

	// Exact model override, e.g. AI_LIMIT_OPENAI_GPT_5_5_PRO_TPM_SOFT_LIMIT.
	modelPrefix := providerPrefix + "_" + budgetEnvName(modelNorm)
	policy.MaxConcurrency = envIntFirst(policy.MaxConcurrency, modelPrefix+"_MAX_CONCURRENCY")
	policy.TPMSoftLimit = envIntFirst(policy.TPMSoftLimit, modelPrefix+"_TPM_SOFT_LIMIT")
	policy.RPMSoftLimit = envIntFirst(policy.RPMSoftLimit, modelPrefix+"_RPM_SOFT_LIMIT")

	// Backward compatibility for existing GPT-5.5 Pro limiter knobs.
	if providerNorm == "openai" && isGPT55Pro(modelNorm) {
		policy.MaxConcurrency = envIntFirst(policy.MaxConcurrency, "OPENAI_GPT55_PRO_MAX_CONCURRENCY")
		policy.TPMSoftLimit = envIntFirst(policy.TPMSoftLimit, "OPENAI_GPT55_PRO_TPM_SOFT_LIMIT")
		if policy.MaxConcurrency <= 0 {
			policy.MaxConcurrency = s.cfg.OpenAIGPT55ProMaxConcurrency
		}
		if policy.TPMSoftLimit <= 0 {
			policy.TPMSoftLimit = s.cfg.OpenAIGPT55ProTPMSoftLimit
		}
	}
	return policy
}

func (s *AIService) applyProviderBudget(ctx context.Context, provider string, model string, messages []Message, maxOutputTokens int) (func(), error) {
	policy := s.providerBudgetPolicy(provider, model)
	if policy.MaxConcurrency <= 0 && policy.TPMSoftLimit <= 0 && policy.RPMSoftLimit <= 0 {
		return nil, nil
	}
	limiter := providerBudgetLimiterFor(provider, model, policy.MaxConcurrency)
	release, err := limiter.acquire(ctx)
	if err != nil {
		return nil, err
	}
	requestedTokens := estimateRequestedTokens(messages, maxOutputTokens)
	if pe := limiter.reserve(provider, model, requestedTokens, policy); pe != nil {
		release()
		return nil, pe
	}
	return release, nil
}

func estimateRequestedTokens(messages []Message, maxOutputTokens int) int {
	return estimateOpenAIRequestedTokens(messages, maxOutputTokens)
}

func envIntFirst(current int, keys ...string) int {
	for _, key := range keys {
		if v, ok := parsePositiveEnvInt(key); ok {
			return v
		}
	}
	return current
}

func parsePositiveEnvInt(key string) (int, bool) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return 0, false
	}
	var v int
	_, err := fmt.Sscanf(value, "%d", &v)
	if err == nil && v > 0 {
		return v, true
	}
	return 0, false
}

func budgetEnvName(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	var b strings.Builder
	lastUnderscore := false
	for _, r := range s {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			b.WriteByte('_')
			lastUnderscore = true
		}
	}
	return strings.Trim(b.String(), "_")
}

func budgetModelFamilies(model string) []string {
	model = strings.ToLower(strings.TrimSpace(model))
	var families []string
	if strings.HasPrefix(model, "gpt-5.5") {
		families = append(families, "GPT55")
	}
	if strings.HasPrefix(model, "gpt-5") {
		families = append(families, "GPT5")
	}
	if strings.HasPrefix(model, "claude-") {
		families = append(families, "CLAUDE")
	}
	if strings.HasPrefix(model, "gemini-") {
		families = append(families, "GEMINI")
	}
	if strings.HasPrefix(model, "deepseek-") {
		families = append(families, "DEEPSEEK")
	}
	if strings.HasPrefix(model, "kimi") || strings.HasPrefix(model, "moonshot-") {
		families = append(families, "KIMI")
	}
	return families
}
