package embedding

import (
	"fmt"

	"aipool-backend/internal/config"
)

// NewProvider 根据配置创建对应的 embedding provider
func NewProvider(cfg *config.Config) (Provider, error) {
	switch cfg.EmbeddingProvider {
	case "openai", "":
		return NewOpenAIProvider(cfg), nil
	// 后续可扩展其他 provider
	// case "gemini":
	// 	return NewGeminiProvider(cfg), nil
	// case "local":
	// 	return NewLocalProvider(cfg), nil
	default:
		return nil, fmt.Errorf("不支持的 embedding provider: %s", cfg.EmbeddingProvider)
	}
}
