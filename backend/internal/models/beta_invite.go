package models

import "time"

// BetaInvite 内测邀请码
type BetaInvite struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Code        string    `gorm:"size:32;uniqueIndex;not null" json:"code"` // 邀请码
	Email       string    `gorm:"size:256;index" json:"email,omitempty"`    // 预设邮箱（可选）
	Status      string    `gorm:"size:32;default:'unused'" json:"status"` // unused | used | revoked
	UserID      *uint     `gorm:"index" json:"user_id,omitempty"`           // 使用者的用户ID
	UsedAt      *time.Time `json:"used_at,omitempty"`
	Batch       string    `gorm:"size:32;index" json:"batch"`                // 批次：batch-1, batch-2, batch-3
	Industry    string    `gorm:"size:64" json:"industry,omitempty"`          // 行业标签
	CreditsBasic     int `gorm:"default:50" json:"credits_basic"`         // 初始基础积分
	CreditsAdvanced  int `gorm:"default:0" json:"credits_advanced"`       // 初始高级积分
	CreditsElite     int `gorm:"default:0" json:"credits_elite"`          // 初始精英积分
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// TableName 指定表名
func (BetaInvite) TableName() string {
	return "beta_invites"
}

// BetaApplication 内测申请表
type BetaApplication struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	Email            string    `gorm:"size:256;not null;index" json:"email"`
	Name             string    `gorm:"size:128" json:"name"`
	Industry         string    `gorm:"size:64" json:"industry"`           // 金融/算法/自媒体/高级UI/其他
	JobTitle         string    `gorm:"size:128" json:"job_title"`         // 职位
	UseCase          string    `gorm:"type:text" json:"use_case"`         // 使用场景描述
	BadCaseSample    string    `gorm:"type:text" json:"bad_case_sample"`  // 已有的 Bad Case 示例
	ExperienceLevel  string    `gorm:"size:32" json:"experience_level"`   // beginner | intermediate | expert
	Status           string    `gorm:"size:32;default:'pending'" json:"status"` // pending | approved | rejected
	InviteCode       string    `gorm:"size:32" json:"invite_code,omitempty"`    // 分配的邀请码
	AdminID          *uint     `gorm:"index" json:"admin_id,omitempty"`
	ReviewNote       string    `gorm:"type:text" json:"review_note,omitempty"`
	ReviewedAt       *time.Time `json:"reviewed_at,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// TableName 指定表名
func (BetaApplication) TableName() string {
	return "beta_applications"
}
