package models

import (
	"time"

	"gorm.io/gorm"
)

// AIBackgroundTask 记录 OpenAI Responses background=true 任务与本地会话消息的映射。
// Webhook 只会带 response id，必须靠这张表把最终结果写回对应 conversation/message。
type AIBackgroundTask struct {
	ID                 uint           `gorm:"primarykey" json:"id"`
	ResponseID         string         `gorm:"uniqueIndex;size:128;not null" json:"response_id"`
	UserID             uint           `gorm:"index" json:"user_id"`
	GuestID            string         `gorm:"index;size:64" json:"guest_id"`
	ConversationID     uint           `gorm:"not null;index" json:"conversation_id"`
	AssistantMessageID uint           `gorm:"index" json:"assistant_message_id"`
	Model              string         `gorm:"size:128" json:"model"`
	Provider           string         `gorm:"size:32" json:"provider"`
	Status             string         `gorm:"size:32;index" json:"status"` // running | streaming | retrying | completed | failed | cancelled | incomplete
	LastSequenceNumber int64          `json:"last_sequence_number"`
	StatusTimeline     string         `gorm:"type:text" json:"status_timeline,omitempty"`
	Result             string         `gorm:"type:text" json:"result,omitempty"`
	ErrorMessage       string         `gorm:"type:text" json:"error_message,omitempty"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
	CompletedAt        *time.Time     `json:"completed_at,omitempty"`
	DeletedAt          gorm.DeletedAt `gorm:"index" json:"-"`
}
