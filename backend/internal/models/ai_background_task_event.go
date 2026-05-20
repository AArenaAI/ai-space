package models

import (
	"time"

	"gorm.io/gorm"
)

// AIBackgroundTaskEvent 记录一条 assistant 生成过程中已经转发给前端的 SSE 数据。
// 前端断线/切换页面后，可按 assistant_message_id + sequence 续流，不再只能 2s 轮询整条 message。
type AIBackgroundTaskEvent struct {
	ID                 uint           `gorm:"primarykey" json:"id"`
	TaskID             uint           `gorm:"index" json:"task_id"`
	ResponseID         string         `gorm:"index;size:128" json:"response_id"`
	ConversationID     uint           `gorm:"not null;index" json:"conversation_id"`
	AssistantMessageID uint           `gorm:"not null;index:idx_task_event_message_seq" json:"assistant_message_id"`
	SequenceNumber     int64          `gorm:"index:idx_task_event_message_seq" json:"sequence_number"`
	EventType          string         `gorm:"size:64;index" json:"event_type"`
	Payload            string         `gorm:"type:text;not null" json:"payload"`
	CreatedAt          time.Time      `json:"created_at"`
	DeletedAt          gorm.DeletedAt `gorm:"index" json:"-"`
}
