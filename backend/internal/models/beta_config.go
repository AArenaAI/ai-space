package models

import "time"

// BetaConfig 内测运营配置表（热更新，不影响会员体系）
type BetaConfig struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Key       string    `gorm:"size:64;uniqueIndex;not null" json:"key"`   // 配置键
	Value     string    `gorm:"type:text;not null" json:"value"`           // 配置值（JSON字符串）
	Desc      string    `gorm:"size:256" json:"desc,omitempty"`            // 描述
	UpdatedBy *uint     `gorm:"index" json:"updated_by,omitempty"`         // 最后修改人
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TableName 指定表名
func (BetaConfig) TableName() string {
	return "beta_configs"
}

// 预定义配置键
const (
	// 三阶段额度配置（单位：分，1积分=100分）
	BetaConfigPhase1Credits = "beta_phase_1_credits"  // 试探期额度（默认 5000 = 50.00积分）
	BetaConfigPhase2Credits = "beta_phase_2_credits"  // 深水区额度（默认 15000 = 150.00积分）
	BetaConfigPhase3Credits = "beta_phase_3_credits"  // 枯竭期额度（默认 10000 = 100.00积分）

	// 模型成本配置（单位：分/次）
	BetaConfigModelCosts = "beta_model_costs" // JSON: {"gpt-5.4-mini":10, "chat-1":2200, ...}
)
