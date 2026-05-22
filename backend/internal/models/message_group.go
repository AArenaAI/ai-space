package models

import (
	"encoding/json"
	"time"
)

// MessageGroup 消息组：同一用户提问下的多个模型回答集合
type MessageGroup struct {
	ID             uint      `gorm:"primarykey" json:"id"`
	ConversationID uint      `gorm:"not null;index" json:"conversation_id"`
	UserMessageID  uint      `gorm:"not null;index" json:"user_message_id"` // 关联的用户提问消息ID
	Models         string    `gorm:"type:text;not null" json:"models"`      // JSON: ["gpt-5.5","claude-4"]
	CreatedAt      time.Time `json:"created_at"`
}

// GetModels 解析 Models JSON
func (g *MessageGroup) GetModels() []string {
	var m []string
	json.Unmarshal([]byte(g.Models), &m)
	return m
}

// SetModels 序列化 Models
func (g *MessageGroup) SetModels(m []string) {
	b, _ := json.Marshal(m)
	g.Models = string(b)
}
