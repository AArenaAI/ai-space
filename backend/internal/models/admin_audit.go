package models

import "time"

// AdminAuditLog records sensitive backoffice operations for accountability.
type AdminAuditLog struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	OperatorID uint      `gorm:"index" json:"operator_id"`
	Action     string    `gorm:"size:96;index" json:"action"`
	TargetType string    `gorm:"size:64;index" json:"target_type"`
	TargetID   string    `gorm:"size:128;index" json:"target_id"`
	BeforeJSON string    `gorm:"type:text" json:"before_json,omitempty"`
	AfterJSON  string    `gorm:"type:text" json:"after_json,omitempty"`
	IP         string    `gorm:"size:64" json:"ip"`
	UserAgent  string    `gorm:"type:text" json:"user_agent"`
	CreatedAt  time.Time `gorm:"index" json:"created_at"`
}
