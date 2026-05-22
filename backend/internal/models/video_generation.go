package models

import "time"

// VideoGeneration 视频生成任务（独立表，不与图片混用）
type VideoGeneration struct {
	ID            uint      `json:"id" gorm:"primaryKey"`
	UserID        uint      `json:"user_id" gorm:"index"`
	Prompt        string    `json:"prompt" gorm:"type:text"`
	Model         string    `json:"model"`                           // 如 doubao-seedance-2-0-fast-260128
	Ratio         string    `json:"ratio"`                           // 16:9, 9:16, 1:1
	Duration      int64     `json:"duration"`                        // 秒
	GenerateAudio bool      `json:"generate_audio"`
	Watermark     bool      `json:"watermark"`
	TaskID        string    `json:"task_id"`                         // 火山引擎返回的任务ID
	Status        string    `json:"status"`                          // pending, running, succeeded, failed
	VideoURL      string    `json:"video_url" gorm:"type:text"`      // 最终视频URL
	ErrorMessage  string    `json:"error_message" gorm:"type:text"`  // 失败原因
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}
