package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	BaseURL       string
	Port          string
	DatabasePath  string
	JWTSecret     string
	FrontendURL   string

	// API Keys
	OpenAIKey        string
	OpenAIBaseURL    string // 自定义 OpenAI 兼容 API 基础地址（用于中转/逆向）
	AnthropicKey     string
	AnthropicBaseURL string // 自定义 Anthropic 基础地址
	GeminiKey        string
	GeminiBaseURL    string
	DeepSeekKey      string
	DeepSeekBaseURL  string
	MoonshotKey      string
	MoonshotBaseURL  string
	BraveSearchKey   string
	TavilySearchKey  string

	// 文件存储
	FileStorageDir string // 用户上传文件的本地存储路径

	// 其他配置
	VisionModel string // 用于图片解析的 Vision 模型

	// Embedding 配置
	EnableEmbedding     bool   // 是否启用 embedding 功能
	EmbeddingProvider   string // openai | gemini | local
	EmbeddingModel      string // text-embedding-3-small
	EmbeddingDimensions int    // 1536
	EmbeddingBatchSize  int    // 32
	EmbeddingBaseURL    string // 自定义 embedding API 地址
	EmbeddingAPIKey     string // embedding API key（默认同 OpenAIKey）
}

func Load() *Config {
	_ = godotenv.Load()

	cfg := &Config{
		BaseURL:      getEnv("BASE_URL", ""),
		Port:         getEnv("PORT", "9091"),
		DatabasePath: getEnv("DATABASE_PATH", "./data/aipool.db"),
		JWTSecret:    getEnv("JWT_SECRET", "your-secret-key-change-in-production"),
		FrontendURL:  getEnv("FRONTEND_URL", "http://localhost:9090"),

		OpenAIKey:        getEnv("OPENAI_API_KEY", ""),
		OpenAIBaseURL:    getEnv("OPENAI_BASE_URL", ""),
		AnthropicKey:     getEnv("ANTHROPIC_API_KEY", ""),
		AnthropicBaseURL: getEnv("ANTHROPIC_BASE_URL", ""),
		GeminiKey:        getEnv("GEMINI_API_KEY", ""),
		GeminiBaseURL:    getEnv("GEMINI_BASE_URL", ""),
		DeepSeekKey:      getEnv("DEEPSEEK_API_KEY", ""),
		DeepSeekBaseURL:  getEnv("DEEPSEEK_BASE_URL", ""),
		MoonshotKey:      getEnv("MOONSHOT_API_KEY", ""),
		MoonshotBaseURL:  getEnv("MOONSHOT_BASE_URL", ""),
		BraveSearchKey:   getEnv("BRAVE_SEARCH_KEY", "BSAj_52ZrHEiVeAotVRcAiFxnJV5X3U"),
		TavilySearchKey:  getEnv("TAVILY_SEARCH_KEY", ""),
		FileStorageDir:   getEnv("FILE_STORAGE_DIR", "./uploads"),

		VisionModel: getEnv("VISION_MODEL", "gpt-5.4"),

		EnableEmbedding:     getEnv("ENABLE_EMBEDDING", "") == "true",
		EmbeddingProvider:   getEnv("EMBEDDING_PROVIDER", "openai"),
		EmbeddingModel:      getEnv("EMBEDDING_MODEL", "text-embedding-3-small"),
		EmbeddingDimensions: getEnvInt("EMBEDDING_DIMENSIONS", 1536),
		EmbeddingBatchSize:  getEnvInt("EMBEDDING_BATCH_SIZE", 32),
		EmbeddingBaseURL:    getEnv("EMBEDDING_BASE_URL", ""),
		EmbeddingAPIKey:     getEnv("EMBEDDING_API_KEY", ""),
	}

	// 如果没有单独设置 EMBEDDING_API_KEY，默认复用 OPENAI_API_KEY
	if cfg.EmbeddingAPIKey == "" {
		cfg.EmbeddingAPIKey = cfg.OpenAIKey
	}
	// 如果没有单独设置 EMBEDDING_BASE_URL，默认复用 OPENAI_BASE_URL
	if cfg.EmbeddingBaseURL == "" {
		cfg.EmbeddingBaseURL = cfg.OpenAIBaseURL
	}

	return cfg
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		var v int
		_, err := fmt.Sscanf(value, "%d", &v)
		if err == nil && v > 0 {
			return v
		}
	}
	return defaultValue
}
