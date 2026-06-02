package services

import (
	"testing"

	"aipool-backend/internal/config"
)

func TestUsageServiceModelPriceOverridesProviderFallback(t *testing.T) {
	svc := NewUsageService(&config.Config{
		OpenAIInputPrice:  1,
		OpenAIOutputPrice: 2,
		ModelPrices: map[string]config.ModelPrice{
			"openai:gpt-5.5": {
				Provider:       "openai",
				Model:          "gpt-5.5",
				PricingUnit:    "token_1k",
				InputPriceRMB:  3,
				OutputPriceRMB: 4,
			},
		},
	})

	price := svc.getTokenPrice("OpenAI", "GPT-5.5")
	if price.InputPriceRMB != 3 || price.OutputPriceRMB != 4 || price.PricingUnit != "token_1k" {
		t.Fatalf("expected model-level price 3/4 token_1k, got %+v", price)
	}

	fallback := svc.getTokenPrice("openai", "unknown-model")
	if fallback.InputPriceRMB != 1 || fallback.OutputPriceRMB != 2 || fallback.PricingUnit != "token_1k" {
		t.Fatalf("expected provider fallback 1/2 token_1k, got %+v", fallback)
	}
}

func TestUsageServiceConvertsSourceUSDPriceToRMB(t *testing.T) {
	t.Setenv("USD_CNY_RATE", "7")
	svc := NewUsageService(&config.Config{
		ModelPrices: map[string]config.ModelPrice{
			"moonshot:kimi-k2.6": {
				Provider:                  "moonshot",
				Model:                     "kimi-k2.6",
				PricingUnit:               "token_1k",
				SourceCurrency:            "USD",
				SourceUnit:                "per_1m_tokens",
				SourceInputCacheMissPrice: 0.95,
				SourceInputCacheHitPrice:  0.16,
				SourceOutputPrice:         4,
			},
		},
	})

	price := svc.getTokenPrice("moonshot", "kimi-k2.6")
	if price.InputPriceRMB != 0.00665 || price.OutputPriceRMB != 0.028 || price.ExchangeRateToRMB != 7 {
		t.Fatalf("expected USD source price converted to RMB/1K using cache-miss input, got %+v", price)
	}
	if price.SourceInputCacheHitPrice != 0.16 || price.SourceCurrency != "USD" {
		t.Fatalf("expected original source pricing retained, got %+v", price)
	}
}

func TestUsageServiceImageModelPriceOverridesProviderFallback(t *testing.T) {
	svc := NewUsageService(&config.Config{
		ImageGenUnitPrice: 0.1,
		ModelPrices: map[string]config.ModelPrice{
			"openai:gpt-image-2": {
				Provider:       "openai",
				Model:          "gpt-image-2",
				PricingUnit:    "image",
				ImageUnitPrice: 0.25,
			},
		},
	})

	price := svc.getImagePrice("openai", "gpt-image-2")
	if price.ImageUnitPrice != 0.25 || price.PricingUnit != "image" {
		t.Fatalf("expected model image price 0.25 image, got %+v", price)
	}

	fallback := svc.getImagePrice("openai", "unknown-image")
	if fallback.ImageUnitPrice != 0.1 || fallback.PricingUnit != "image" {
		t.Fatalf("expected image fallback 0.1 image, got %+v", fallback)
	}
}
