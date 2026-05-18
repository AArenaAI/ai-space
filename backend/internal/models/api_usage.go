package models

import "time"

// APIUsageLog 统一 API 用量/费用记录表
// 所有调用外部 API 的服务（Chat / Vision / Image Gen / Doc Gen / Embedding）都写入此表
// 业务表保留少量冗余字段用于快速展示，但统一账本在此
//goland:noinspection GoUnusedConst
type APIUsageLog struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id" gorm:"index:idx_usage_user"`   // 用户 ID
	GuestID   string    `json:"guest_id" gorm:"size:64;index:idx_usage_guest"` // 匿名用户 ID（UserID=0 时有效）
	Service   string    `json:"service" gorm:"index:idx_usage_svc"`   // 服务类型: chat / vision / image_generation / document_generation / embedding
	Provider  string    `json:"provider"`                              // 提供商: openai / deepseek / anthropic / moonshot / dashscope / unknown
	Model     string    `json:"model"`                                 // 具体模型名（如 gpt-5.5, deepseek-v4-pro, qwen3.5-flash）
	ModelType string    `json:"model_type"`                            // 模型类型: gpt / claude / deepseek / moonshot / gemini / qwen

	ResourceType string `json:"resource_type"` // 资源类型: message / file / image_generation / ppt_generation / embedding_job
	ResourceID   uint   `json:"resource_id"`   // 对应业务表主键

	PromptTokens     int `json:"prompt_tokens"`     // 输入 token 数
	CompletionTokens int `json:"completion_tokens"` // 输出 token 数（图片/嵌入可能为 0）
	TotalTokens      int `json:"total_tokens"`      // 总 token 数

	InputCostRMB  float64 `json:"input_cost_rmb"`  // 输入费用（元）
	OutputCostRMB float64 `json:"output_cost_rmb"` // 输出费用（元）
	TotalCostRMB  float64 `json:"total_cost_rmb"`  // 总费用（元）

	Currency string `json:"currency" gorm:"default:'RMB'"` // 货币，默认 RMB
	Status   string `json:"status"`                        // success / failed / estimated / missing_usage

	ImageCount     int     `json:"image_count"`     // 图片生成张数（仅 image_generation）
	ImageUnitPrice float64 `json:"image_unit_price"` // 单张图片价格（元/张，仅 image_generation）

	Estimated bool `json:"estimated"` // 是否为估算值（API 未返回 usage 时使用 tiktoken 估算）

	RawUsageJSON string `json:"raw_usage_json" gorm:"type:text"` // API 原始返回的 usage JSON（存档用）

	ErrorMessage string `json:"error_message" gorm:"type:text"` // 如果状态为 failed，记录错误信息

	CreatedAt time.Time `json:"created_at" gorm:"index:idx_usage_created"`
	UpdatedAt time.Time `json:"updated_at"`
}

// IsSuccess 判断是否成功记录
func (u *APIUsageLog) IsSuccess() bool {
	return u.Status == "success"
}

// IsEstimated 判断是否为估算
func (u *APIUsageLog) IsEstimated() bool {
	return u.Estimated
}

// TokenCost 计算结果结构体
//goland:noinspection GoUnusedConst
type TokenCost struct {
	InputCost  float64 // 输入费用
	OutputCost float64 // 输出费用
	TotalCost  float64 // 总费用
}

// CalculateTokenCost 根据 token 数和单价计算费用
// price 单位: 元/千 token
func CalculateTokenCost(promptTokens, completionTokens int, inputPricePerK, outputPricePerK float64) TokenCost {
	inputCost := float64(promptTokens) * inputPricePerK / 1000.0
	outputCost := float64(completionTokens) * outputPricePerK / 1000.0
	return TokenCost{
		InputCost:  inputCost,
		OutputCost: outputCost,
		TotalCost:  inputCost + outputCost,
	}
}

// CalculateImageCost 根据图片数量和单价计算费用
func CalculateImageCost(imageCount int, unitPrice float64) float64 {
	return float64(imageCount) * unitPrice
}

// CalculateEmbeddingCost 根据输入 token 数计算嵌入费用（输出 token 为 0）
func CalculateEmbeddingCost(inputTokens int, inputPricePerK float64) float64 {
	return float64(inputTokens) * inputPricePerK / 1000.0
}
