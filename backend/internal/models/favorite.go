package models

import (
	"time"
)

// MessageFavorite 用户收藏的消息
type MessageFavorite struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	UserID    uint      `gorm:"not null;index:idx_user_fav" json:"user_id"`
	MessageID uint      `gorm:"not null;index:idx_user_fav" json:"message_id"` // AI 消息 ID
	GroupID   uint      `gorm:"index" json:"group_id,omitempty"`               // 预留：关联 MessageGroup
	ConvID    uint      `gorm:"not null;index" json:"conv_id"`                 // 所属对话，跳转用
	UserMsgID uint      `gorm:"not null" json:"user_msg_id"`                   // 对应的用户提问
	ModelID   string    `gorm:"size:64" json:"model_id"`                       // 模型标识
	Content   string    `gorm:"type:text" json:"content"`                      // 内容快照
	CreatedAt time.Time `json:"created_at"`
}
