package models

import "time"

// APIUsageLog 统一 API 用量/费用记录表
// 所有调用外部 API 的服务（Chat / Vision / Image Gen / Doc Gen / Embedding）都写入此表
// 业务表保留少量冗余字段用于快速展示，但统一账本在此。
type APIUsageLog struct {
	ID      uint   `json:"id" gorm:"primaryKey"`
	UserID  uint   `json:"user_id" gorm:"index:idx_usage_user"`           // 用户 ID
	GuestID string `json:"guest_id" gorm:"size:64;index:idx_usage_guest"` // 匿名用户 ID（UserID=0 时有效）

	Service   string `json:"service" gorm:"index:idx_usage_svc"` // chat / vision / image_generation / document_generation / embedding / search / video_generation
	Provider  string `json:"provider" gorm:"index"`              // openai / deepseek / anthropic / moonshot / dashscope / unknown
	Model     string `json:"model" gorm:"index"`                 // 具体模型名
	ModelType string `json:"model_type"`                         // gpt / claude / deepseek / moonshot / gemini / qwen / embedding

	// 通用业务资源追踪。
	ResourceType string `json:"resource_type" gorm:"index"` // message / file / image_generation / ppt_generation / embedding_job
	ResourceID   uint   `json:"resource_id" gorm:"index"`   // 对应业务表主键

	// Usage v2 追踪维度：用于 admin 按对话/消息/任务/空间精确聚合。
	ConversationID uint `json:"conversation_id" gorm:"index"`
	MessageID      uint `json:"message_id" gorm:"index"`
	TaskID         uint `json:"task_id" gorm:"index"`
	WorkspaceID    uint `json:"workspace_id" gorm:"index"`
	NotebookID     uint `json:"notebook_id" gorm:"index"`

	PromptTokens     int `json:"prompt_tokens"`     // 输入 token 数
	CompletionTokens int `json:"completion_tokens"` // 输出 token 数（图片/嵌入可能为 0）
	TotalTokens      int `json:"total_tokens"`      // 总 token 数

	// 非 token 型消耗单位。
	ImageCount     int `json:"image_count"`     // 图片生成张数
	VideoSeconds   int `json:"video_seconds"`   // 视频秒数
	AudioSeconds   int `json:"audio_seconds"`   // 音频秒数
	CharacterCount int `json:"character_count"` // 字符数

	InputCostRMB  float64 `json:"input_cost_rmb"`  // 输入费用（元）
	OutputCostRMB float64 `json:"output_cost_rmb"` // 输出费用（元）
	TotalCostRMB  float64 `json:"total_cost_rmb"`  // 总费用（元）

	Currency string `json:"currency" gorm:"default:'RMB'"` // 货币，默认 RMB
	Status   string `json:"status" gorm:"index"`           // success / failed / estimated / missing_usage / cancelled / ignored

	// 价格快照，避免之后改配置/汇率导致历史成本不可追溯。
	PricingUnit        string  `json:"pricing_unit"` // token_1k / image / request / video_second / character
	UnitCount          float64 `json:"unit_count"`
	InputUnitPriceRMB  float64 `json:"input_unit_price_rmb"`
	OutputUnitPriceRMB float64 `json:"output_unit_price_rmb"`
	ImageUnitPrice     float64 `json:"image_unit_price"` // 兼容旧字段：单张图片价格（元/张）
	ImageUnitPriceRMB  float64 `json:"image_unit_price_rmb"`

	SourceCurrency            string  `json:"source_currency" gorm:"size:16"` // 原始官方定价币种：USD/CNY
	SourceUnit                string  `json:"source_unit" gorm:"size:32"`     // per_1m_tokens / per_image / per_request
	SourceInputPrice          float64 `json:"source_input_price"`
	SourceInputCacheHitPrice  float64 `json:"source_input_cache_hit_price"`
	SourceInputCacheMissPrice float64 `json:"source_input_cache_miss_price"`
	SourceOutputPrice         float64 `json:"source_output_price"`
	SourceImagePrice          float64 `json:"source_image_price"`
	SourceRequestPrice        float64 `json:"source_request_price"`
	ExchangeRateToRMB         float64 `json:"exchange_rate_to_rmb"` // 当次统一折算到 RMB 的汇率快照

	Estimated bool `json:"estimated"` // 是否为估算值（API 未返回 usage 时使用估算）

	LatencyMs    int    `json:"latency_ms"`
	RequestID    string `json:"request_id" gorm:"size:128;index"`
	ErrorCode    string `json:"error_code" gorm:"size:128"`
	ErrorMessage string `json:"error_message" gorm:"type:text"`

	RawUsageJSON string `json:"raw_usage_json" gorm:"type:text"` // API 原始返回的 usage JSON（存档用）

	CreatedAt time.Time `json:"created_at" gorm:"index:idx_usage_created"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (u *APIUsageLog) IsSuccess() bool   { return u.Status == "success" }
func (u *APIUsageLog) IsEstimated() bool { return u.Estimated }

type TokenCost struct {
	InputCost  float64
	OutputCost float64
	TotalCost  float64
}

func CalculateTokenCost(promptTokens, completionTokens int, inputPricePerK, outputPricePerK float64) TokenCost {
	inputCost := float64(promptTokens) * inputPricePerK / 1000.0
	outputCost := float64(completionTokens) * outputPricePerK / 1000.0
	return TokenCost{InputCost: inputCost, OutputCost: outputCost, TotalCost: inputCost + outputCost}
}

func CalculateImageCost(imageCount int, unitPrice float64) float64 {
	return float64(imageCount) * unitPrice
}

func CalculateEmbeddingCost(inputTokens int, inputPricePerK float64) float64 {
	return float64(inputTokens) * inputPricePerK / 1000.0
}
