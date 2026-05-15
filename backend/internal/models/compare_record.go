package models

import (
	"time"

	"gorm.io/gorm"
)

// CompareRecord 对比记录
type CompareRecord struct {
	ID       uint           `gorm:"primarykey" json:"id"`
	UserID   uint           `gorm:"not null;index" json:"user_id"`
	Query    string         `gorm:"not null" json:"query"`
	Models   string         `gorm:"type:text;not null" json:"models"`    // JSON 数组: ["deepseek-v4-pro","deepseek-reasoner"]
	Results  string         `gorm:"type:text;not null" json:"-"`         // JSON: [{"model_id":"...","content":"..."}]
	Slug     string         `gorm:"uniqueIndex;size:32;not null" json:"slug"`
	CreatedAt time.Time     `json:"created_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}
