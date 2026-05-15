package models

import (
	"time"

	"gorm.io/gorm"
)

// ConversationShare 对话分享
type ConversationShare struct {
	ID             uint           `gorm:"primarykey" json:"id"`
	Slug           string         `gorm:"uniqueIndex;size:32;not null" json:"slug"`
	ConversationID uint           `gorm:"not null;index" json:"conversation_id"`
	UserID         uint           `gorm:"not null;index" json:"user_id"`
	SelectedMsgs   string         `gorm:"type:text" json:"-"` // JSON 数组，存储选中的 message ID 列表
	Title          string         `json:"title"`
	Model          string         `json:"model"`
	ExpiresAt      *time.Time     `json:"expires_at,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}
