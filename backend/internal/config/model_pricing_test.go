package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadModelPricesFromFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "prices.json")
	writeTestFile(t, path, `[
		{"provider":"openai","model":"gpt-5.5","pricing_unit":"token_1k","input_price_rmb":3,"output_price_rmb":4},
		{"provider":"openai","model":"gpt-image-2","pricing_unit":"image","image_unit_price_rmb":0}
	]`)
	t.Setenv("MODEL_PRICES_FILE", path)

	prices := loadModelPrices()
	price, ok := prices["openai:gpt-5.5"]
	if !ok {
		t.Fatalf("expected file model price")
	}
	if price.PricingUnit != "token_1k" || price.InputPriceRMB != 3 || price.OutputPriceRMB != 4 {
		t.Fatalf("unexpected file price: %+v", price)
	}
	image, ok := prices["openai:gpt-image-2"]
	if !ok || image.PricingUnit != "image" || image.ImageUnitPrice != 0 {
		t.Fatalf("expected explicit zero image file entry, got ok=%v %+v", ok, image)
	}
}

func TestLoadModelPricesFromJSONOverridesFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "prices.json")
	writeTestFile(t, path, `[{"provider":"openai","model":"gpt-5.5","input_price_rmb":1,"output_price_rmb":2}]`)
	t.Setenv("MODEL_PRICES_FILE", path)
	t.Setenv("MODEL_PRICES_JSON", `[{"provider":"openai","model":"gpt-5.5","input_price_rmb":3,"output_price_rmb":4}]`)

	prices := loadModelPrices()
	price, ok := prices["openai:gpt-5.5"]
	if !ok {
		t.Fatalf("expected openai:gpt-5.5 price")
	}
	if price.PricingUnit != "token_1k" || price.InputPriceRMB != 3 || price.OutputPriceRMB != 4 {
		t.Fatalf("unexpected json override price: %+v", price)
	}
}

func TestLoadModelPricesFromEnvOverride(t *testing.T) {
	path := filepath.Join(t.TempDir(), "prices.json")
	writeTestFile(t, path, `[{"provider":"openai","model":"gpt-5.5","input_price_rmb":1,"output_price_rmb":2}]`)
	t.Setenv("MODEL_PRICES_FILE", path)
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
	t.Setenv("MODEL_PRICES_FILE", filepath.Join(t.TempDir(), "missing.json"))
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

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write test file: %v", err)
	}
}
