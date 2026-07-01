package models

import "time"

// BetaFeedback 内测用户反馈与优化建议
// 用于收集平台需要修改、优化、新功能建议等反馈。
type BetaFeedback struct {
	ID                  uint      `gorm:"primaryKey" json:"id"`
	UserID              *uint     `gorm:"index" json:"user_id,omitempty"`
	Email               string    `gorm:"size:256;index" json:"email,omitempty"`
	Name                string    `gorm:"size:128" json:"name,omitempty"`
	Category            string    `gorm:"size:64;index" json:"category"`
	Title               string    `gorm:"size:160" json:"title"`
	Content             string    `gorm:"type:text;not null" json:"content"`
	ExpectedImprovement string    `gorm:"type:text" json:"expected_improvement,omitempty"`
	Status              string    `gorm:"size:32;default:'pending';index" json:"status"` // pending | adopted | rejected | archived
	RewardNote          string    `gorm:"type:text" json:"reward_note,omitempty"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

func (BetaFeedback) TableName() string {
	return "beta_feedbacks"
}
