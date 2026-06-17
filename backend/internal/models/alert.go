package models

import "time"

// AlertRule 告警规则表
type AlertRule struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"size:64;not null" json:"name"`           // 规则名称
	EventType   string    `gorm:"size:32;index" json:"event_type"`        // 监控事件类型：error/credit_use/chat_complete等
	Metric      string    `gorm:"size:32;not null" json:"metric"`         // 指标：error_rate/count/latency
	Threshold   float64   `gorm:"not null" json:"threshold"`              // 阈值
	WindowMin   int       `gorm:"default:5" json:"window_min"`            // 时间窗口（分钟）
	Enabled     bool      `gorm:"default:true" json:"enabled"`            // 是否启用
	NotifyEmail string    `gorm:"size:128" json:"notify_email"`         // 通知邮箱
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

// AlertHistory 告警历史记录表
type AlertHistory struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	RuleID      uint      `gorm:"index" json:"rule_id"`                   // 触发规则ID
	RuleName    string    `gorm:"size:64" json:"rule_name"`               // 规则名称（快照）
	EventType   string    `gorm:"size:32" json:"event_type"`              // 事件类型
	Metric      string    `gorm:"size:32" json:"metric"`                  // 指标
	Value       float64   `json:"value"`                                  // 实际值
	Threshold   float64   `json:"threshold"`                              // 阈值
	Status      string    `gorm:"size:16;default:'firing'" json:"status"` // firing/resolved
	Message     string    `gorm:"type:text" json:"message"`               // 告警内容
	ResolvedAt  *time.Time `json:"resolved_at"`                           // 恢复时间
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// AlertSilence 告警静默配置
type AlertSilence struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	RuleID    uint      `gorm:"index" json:"rule_id"`                   // 规则ID，0=全局
	StartAt   time.Time `json:"start_at"`                                 // 静默开始
	EndAt     time.Time `json:"end_at"`                                   // 静默结束
	Reason    string    `gorm:"size:128" json:"reason"`                   // 静默原因
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}
