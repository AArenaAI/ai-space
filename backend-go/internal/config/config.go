package config

import (
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port          string
	DatabasePath  string
	JWTSecret     string
	FrontendURL   string
	
	// API Keys
	OpenAIKey     string
	OpenAIBaseURL string // 自定义 OpenAI 兼容 API 基础地址（用于中转/逆向）
	AnthropicKey  string
	AnthropicBaseURL string // 自定义 Anthropic 基础地址
	GeminiKey     string
	GeminiBaseURL string
	DeepSeekKey   string
	DeepSeekBaseURL string
	MoonshotKey     string
	MoonshotBaseURL string
	BraveSearchKey  string
	TavilySearchKey string
}

func Load() *Config {
	_ = godotenv.Load()

	return &Config{
		Port:         getEnv("PORT", "9091"),
		DatabasePath: getEnv("DATABASE_PATH", "./data/aipool.db"),
		JWTSecret:    getEnv("JWT_SECRET", "your-secret-key-change-in-production"),
		FrontendURL:  getEnv("FRONTEND_URL", "http://localhost:9090"),
		
		OpenAIKey:      getEnv("OPENAI_API_KEY", ""),
		OpenAIBaseURL:  getEnv("OPENAI_BASE_URL", ""),
		AnthropicKey:   getEnv("ANTHROPIC_API_KEY", ""),
		AnthropicBaseURL: getEnv("ANTHROPIC_BASE_URL", ""),
		GeminiKey:      getEnv("GEMINI_API_KEY", ""),
		GeminiBaseURL:  getEnv("GEMINI_BASE_URL", ""),
		DeepSeekKey:    getEnv("DEEPSEEK_API_KEY", ""),
		DeepSeekBaseURL: getEnv("DEEPSEEK_BASE_URL", ""),
		MoonshotKey:    getEnv("MOONSHOT_API_KEY", ""),
		MoonshotBaseURL: getEnv("MOONSHOT_BASE_URL", ""),
		BraveSearchKey: getEnv("BRAVE_SEARCH_KEY", "BSAj_52ZrHEiVeAotVRcAiFxnJV5X3U"),
		TavilySearchKey: getEnv("TAVILY_SEARCH_KEY", ""),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
