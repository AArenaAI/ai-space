package models

import "time"

// VideoGeneration 视频生成任务（独立表，不与图片混用）
type VideoGeneration struct {
	ID                  uint      `json:"id" gorm:"primaryKey"`
	UserID              uint      `json:"user_id" gorm:"index"`
	Prompt              string    `json:"prompt" gorm:"type:text"`
	Model               string    `json:"model"`      // 如 doubao-seedance-2-0-fast-260128
	Ratio               string    `json:"ratio"`      // 16:9, 9:16, 1:1
	Resolution          string    `json:"resolution"` // 480p, 720p, 1080p
	Duration            int64     `json:"duration"`   // 秒
	GenerateAudio       bool      `json:"generate_audio"`
	Watermark           bool      `json:"watermark"`
	ReferenceImageCount int       `json:"reference_image_count"`
	ReferenceVideoCount int       `json:"reference_video_count"`
	TaskID              string    `json:"task_id"`                         // 火山引擎返回的任务ID
	ChatID              uint      `json:"chat_id" gorm:"index"`            // 关联视频会话
	MessageID           uint      `json:"message_id" gorm:"index"`         // 关联视频会话 assistant 消息
	Status              string    `json:"status"`                          // pending, running, succeeded, failed
	VideoURL            string    `json:"video_url" gorm:"type:text"`      // 最终视频URL
	LastFrameURL        string    `json:"last_frame_url" gorm:"type:text"` // 方舟返回的视频尾帧URL，用于连续视频首帧衔接
	ErrorMessage        string    `json:"error_message" gorm:"type:text"`  // 失败原因
	UsageRecorded       bool      `json:"usage_recorded" gorm:"index"`     // 是否已写入统一用量账本
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}
