package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	// 基础服务配置
	BaseURL      string
	Port         string
	DatabasePath string
	JWTSecret    string
	FrontendURL  string

	// ========== Chat Provider（对话模型，支持 OpenAI / Anthropic / Gemini / DeepSeek / Moonshot 多路并行）==========
	OpenAIKey            string
	OpenAIBaseURL        string  // 自定义 OpenAI 兼容 API 基础地址（用于中转/逆向）
	OpenAIOfficialKey    string  // OpenAI 官方 API Key（直连，不走中转）
	OpenAIInputPrice     float64 // ¥/千tokens
	OpenAIOutputPrice    float64 // ¥/千tokens
	AnthropicKey         string
	AnthropicBaseURL     string  // 自定义 Anthropic 基础地址
	AnthropicInputPrice  float64 // ¥/千tokens
	AnthropicOutputPrice float64 // ¥/千tokens
	GeminiKey            string
	GeminiBaseURL        string
	GeminiInputPrice     float64 // ¥/千tokens
	GeminiOutputPrice    float64 // ¥/千tokens
	DeepSeekKey          string
	DeepSeekBaseURL      string
	DeepSeekInputPrice   float64 // ¥/千tokens
	DeepSeekOutputPrice  float64 // ¥/千tokens
	MoonshotKey          string
	MoonshotBaseURL      string
	MoonshotInputPrice   float64 // ¥/千tokens
	MoonshotOutputPrice  float64 // ¥/千tokens

	// ========== Max Output Tokens（各模型输出上限，默认值已适配各 API）==========
	OpenAIMaxOutputTokens       int // OpenAI Responses API 基础输出 token 上限（默认 8192）
	OpenAIMaxOutputTokensSearch int // OpenAI 开启搜索时的输出 token 上限（默认 6400）
	DeepSeekMaxTokens           int // DeepSeek 输出 token 上限（默认 8192，之前未设置导致用了 API 默认值）
	AnthropicMaxTokens          int // Anthropic 输出 token 上限（默认 4096）

	// 联网搜索（对应 Chat Provider 的 web_search 工具，独立配置）
	BraveSearchKey  string
	TavilySearchKey string

	// ========== Vision Provider（图片解析，独立配置；为空则自动复用 Chat Provider 的 OpenAI）==========
	VisionAPIKey      string  // Vision API Key
	VisionBaseURL     string  // Vision API Base URL
	VisionModel       string  // 用于图片解析的 Vision 模型
	VisionInputPrice  float64 // ¥/千tokens，输入单价
	VisionOutputPrice float64 // ¥/千tokens，输出单价

	// ========== Text Embedding Provider（文本向量 RAG 检索，独立配置；为空则自动复用 Chat Provider 的 OpenAI）==========
	EnableTextEmbedding     bool   // 是否启用文本向量功能
	TextEmbeddingProvider   string // 文本向量服务提供商：openai | gemini | local
	TextEmbeddingModel      string // 文本向量模型，如 text-embedding-3-small
	TextEmbeddingDimensions int    // 向量维度，如 1536
	TextEmbeddingBatchSize  int    // 批量 embedding 大小
	TextEmbeddingBaseURL    string // 自定义文本向量 API 地址
	TextEmbeddingAPIKey     string // 文本向量 API Key

	// ========== Image Generation Provider（图片生成，独立配置；为空则自动复用 Chat Provider 的 OpenAI）==========
	ImageGenAPIKey      string  // 图片生成 API Key
	ImageGenBaseURL     string  // 图片生成 API Base URL
	ImageGenModel       string  // 图片生成模型，如 gpt-image-2
	ImageGenInputPrice  float64 // ¥/千tokens（如果按 token 计费）
	ImageGenOutputPrice float64 // ¥/千tokens
	ImageGenUnitPrice   float64 // ¥/张（如果按图片张数计费）

	// 文件存储
	FileStorageDir string // 用户上传文件的本地存储路径

	// 匿名用户限制
	GuestDailyChatLimit int     // 匿名用户每日聊天次数限制（0=不限，仅作为金额限制的 fallback）
	GuestDailyCostLimit float64 // 匿名用户每日金额上限（元，0=不限）

	// ========== Document Generation Provider（文档生成：PPT / PDF / Word / Markdown 等，独立配置；为空则自动复用 Chat Provider 的 OpenAI）==========
	DocGenAPIKey      string  // 文档生成 API Key
	DocGenBaseURL     string  // 文档生成 API Base URL
	DocGenModel       string  // 文档生成模型，如 gpt-4o-mini
	DocGenInputPrice  float64 // ¥/千tokens
	DocGenOutputPrice float64 // ¥/千tokens

	// ========== PPT Image Generation Provider（PPT 配图生成，独立配置；为空则自动复用 Vision Provider 的 Qwen）==========
	PPTImageGenAPIKey      string  // PPT 配图生成 API Key
	PPTImageGenBaseURL     string  // PPT 配图生成 API Base URL
	PPTImageGenModel       string  // PPT 配图生成模型，如 qwen-image-2.0-2026-03-03
	PPTImageGenInputPrice  float64 // ¥/千tokens
	PPTImageGenOutputPrice float64 // ¥/千tokens

	// ========== Embedding Provider（文本向量）==========
	EmbeddingInputPrice  float64 // ¥/千tokens
	EmbeddingOutputPrice float64 // ¥/千tokens（通常为 0）
}

func Load() *Config {
	_ = godotenv.Load()

	cfg := &Config{
		BaseURL:      getEnv("BASE_URL", ""),
		Port:         getEnv("PORT", "9091"),
		DatabasePath: getEnv("DATABASE_PATH", "./data/aipool.db"),
		JWTSecret:    getEnv("JWT_SECRET", "your-secret-key-change-in-production"),
		FrontendURL:  getEnv("FRONTEND_URL", "http://localhost:9090"),

		OpenAIKey:         getEnv("OPENAI_API_KEY", ""),
		OpenAIBaseURL:     getEnv("OPENAI_BASE_URL", ""),
		OpenAIOfficialKey: getEnv("OPENAI_OFFICIAL_API_KEY", ""),
		OpenAIInputPrice:  getEnvFloat64("OPENAI_INPUT_PRICE", 0),
		OpenAIOutputPrice: getEnvFloat64("OPENAI_OUTPUT_PRICE", 0),

		AnthropicKey:         getEnv("ANTHROPIC_API_KEY", ""),
		AnthropicBaseURL:     getEnv("ANTHROPIC_BASE_URL", ""),
		AnthropicInputPrice:  getEnvFloat64("ANTHROPIC_INPUT_PRICE", 0),
		AnthropicOutputPrice: getEnvFloat64("ANTHROPIC_OUTPUT_PRICE", 0),

		GeminiKey:         getEnv("GEMINI_API_KEY", ""),
		GeminiBaseURL:     getEnv("GEMINI_BASE_URL", ""),
		GeminiInputPrice:  getEnvFloat64("GEMINI_INPUT_PRICE", 0),
		GeminiOutputPrice: getEnvFloat64("GEMINI_OUTPUT_PRICE", 0),

		DeepSeekKey:         getEnv("DEEPSEEK_API_KEY", ""),
		DeepSeekBaseURL:     getEnv("DEEPSEEK_BASE_URL", ""),
		DeepSeekInputPrice:  getEnvFloat64("DEEPSEEK_INPUT_PRICE", 0),
		DeepSeekOutputPrice: getEnvFloat64("DEEPSEEK_OUTPUT_PRICE", 0),

		MoonshotKey:         getEnv("MOONSHOT_API_KEY", ""),
		MoonshotBaseURL:     getEnv("MOONSHOT_BASE_URL", ""),
		MoonshotInputPrice:  getEnvFloat64("MOONSHOT_INPUT_PRICE", 0),
		MoonshotOutputPrice: getEnvFloat64("MOONSHOT_OUTPUT_PRICE", 0),

		OpenAIMaxOutputTokens:       getEnvInt("OPENAI_MAX_OUTPUT_TOKENS", 8192),
		OpenAIMaxOutputTokensSearch: getEnvInt("OPENAI_MAX_OUTPUT_TOKENS_SEARCH", 6400),
		DeepSeekMaxTokens:           getEnvInt("DEEPSEEK_MAX_TOKENS", 8192),
		AnthropicMaxTokens:          getEnvInt("ANTHROPIC_MAX_TOKENS", 4096),

		BraveSearchKey:  getEnv("BRAVE_SEARCH_KEY", ""),
		TavilySearchKey: getEnv("TAVILY_SEARCH_KEY", ""),
		FileStorageDir:  getEnv("FILE_STORAGE_DIR", "./uploads"),

		GuestDailyChatLimit: getEnvInt("GUEST_DAILY_CHAT_LIMIT", 10),

		VisionAPIKey:      getEnv("VISION_API_KEY", ""),
		VisionBaseURL:     getEnv("VISION_BASE_URL", ""),
		VisionModel:       getEnv("VISION_MODEL", "gpt-5.4-mini"),
		VisionInputPrice:  getEnvFloat64("VISION_INPUT_PRICE", 0),
		VisionOutputPrice: getEnvFloat64("VISION_OUTPUT_PRICE", 0),

		EnableTextEmbedding:     getEnv("ENABLE_TEXT_EMBEDDING", "") == "true",
		TextEmbeddingProvider:   getEnv("TEXT_EMBEDDING_PROVIDER", "openai"),
		TextEmbeddingModel:      getEnv("TEXT_EMBEDDING_MODEL", "text-embedding-v4"),
		TextEmbeddingDimensions: getEnvInt("TEXT_EMBEDDING_DIMENSIONS", 1536),
		TextEmbeddingBatchSize:  getEnvInt("TEXT_EMBEDDING_BATCH_SIZE", 32),
		TextEmbeddingBaseURL:    getEnv("TEXT_EMBEDDING_BASE_URL", ""),
		TextEmbeddingAPIKey:     getEnv("TEXT_EMBEDDING_API_KEY", ""),

		ImageGenAPIKey:      getEnv("IMAGE_GEN_API_KEY", ""),
		ImageGenBaseURL:     getEnv("IMAGE_GEN_BASE_URL", ""),
		ImageGenModel:       getEnv("IMAGE_GEN_MODEL", "gpt-image-2"),
		ImageGenInputPrice:  getEnvFloat64("IMAGE_GEN_INPUT_PRICE", 0),
		ImageGenOutputPrice: getEnvFloat64("IMAGE_GEN_OUTPUT_PRICE", 0),
		ImageGenUnitPrice:   getEnvFloat64("IMAGE_GEN_UNIT_PRICE", 0),

		DocGenAPIKey:      getEnv("DOC_GEN_API_KEY", ""),
		DocGenBaseURL:     getEnv("DOC_GEN_BASE_URL", ""),
		DocGenModel:       getEnv("DOC_GEN_MODEL", "gpt-4o-mini"),
		DocGenInputPrice:  getEnvFloat64("DOC_GEN_INPUT_PRICE", 0),
		DocGenOutputPrice: getEnvFloat64("DOC_GEN_OUTPUT_PRICE", 0),

		PPTImageGenAPIKey:      getEnv("PPT_IMAGE_GEN_API_KEY", ""),
		PPTImageGenBaseURL:     getEnv("PPT_IMAGE_GEN_BASE_URL", ""),
		PPTImageGenModel:       getEnv("PPT_IMAGE_GEN_MODEL", "qwen-image-2.0-2026-03-03"),
		PPTImageGenInputPrice:  getEnvFloat64("PPT_IMAGE_GEN_INPUT_PRICE", 0),
		PPTImageGenOutputPrice: getEnvFloat64("PPT_IMAGE_GEN_OUTPUT_PRICE", 0),

		EmbeddingInputPrice:  getEnvFloat64("EMBEDDING_INPUT_PRICE", 0),
		EmbeddingOutputPrice: getEnvFloat64("EMBEDDING_OUTPUT_PRICE", 0),
	}

	// Text Embedding 未单独配置时，优先复用 Vision Provider（Qwen 系列），其次复用 Chat Provider 的 OpenAI
	if cfg.TextEmbeddingAPIKey == "" {
		cfg.TextEmbeddingAPIKey = cfg.VisionAPIKey
	}
	if cfg.TextEmbeddingAPIKey == "" {
		cfg.TextEmbeddingAPIKey = cfg.OpenAIKey
	}
	if cfg.TextEmbeddingBaseURL == "" {
		cfg.TextEmbeddingBaseURL = cfg.VisionBaseURL
	}
	if cfg.TextEmbeddingBaseURL == "" {
		cfg.TextEmbeddingBaseURL = cfg.OpenAIBaseURL
	}

	// Image Generation 未单独配置时，默认复用 Chat Provider 的 OpenAI
	if cfg.ImageGenAPIKey == "" {
		cfg.ImageGenAPIKey = cfg.OpenAIKey
	}
	if cfg.ImageGenBaseURL == "" {
		cfg.ImageGenBaseURL = cfg.OpenAIBaseURL
	}

	// Document Generation 未单独配置时，默认复用 Chat Provider 的 OpenAI
	if cfg.DocGenAPIKey == "" {
		cfg.DocGenAPIKey = cfg.OpenAIKey
	}
	if cfg.DocGenBaseURL == "" {
		cfg.DocGenBaseURL = cfg.OpenAIBaseURL
	}

	// PPT Image Generation 未单独配置时，默认复用 Vision Provider 的 Qwen（图片生成与 Vision 同为 DashScope 体系）
	if cfg.PPTImageGenAPIKey == "" {
		cfg.PPTImageGenAPIKey = cfg.VisionAPIKey
	}
	if cfg.PPTImageGenAPIKey == "" {
		cfg.PPTImageGenAPIKey = cfg.OpenAIKey
	}
	if cfg.PPTImageGenBaseURL == "" {
		cfg.PPTImageGenBaseURL = cfg.VisionBaseURL
	}
	if cfg.PPTImageGenBaseURL == "" {
		cfg.PPTImageGenBaseURL = cfg.OpenAIBaseURL
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

func getEnvFloat64(key string, defaultValue float64) float64 {
	if value := os.Getenv(key); value != "" {
		var v float64
		_, err := fmt.Sscanf(value, "%f", &v)
		if err == nil && v > 0 {
			return v
		}
	}
	return defaultValue
}
