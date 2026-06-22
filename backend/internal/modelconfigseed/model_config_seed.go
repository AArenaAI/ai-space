package modelconfigseed

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"gorm.io/gorm"
)

const defaultConfigPath = "config/model_configs.json"

var fileMu sync.Mutex

type File struct {
	Version int     `json:"version"`
	Models  []Entry `json:"models"`
}

type Entry struct {
	ModelID                string `json:"model_id"`
	Enabled                bool   `json:"enabled"`
	Tier                   string `json:"tier"`
	ReasoningLevel         string `json:"reasoning_level,omitempty"`
	ReasoningFastValue     string `json:"reasoning_fast_value,omitempty"`
	ReasoningThinkingValue string `json:"reasoning_thinking_value,omitempty"`
	ReasoningExpertValue   string `json:"reasoning_expert_value,omitempty"`
	Status                 string `json:"status"`
	StatusMessage          string `json:"status_message,omitempty"`
}

func ConfigPath() string {
	if p := strings.TrimSpace(os.Getenv("MODEL_CONFIG_JSON_PATH")); p != "" {
		return p
	}
	return defaultConfigPath
}

func EnsureRows(db *gorm.DB, codeModels []modelmeta.ModelInfo) error {
	entries, err := loadMap(ConfigPath())
	if err != nil {
		return err
	}
	for _, model := range codeModels {
		var count int64
		if err := db.Model(&models.ModelConfig{}).Where("model_id = ?", model.ID).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		cfg := defaultConfigForModel(model)
		if seed, ok := entries[model.ID]; ok {
			applyEntry(&cfg, seed)
		}
		if err := db.Create(&cfg).Error; err != nil {
			return err
		}
	}
	return nil
}

func SyncDBToFile(db *gorm.DB, codeModels []modelmeta.ModelInfo) error {
	fileMu.Lock()
	defer fileMu.Unlock()

	var configs []models.ModelConfig
	if err := db.Find(&configs).Error; err != nil {
		return err
	}
	configMap := make(map[string]models.ModelConfig, len(configs))
	for _, cfg := range configs {
		configMap[cfg.ModelID] = cfg
	}

	out := File{Version: 1, Models: make([]Entry, 0, len(codeModels))}
	for _, model := range codeModels {
		cfg, ok := configMap[model.ID]
		if !ok {
			cfg = defaultConfigForModel(model)
		}
		out.Models = append(out.Models, entryFromConfig(cfg))
	}
	return writeFile(ConfigPath(), out)
}

func loadMap(path string) (map[string]Entry, error) {
	entries := map[string]Entry{}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return entries, nil
		}
		return nil, fmt.Errorf("读取模型配置 JSON 失败: %w", err)
	}
	var file File
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("解析模型配置 JSON 失败: %w", err)
	}
	for _, entry := range file.Models {
		entry.ModelID = strings.TrimSpace(entry.ModelID)
		if entry.ModelID == "" {
			continue
		}
		entries[entry.ModelID] = entry
	}
	return entries, nil
}

func writeFile(path string, file File) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func defaultConfigForModel(model modelmeta.ModelInfo) models.ModelConfig {
	level := ""
	fast, thinking, expert := "", "", ""
	if modelmeta.ModelHasCapability(model, "reasoning") {
		level = services.ReasoningLevelThinking
		fast, thinking, expert = services.DefaultReasoningOverrideValuesForModel(model.ID)
	}
	return models.ModelConfig{
		ModelID:                model.ID,
		Enabled:                true,
		Tier:                   "basic",
		ReasoningLevel:         level,
		ReasoningFastValue:     fast,
		ReasoningThinkingValue: thinking,
		ReasoningExpertValue:   expert,
		Status:                 "available",
	}
}

func applyEntry(cfg *models.ModelConfig, entry Entry) {
	cfg.Enabled = entry.Enabled
	if tier := normalizeTier(entry.Tier); tier != "" {
		cfg.Tier = tier
	}
	cfg.ReasoningLevel = services.NormalizeReasoningLevel(entry.ReasoningLevel)
	if entry.ReasoningLevel == "" {
		cfg.ReasoningLevel = ""
	}
	cfg.ReasoningFastValue = strings.TrimSpace(entry.ReasoningFastValue)
	cfg.ReasoningThinkingValue = strings.TrimSpace(entry.ReasoningThinkingValue)
	cfg.ReasoningExpertValue = strings.TrimSpace(entry.ReasoningExpertValue)
	cfg.Status = normalizeStatus(entry.Status)
	cfg.StatusMsg = strings.TrimSpace(entry.StatusMessage)
}

func entryFromConfig(cfg models.ModelConfig) Entry {
	status := normalizeStatus(cfg.Status)
	fast := strings.TrimSpace(cfg.ReasoningFastValue)
	thinking := strings.TrimSpace(cfg.ReasoningThinkingValue)
	expert := strings.TrimSpace(cfg.ReasoningExpertValue)
	if cfg.ReasoningLevel != "" {
		defaultFast, defaultThinking, defaultExpert := services.DefaultReasoningOverrideValuesForModel(cfg.ModelID)
		if fast == "" {
			fast = defaultFast
		}
		if thinking == "" {
			thinking = defaultThinking
		}
		if expert == "" {
			expert = defaultExpert
		}
	}
	return Entry{
		ModelID:                cfg.ModelID,
		Enabled:                cfg.Enabled,
		Tier:                   normalizeTierOrDefault(cfg.Tier),
		ReasoningLevel:         cfg.ReasoningLevel,
		ReasoningFastValue:     fast,
		ReasoningThinkingValue: thinking,
		ReasoningExpertValue:   expert,
		Status:                 status,
		StatusMessage:          strings.TrimSpace(cfg.StatusMsg),
	}
}

func normalizeTier(tier string) string {
	switch strings.TrimSpace(tier) {
	case "basic", "advanced":
		return strings.TrimSpace(tier)
	case "elite":
		return "advanced"
	default:
		return ""
	}
}

func normalizeTierOrDefault(tier string) string {
	if v := normalizeTier(tier); v != "" {
		return v
	}
	return "basic"
}

func normalizeStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "available", "disabled", "maintenance", "quota_exhausted", "rate_limited":
		return strings.TrimSpace(status)
	default:
		return "available"
	}
}
