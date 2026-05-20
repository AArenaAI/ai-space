package services

import (
	"context"
	"strings"
	"testing"
	"time"

	"aipool-backend/internal/config"
)

func TestParseOpenAIProviderErrorRateLimit(t *testing.T) {
	raw := `OpenAI error 429: {"error":{"message":"Rate limit reached for gpt-5.5-pro in organization org on tokens per min. Limit 30000, Used 29000, Requested 4096. Please try again in 12.5s.","type":"tokens","code":"rate_limit_exceeded"}}`
	pe := ParseOpenAIProviderErrorText(raw, "gpt-5.5-pro")
	if pe == nil {
		t.Fatal("expected provider error")
	}
	if pe.Kind != ProviderErrorRateLimit {
		t.Fatalf("kind=%s", pe.Kind)
	}
	if pe.Code != "rate_limit_exceeded" {
		t.Fatalf("code=%s", pe.Code)
	}
	if pe.LimitType != "tokens_per_minute" {
		t.Fatalf("limit_type=%s", pe.LimitType)
	}
	if pe.LimitTokens != 30000 || pe.UsedTokens != 29000 || pe.RequestedTokens != 4096 {
		t.Fatalf("tokens limit=%d used=%d requested=%d", pe.LimitTokens, pe.UsedTokens, pe.RequestedTokens)
	}
	if pe.RetryAfterMs != 12500 {
		t.Fatalf("retry_after_ms=%d", pe.RetryAfterMs)
	}
	event := providerErrorToStreamEvent(pe)
	if event == nil || event.Type != EventError || !event.Recoverable || event.ErrorKind != "rate_limit" {
		t.Fatalf("bad event: %#v", event)
	}
	if !strings.Contains(event.Message, "GPT-5.5") && !strings.Contains(event.Message, "gpt-5.5") {
		t.Fatalf("unexpected user message: %s", event.Message)
	}
}

func TestGPT55ProLimiterReserveTPM(t *testing.T) {
	limiter := openAIModelLimiterFor("test-gpt-5.5-pro", 1)
	pe := limiter.reserveTPM("test-gpt-5.5-pro", 1200, 1000)
	if pe == nil {
		t.Fatal("expected local TPM provider error")
	}
	if pe.Code != "local_tpm_budget_exceeded" || pe.Kind != ProviderErrorRateLimit {
		t.Fatalf("bad provider error: %#v", pe)
	}
	if pe.LimitTokens != 1000 || pe.RequestedTokens != 1200 || pe.LimitType != "tokens_per_minute" {
		t.Fatalf("bad meta: %#v", pe)
	}
}

func TestGPT55ProLimiterConcurrencyOne(t *testing.T) {
	limiter := openAIModelLimiterFor("test-gpt-5.5-pro-concurrency", 1)
	release, err := limiter.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := limiter.acquire(ctx); err == nil {
		t.Fatal("expected context timeout while concurrency slot is occupied")
	}
}

func TestOpenAIMaxOutputTokensUsesGPT55ProOverrides(t *testing.T) {
	svc := NewAIService(&config.Config{
		OpenAIMaxOutputTokens:                   1000,
		OpenAIMaxOutputTokensSearch:             1100,
		OpenAIMaxOutputTokensDeep:               1200,
		OpenAIMaxOutputTokensDeepSearch:         1300,
		OpenAIGPT55ProMaxOutputTokens:           2000,
		OpenAIGPT55ProMaxOutputTokensSearch:     2100,
		OpenAIGPT55ProMaxOutputTokensDeep:       2200,
		OpenAIGPT55ProMaxOutputTokensDeepSearch: 2300,
	})

	cases := []struct {
		name      string
		model     string
		search    bool
		reasoning bool
		want      int
	}{
		{name: "pro normal", model: "gpt-5.5-pro", want: 2000},
		{name: "pro search", model: "gpt-5.5-pro", search: true, want: 2100},
		{name: "pro deep", model: "gpt-5.5-pro", reasoning: true, want: 2200},
		{name: "pro deep search", model: "gpt-5.5-pro", search: true, reasoning: true, want: 2300},
		{name: "pro suffix", model: "gpt-5.5-pro-2026-05-01", want: 2000},
		{name: "non pro fallback", model: "gpt-5.5", want: 1000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := svc.openAIMaxOutputTokens(tc.model, tc.search, tc.reasoning); got != tc.want {
				t.Fatalf("got=%d want=%d", got, tc.want)
			}
		})
	}
}

func TestMaxOutputTokensFromBody(t *testing.T) {
	if got := maxOutputTokensFromBody(map[string]any{"max_output_tokens": 1234}); got != 1234 {
		t.Fatalf("got=%d", got)
	}
}
