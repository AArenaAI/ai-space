package models

import (
	"time"

	"gorm.io/gorm"
)

type Conversation struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	UserID    uint           `gorm:"not null;index" json:"user_id"`
	Title     string         `json:"title"`
	Model     string         `json:"model"`
	Pinned    bool           `gorm:"default:false" json:"pinned"`
	Compare   bool           `gorm:"default:false" json:"compare"`            // 是否是对比对话
	CompareModels string     `gorm:"type:text" json:"compare_models,omitempty"` // JSON 数组，对比选用的模型列表
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	Messages []Message `json:"messages,omitempty" gorm:"foreignKey:ConversationID"`
}

type Message struct {
	ID             uint           `gorm:"primarykey" json:"id"`
	ConversationID uint           `gorm:"not null;index" json:"conversation_id"`
	Role           string         `gorm:"not null" json:"role"` // user / assistant / system
	Content        string         `gorm:"not null" json:"content"`
	Model          string         `json:"model"`
	TokensUsed     int            `json:"tokens_used"`
	CreatedAt      time.Time      `json:"created_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}
