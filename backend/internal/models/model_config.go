package models

import "time"

// ModelConfig 存储管理员可动态配置的模型开关与覆盖设置。
// 代码中的 modelmeta.SupportedModels 是源数据；此表只存覆盖项。
type ModelConfig struct {
	ID          uint      `gorm:"primarykey" json:"id"`
	ModelID     string    `gorm:"uniqueIndex;not null" json:"model_id"`
	Enabled     bool      `gorm:"default:true" json:"enabled"`
	Tier        string    `gorm:"default:''" json:"tier"`
	Status      string    `gorm:"default:''" json:"status"`       // 覆盖状态：available / disabled / maintenance / quota_exhausted / rate_limited
	StatusMsg   string    `gorm:"default:''" json:"status_message"` // 覆盖状态说明
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
