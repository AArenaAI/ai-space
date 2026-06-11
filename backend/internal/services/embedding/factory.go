package embedding

import (
	"fmt"
	"strings"

	"aipool-backend/internal/config"
)

// NewProvider 根据配置创建对应的 embedding provider
func NewProvider(cfg *config.Config) (Provider, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.TextEmbeddingProvider)) {
	case "openai", "":
		return NewOpenAIProvider(cfg), nil
	case "gemini":
		return NewGeminiProvider(cfg), nil
	// case "local":
	// 	return NewLocalProvider(cfg), nil
	default:
		return nil, fmt.Errorf("不支持的 text embedding provider: %s", cfg.TextEmbeddingProvider)
	}
}

func HasConfiguredProviderKey(cfg *config.Config) bool {
	if strings.TrimSpace(cfg.TextEmbeddingAPIKey) != "" {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(cfg.TextEmbeddingProvider)) {
	case "gemini":
		return strings.TrimSpace(cfg.GeminiKey) != ""
	case "openai", "":
		return strings.TrimSpace(cfg.OpenAIKey) != ""
	default:
		return false
	}
}
