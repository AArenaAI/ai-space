package models

import "time"

// ModelConfig 存储管理员可动态配置的模型开关与覆盖设置。
// 代码中的 modelmeta.SupportedModels 是源数据；此表只存覆盖项。
type ModelConfig struct {
	ID             uint      `gorm:"primarykey" json:"id"`
	ModelID        string    `gorm:"uniqueIndex;not null" json:"model_id"`
	Enabled        bool      `gorm:"default:true" json:"enabled"`
	Tier           string    `gorm:"default:''" json:"tier"`
	ReasoningLevel string    `gorm:"default:'thinking'" json:"reasoning_level"` // 对外三档：fast / thinking / expert
	// Reasoning 三档到 provider 官方等级的自定义映射。空值时使用代码默认映射。
	ReasoningFastValue    string `gorm:"default:''" json:"reasoning_fast_value"`
	ReasoningThinkingValue string `gorm:"default:''" json:"reasoning_thinking_value"`
	ReasoningExpertValue  string `gorm:"default:''" json:"reasoning_expert_value"`
	Status         string    `gorm:"default:''" json:"status"`                  // 覆盖状态：available / disabled / maintenance / quota_exhausted / rate_limited
	StatusMsg      string    `gorm:"default:''" json:"status_message"`          // 覆盖状态说明
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}
