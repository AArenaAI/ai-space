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

func TestUsageServiceSelectsSeedanceVideoPricingRule(t *testing.T) {
	withVideo := true
	withoutVideo := false
	svc := NewUsageService(&config.Config{
		ModelPrices: map[string]config.ModelPrice{
			"volcengine:doubao-seedance-2-0-260128": {
				Provider:       "volcengine",
				Model:          "doubao-seedance-2-0-260128",
				PricingUnit:    "token_1k",
				SourceCurrency: "CNY",
				SourceUnit:     "per_1m_tokens",
				VideoPricingRules: []config.VideoPricingRule{
					{Resolution: "720p", InputContainsVideo: &withoutVideo, SourceOutputPrice: 46},
					{Resolution: "1080p", InputContainsVideo: &withoutVideo, SourceOutputPrice: 51},
					{Resolution: "1080p", InputContainsVideo: &withVideo, SourceOutputPrice: 31},
				},
			},
		},
	})

	price720 := svc.getVideoPrice("volcengine", "doubao-seedance-2-0-260128", "720p", false)
	if price720.OutputPriceRMB != 0.046 || price720.SourceOutputPrice != 46 || price720.ExchangeRateToRMB != 1 {
		t.Fatalf("expected 720p no-video price ¥46/1M => ¥0.046/1K, got %+v", price720)
	}
	price1080Video := svc.getVideoPrice("volcengine", "doubao-seedance-2-0-260128", "1080p", true)
	if price1080Video.OutputPriceRMB != 0.031 || price1080Video.SourceOutputPrice != 31 {
		t.Fatalf("expected 1080p with-video price ¥31/1M => ¥0.031/1K, got %+v", price1080Video)
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

func TestUsageServiceGoogleTranslateCharacterPricing(t *testing.T) {
	t.Setenv("USD_CNY_RATE", "7")
	svc := NewUsageService(&config.Config{
		ModelPrices: map[string]config.ModelPrice{
			"google-cloud-translate-v3:general/nmt": {
				Provider:         "google-cloud-translate-v3",
				Model:            "general/nmt",
				PricingUnit:      "character_1m",
				SourceCurrency:   "USD",
				SourceUnit:       "per_1m_characters_source",
				SourceInputPrice: 20,
			},
			"google-cloud-translate-v3:general/translation-llm": {
				Provider:          "google-cloud-translate-v3",
				Model:             "general/translation-llm",
				PricingUnit:       "character_1m",
				SourceCurrency:    "USD",
				SourceUnit:        "per_1m_characters_input_output",
				SourceInputPrice:  10,
				SourceOutputPrice: 10,
			},
		},
	})

	nmt := svc.getCharacterPrice("google-cloud-translate-v3", "general/nmt")
	if nmt.InputPriceRMB != 140 || nmt.OutputPriceRMB != 0 || nmt.PricingUnit != "character_1m" {
		t.Fatalf("expected NMT $20/1M source chars => ¥140/1M chars, got %+v", nmt)
	}

	llm := svc.getCharacterPrice("google-cloud-translate-v3", "general/translation-llm")
	if llm.InputPriceRMB != 70 || llm.OutputPriceRMB != 70 || llm.ExchangeRateToRMB != 7 {
		t.Fatalf("expected Translation LLM $10+$10/1M chars => ¥70+¥70/1M chars, got %+v", llm)
	}
}

func TestNormalizeTranslationUsageModel(t *testing.T) {
	full := "projects/demo/locations/global/models/general/translation-llm"
	if got := normalizeTranslationUsageModel(full); got != "general/translation-llm" {
		t.Fatalf("expected short model path, got %q", got)
	}
	if got := normalizeTranslationUsageModel("general/nmt"); got != "general/nmt" {
		t.Fatalf("expected unchanged short model, got %q", got)
	}
}
