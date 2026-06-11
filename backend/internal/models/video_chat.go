package models

import "time"

// VideoChat AI视频会话
// 与单条 VideoGeneration 任务分离，用于支持同一聊天框内连续生成视频。
type VideoChat struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id" gorm:"index"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// VideoChatMessage AI视频会话中的消息
type VideoChatMessage struct {
	ID                  uint      `json:"id" gorm:"primaryKey"`
	ChatID              uint      `json:"chat_id" gorm:"index"`
	Role                string    `json:"role"`                            // user, assistant
	Content             string    `json:"content" gorm:"type:text"`        // prompt / text
	Status              string    `json:"status"`                          // pending, running, succeeded, completed, failed
	ErrorMessage        string    `json:"error_message" gorm:"type:text"`  // 失败原因
	VideoURL            string    `json:"video_url" gorm:"type:text"`      // 最终生成的视频URL
	LastFrameURL        string    `json:"last_frame_url" gorm:"type:text"` // 方舟返回的视频尾帧URL，用于连续视频首帧衔接
	Model               string    `json:"model"`
	Ratio               string    `json:"ratio"`
	Resolution          string    `json:"resolution"`
	Duration            int64     `json:"duration"`
	GenerateAudio       bool      `json:"generate_audio"`
	Watermark           bool      `json:"watermark"`
	ReferenceImageCount int       `json:"reference_image_count"`
	ReferenceVideoCount int       `json:"reference_video_count"`
	TaskID              string    `json:"task_id"`
	GenerationID        uint      `json:"generation_id" gorm:"index"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}
