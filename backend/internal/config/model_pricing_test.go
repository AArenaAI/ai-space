package config

import "testing"

func TestLoadModelPricesFromJSONList(t *testing.T) {
	t.Setenv("MODEL_PRICES_JSON", `[{"provider":"openai","model":"gpt-5.5","input_price_rmb":3,"output_price_rmb":4}]`)
	prices := loadModelPrices()
	price, ok := prices["openai:gpt-5.5"]
	if !ok {
		t.Fatalf("expected openai:gpt-5.5 price")
	}
	if price.PricingUnit != "token_1k" || price.InputPriceRMB != 3 || price.OutputPriceRMB != 4 {
		t.Fatalf("unexpected price: %+v", price)
	}
}

func TestLoadModelPricesFromEnvOverride(t *testing.T) {
	t.Setenv("MODEL_PRICE_OPENAI_GPT_5_5_INPUT", "5")
	t.Setenv("MODEL_PRICE_OPENAI_GPT_5_5_OUTPUT", "6")
	prices := loadModelPrices()
	price, ok := prices["openai:gpt-5.5"]
	if !ok {
		t.Fatalf("expected env model price")
	}
	if price.InputPriceRMB != 5 || price.OutputPriceRMB != 6 || price.PricingUnit != "token_1k" {
		t.Fatalf("unexpected env price: %+v", price)
	}
}

func TestLoadModelPricesFromEnvImage(t *testing.T) {
	t.Setenv("MODEL_PRICE_OPENAI_GPT_IMAGE_2_IMAGE", "0.25")
	prices := loadModelPrices()
	price, ok := prices["openai:gpt-image-2"]
	if !ok {
		t.Fatalf("expected image model price")
	}
	if price.ImageUnitPrice != 0.25 || price.PricingUnit != "image" {
		t.Fatalf("unexpected image price: %+v", price)
	}
}
