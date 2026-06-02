package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	// 基础服务配置
	BaseURL     string
	Port        string
	DatabaseURL string
	JWTSecret   string
	FrontendURL string

	// ========== Google Cloud Translation（专用翻译 API，后端服务账号认证）==========
	GoogleCloudProjectID    string
	GoogleTranslateLocation string
	GoogleTranslateModel    string

	// ========== Chat Provider（对话模型，支持 OpenAI / Anthropic / Gemini / DeepSeek / Moonshot 多路并行）==========
	OpenAIKey            string
	OpenAIBaseURL        string  // 自定义 OpenAI 兼容 API 基础地址（用于中转/逆向）
	OpenAIOfficialKey    string  // OpenAI 官方 API Key（直连，不走中转）
	OpenAIWebhookSecret  string  // OpenAI Webhook signing secret（whsec_...）
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
	OpenAIMaxOutputTokens                   int // OpenAI Responses API 基础输出 token 上限（默认 8192）
	OpenAIMaxOutputTokensSearch             int // OpenAI 开启搜索时的输出 token 上限（默认 6400）
	OpenAIMaxOutputTokensDeep               int // OpenAI 深度思考输出 token 上限（默认继承 OPENAI_MAX_OUTPUT_TOKENS）
	OpenAIMaxOutputTokensDeepSearch         int // OpenAI 深度思考+搜索输出 token 上限（默认继承 OPENAI_MAX_OUTPUT_TOKENS_SEARCH）
	OpenAIGPT55ProMaxOutputTokens           int // GPT-5.5 Pro 普通输出上限
	OpenAIGPT55ProMaxOutputTokensSearch     int // GPT-5.5 Pro 搜索输出上限
	OpenAIGPT55ProMaxOutputTokensDeep       int // GPT-5.5 Pro 深度思考输出上限
	OpenAIGPT55ProMaxOutputTokensDeepSearch int // GPT-5.5 Pro 深度思考+搜索输出上限
	OpenAIGPT55ProMaxConcurrency            int // GPT-5.5 Pro 本机并发上限
	OpenAIGPT55ProTPMSoftLimit              int // GPT-5.5 Pro 本机 TPM 软预算
	DeepSeekMaxTokens                       int // DeepSeek 输出 token 上限（默认 8192，之前未设置导致用了 API 默认值）
	AnthropicMaxTokens                      int // Anthropic 输出 token 上限（默认 4096）

	// 联网搜索（对应 Chat Provider 的 web_search 工具，独立配置）
	BraveSearchKey  string
	TavilySearchKey string

	// ========== Vision Provider（图片解析，独立配置；为空则自动复用 Chat Provider 的 OpenAI）==========
	VisionAPIKey            string  // Vision API Key
	VisionBaseURL           string  // Vision API Base URL
	VisionModel             string  // 用于图片解析的 Vision 模型
	VisionInputPrice        float64 // ¥/千tokens，输入单价
	VisionOutputPrice       float64 // ¥/千tokens，输出单价
	VisionDocEnable         bool    // 是否启用 PDF/DOCX/PPTX 文档视觉解析增强
	VisionDocTimeoutSeconds int     // 文档视觉解析总超时秒数
	VisionDocMaxFileMB      int     // 文档视觉解析最大文件大小（MB）

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

	// ========== Volcengine Video Generation Provider（火山引擎视频生成）==========
	VolcengineAPIKey  string  // 火山引擎 Ark API Key
	VolcengineBaseURL string  // 火山引擎 Ark Base URL（默认 https://ark.cn-beijing.volces.com/api/v3）
	VideoGenUnitPrice float64 // ¥/次（按次计费）

	// ========== Embedding Provider（文本向量）==========
	EmbeddingInputPrice  float64 // ¥/千tokens
	EmbeddingOutputPrice float64 // ¥/千tokens（通常为 0）

	// ========== Model-level pricing（模型级成本，优先于 provider 级价格）==========
	// key 格式：provider:model，全部小写。价格单位为人民币：token_1k 表示 ¥/千 tokens，image 表示 ¥/张。
	ModelPrices map[string]ModelPrice
}

type ModelPrice struct {
	Provider         string  `json:"provider"`
	Model            string  `json:"model"`
	PricingUnit      string  `json:"pricing_unit"`
	InputPriceRMB    float64 `json:"input_price_rmb"`
	OutputPriceRMB   float64 `json:"output_price_rmb"`
	ImageUnitPrice   float64 `json:"image_unit_price_rmb"`
	VideoUnitPrice   float64 `json:"video_unit_price_rmb"`
	RequestUnitPrice float64 `json:"request_unit_price_rmb"`
}

func Load() *Config {
	_ = godotenv.Load()

	cfg := &Config{
		BaseURL:     getEnv("BASE_URL", ""),
		Port:        getEnv("PORT", "9091"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://aipool:***@localhost:5432/aipool?sslmode=disable"),
		JWTSecret:   getEnv("JWT_SECRET", "your-secret-key-change-in-production"),
		FrontendURL: getEnv("FRONTEND_URL", "http://localhost:9090"),

		GoogleCloudProjectID:    getEnv("GOOGLE_CLOUD_PROJECT_ID", ""),
		GoogleTranslateLocation: getEnv("GOOGLE_TRANSLATE_LOCATION", "global"),
		GoogleTranslateModel:    getEnv("GOOGLE_TRANSLATE_MODEL", "general/nmt"),

		OpenAIKey:           getEnv("OPENAI_API_KEY", ""),
		OpenAIBaseURL:       getEnv("OPENAI_BASE_URL", ""),
		OpenAIOfficialKey:   getEnv("OPENAI_OFFICIAL_API_KEY", ""),
		OpenAIWebhookSecret: getEnv("OPENAI_WEBHOOK_SECRET", ""),
		OpenAIInputPrice:    getEnvFloat64("OPENAI_INPUT_PRICE", 0),
		OpenAIOutputPrice:   getEnvFloat64("OPENAI_OUTPUT_PRICE", 0),

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

		OpenAIMaxOutputTokens:                   getEnvInt("OPENAI_MAX_OUTPUT_TOKENS", 8192),
		OpenAIMaxOutputTokensSearch:             getEnvInt("OPENAI_MAX_OUTPUT_TOKENS_SEARCH", 6400),
		OpenAIMaxOutputTokensDeep:               getEnvInt("OPENAI_MAX_OUTPUT_TOKENS_DEEP", getEnvInt("OPENAI_MAX_OUTPUT_TOKENS", 8192)),
		OpenAIMaxOutputTokensDeepSearch:         getEnvInt("OPENAI_MAX_OUTPUT_TOKENS_DEEP_SEARCH", getEnvInt("OPENAI_MAX_OUTPUT_TOKENS_SEARCH", 6400)),
		OpenAIGPT55ProMaxOutputTokens:           getEnvInt("OPENAI_GPT55_PRO_MAX_OUTPUT_TOKENS", getEnvInt("OPENAI_MAX_OUTPUT_TOKENS", 8192)),
		OpenAIGPT55ProMaxOutputTokensSearch:     getEnvInt("OPENAI_GPT55_PRO_MAX_OUTPUT_TOKENS_SEARCH", getEnvInt("OPENAI_MAX_OUTPUT_TOKENS_SEARCH", 6400)),
		OpenAIGPT55ProMaxOutputTokensDeep:       getEnvInt("OPENAI_GPT55_PRO_MAX_OUTPUT_TOKENS_DEEP", getEnvInt("OPENAI_MAX_OUTPUT_TOKENS_DEEP", getEnvInt("OPENAI_MAX_OUTPUT_TOKENS", 8192))),
		OpenAIGPT55ProMaxOutputTokensDeepSearch: getEnvInt("OPENAI_GPT55_PRO_MAX_OUTPUT_TOKENS_DEEP_SEARCH", getEnvInt("OPENAI_MAX_OUTPUT_TOKENS_DEEP_SEARCH", getEnvInt("OPENAI_MAX_OUTPUT_TOKENS_SEARCH", 6400))),
		OpenAIGPT55ProMaxConcurrency:            getEnvInt("OPENAI_GPT55_PRO_MAX_CONCURRENCY", 1),
		OpenAIGPT55ProTPMSoftLimit:              getEnvInt("OPENAI_GPT55_PRO_TPM_SOFT_LIMIT", 0),
		DeepSeekMaxTokens:                       getEnvInt("DEEPSEEK_MAX_TOKENS", 8192),
		AnthropicMaxTokens:                      getEnvInt("ANTHROPIC_MAX_TOKENS", 4096),

		BraveSearchKey:  getEnv("BRAVE_SEARCH_KEY", ""),
		TavilySearchKey: getEnv("TAVILY_SEARCH_KEY", ""),
		FileStorageDir:  getEnv("FILE_STORAGE_DIR", "./uploads"),

		GuestDailyChatLimit: getEnvInt("GUEST_DAILY_CHAT_LIMIT", 10),

		VisionAPIKey:            getEnv("VISION_API_KEY", ""),
		VisionBaseURL:           getEnv("VISION_BASE_URL", ""),
		VisionModel:             getEnv("VISION_MODEL", "gpt-5.4-mini"),
		VisionInputPrice:        getEnvFloat64("VISION_INPUT_PRICE", 0),
		VisionOutputPrice:       getEnvFloat64("VISION_OUTPUT_PRICE", 0),
		VisionDocEnable:         getEnv("VISION_DOC_ENABLE", "true") == "true",
		VisionDocTimeoutSeconds: getEnvInt("VISION_DOC_TIMEOUT_SECONDS", 180),
		VisionDocMaxFileMB:      getEnvInt("VISION_DOC_MAX_FILE_MB", 20),

		EnableTextEmbedding:     getEnv("ENABLE_TEXT_EMBEDDING", "") == "true",
		TextEmbeddingProvider:   getEnv("TEXT_EMBEDDING_PROVIDER", "openai"),
		TextEmbeddingModel:      getEnv("TEXT_EMBEDDING_MODEL", "text-embedding-v4"),
		TextEmbeddingDimensions: getEnvInt("TEXT_EMBEDDING_DIMENSIONS", 1536),
		TextEmbeddingBatchSize:  getEnvInt("TEXT_EMBEDDING_BATCH_SIZE", 10),
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

		VolcengineAPIKey:  getEnv("VOLCENGINE_API_KEY", ""),
		VolcengineBaseURL: getEnv("VOLCENGINE_BASE_URL", ""),
		VideoGenUnitPrice: getEnvFloat64("VIDEO_GEN_UNIT_PRICE", 0),

		EmbeddingInputPrice:  getEnvFloat64("EMBEDDING_INPUT_PRICE", 0),
		EmbeddingOutputPrice: getEnvFloat64("EMBEDDING_OUTPUT_PRICE", 0),
	}
	cfg.ModelPrices = loadModelPrices()

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

	// Image Generation 未单独配置时，默认复用 OpenAI 官方配置；不再回退 OPENAI_BASE_URL 中转，避免 AI 画图误走代理。
	if cfg.ImageGenAPIKey == "" {
		cfg.ImageGenAPIKey = cfg.OpenAIOfficialKey
	}
	if cfg.ImageGenAPIKey == "" {
		cfg.ImageGenAPIKey = cfg.OpenAIKey
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

func normalizeModelPriceKey(provider, model string) string {
	return strings.ToLower(strings.TrimSpace(provider)) + ":" + strings.ToLower(strings.TrimSpace(model))
}

func modelPriceEnvPrefix(provider, model string) string {
	raw := strings.ToUpper(strings.TrimSpace(provider) + "_" + strings.TrimSpace(model))
	var b strings.Builder
	lastUnderscore := false
	for _, r := range raw {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			b.WriteByte('_')
			lastUnderscore = true
		}
	}
	return "MODEL_PRICE_" + strings.Trim(b.String(), "_")
}

func loadModelPrices() map[string]ModelPrice {
	prices := map[string]ModelPrice{}
	if raw := strings.TrimSpace(os.Getenv("MODEL_PRICES_JSON")); raw != "" {
		var list []ModelPrice
		if err := json.Unmarshal([]byte(raw), &list); err == nil {
			for _, price := range list {
				addModelPrice(prices, price)
			}
		} else {
			var keyed map[string]ModelPrice
			if err := json.Unmarshal([]byte(raw), &keyed); err == nil {
				for key, price := range keyed {
					if price.Provider == "" || price.Model == "" {
						parts := strings.SplitN(key, ":", 2)
						if len(parts) == 2 {
							if price.Provider == "" {
								price.Provider = parts[0]
							}
							if price.Model == "" {
								price.Model = parts[1]
							}
						}
					}
					addModelPrice(prices, price)
				}
			}
		}
	}
	for _, provider := range []string{"openai", "anthropic", "gemini", "deepseek", "moonshot", "volcengine"} {
		for _, model := range knownModelsForProvider(provider) {
			prefix := modelPriceEnvPrefix(provider, model)
			price := ModelPrice{Provider: provider, Model: model}
			price.PricingUnit = getEnv(prefix+"_PRICING_UNIT", "")
			price.InputPriceRMB = getEnvFloat64(prefix+"_INPUT", 0)
			price.OutputPriceRMB = getEnvFloat64(prefix+"_OUTPUT", 0)
			price.ImageUnitPrice = getEnvFloat64(prefix+"_IMAGE", 0)
			price.VideoUnitPrice = getEnvFloat64(prefix+"_VIDEO", 0)
			price.RequestUnitPrice = getEnvFloat64(prefix+"_REQUEST", 0)
			addModelPrice(prices, price)
		}
	}
	return prices
}

func addModelPrice(prices map[string]ModelPrice, price ModelPrice) {
	provider := strings.TrimSpace(price.Provider)
	model := strings.TrimSpace(price.Model)
	if provider == "" || model == "" {
		return
	}
	if price.PricingUnit == "" {
		if price.ImageUnitPrice > 0 {
			price.PricingUnit = "image"
		} else if price.VideoUnitPrice > 0 {
			price.PricingUnit = "video_second"
		} else if price.RequestUnitPrice > 0 {
			price.PricingUnit = "request"
		} else {
			price.PricingUnit = "token_1k"
		}
	}
	if price.InputPriceRMB <= 0 && price.OutputPriceRMB <= 0 && price.ImageUnitPrice <= 0 && price.VideoUnitPrice <= 0 && price.RequestUnitPrice <= 0 {
		return
	}
	price.Provider = strings.ToLower(provider)
	price.Model = strings.ToLower(model)
	prices[normalizeModelPriceKey(price.Provider, price.Model)] = price
}

func knownModelsForProvider(provider string) []string {
	switch strings.ToLower(provider) {
	case "openai":
		return []string{"gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "gpt-5.5-pro", "gpt-image-2"}
	case "gemini":
		return []string{"gemini-2.5-pro", "gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-3.1-flash-lite"}
	case "deepseek":
		return []string{"deepseek-v4-pro", "deepseek-v4-flash"}
	case "moonshot":
		return []string{"kimi-k2.5", "kimi-k2.6"}
	case "volcengine":
		return []string{"doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-260128"}
	default:
		return nil
	}
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
