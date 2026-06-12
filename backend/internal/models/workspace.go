package models

import (
	"time"

	"gorm.io/gorm"
)

// Workspace 工作区——项目级工作空间
type Workspace struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	UserID    uint           `gorm:"not null;index" json:"user_id"`
	Name      string         `gorm:"not null;size:128;default:'默认工作区'" json:"name"`
	Icon      string         `gorm:"size:32;default:'📁'" json:"icon"`        // emoji 图标
	Color     string         `gorm:"size:32;default:'#6366f1'" json:"color"` // 主题色
	IsDefault bool           `gorm:"default:false" json:"is_default"`        // 是否为默认工作区
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}
