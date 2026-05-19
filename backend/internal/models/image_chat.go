package models

import "time"

// ImageChat AI画图会话（与通用图片编辑功能分离）
type ImageChat struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id" gorm:"index"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ImageChatMessage AI画图会话中的消息
type ImageChatMessage struct {
	ID              uint      `json:"id" gorm:"primaryKey"`
	ChatID          uint      `json:"chat_id" gorm:"index"`
	Role            string    `json:"role"`                           // user, assistant
	Content         string    `json:"content" gorm:"type:text"`       // prompt / text
	ImageURL        string    `json:"image_url"`                      // 最终生成的图片URL
	PartialImageURL string    `json:"partial_image_url"`              // streaming partial image URL
	Status          string    `json:"status"`                         // pending, completed, failed
	ErrorMessage    string    `json:"error_message" gorm:"type:text"` // 失败原因
	CreatedAt       time.Time `json:"created_at"`
}
