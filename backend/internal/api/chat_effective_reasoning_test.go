package api

import (
	"testing"

	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestEffectiveReasoningUsesOffMappingAsDisabled(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.ModelConfig{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Create(&models.ModelConfig{
		ModelID:                "deepseek-v4-pro",
		Enabled:                true,
		Tier:                   "advanced",
		ReasoningLevel:         services.ReasoningLevelThinking,
		ReasoningFastValue:     "off",
		ReasoningThinkingValue: "high",
		ReasoningExpertValue:   "max",
		Status:                 "active",
	}).Error; err != nil {
		t.Fatalf("seed config: %v", err)
	}

	h := &ChatHandler{db: db}
	enabled, effort := h.effectiveReasoningForModel("deepseek-v4-pro", services.ReasoningLevelFast)
	if enabled {
		t.Fatalf("fast/off should disable effective reasoning")
	}
	if effort != services.ReasoningEffortOff {
		t.Fatalf("effort = %s, want off", effort)
	}

	enabled, effort = h.effectiveReasoningForModel("deepseek-v4-pro", services.ReasoningLevelThinking)
	if !enabled {
		t.Fatalf("thinking level should enable reasoning")
	}
	if effort != services.ReasoningEffortHigh {
		t.Fatalf("effort = %s, want high", effort)
	}
}
