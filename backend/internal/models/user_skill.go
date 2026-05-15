package models

import (
	"time"

	"gorm.io/gorm"
)

// UserSkill 用户自定义技能
type UserSkill struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UserID      uint           `gorm:"not null;index" json:"user_id"`
	Key         string         `gorm:"not null;size:64" json:"key"`          // 技能唯一 key
	DisplayName string         `gorm:"not null;size:128" json:"display_name"` // 显示名称
	Description string         `gorm:"type:text" json:"description"`           // 描述
	Category    string         `gorm:"size:64" json:"category"`               // 分类
	Content     string         `gorm:"type:text" json:"content"`              // SKILL.md 内容
	Icon        string         `gorm:"size:64" json:"icon"`                   // 图标
	Color       string         `gorm:"size:32" json:"color"`                  // 颜色
	Enabled     bool           `gorm:"default:true" json:"enabled"`           // 是否启用
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}
