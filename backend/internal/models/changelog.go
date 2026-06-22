package models

import "time"

// Changelog 产品更新日志
type Changelog struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Version     string    `gorm:"size:32;index" json:"version"`     // 版本号，如 v1.2.0
	Title       string    `gorm:"size:256" json:"title"`            // 更新标题
	Content     string    `gorm:"type:text" json:"content"`           // Markdown 内容
	Category    string    `gorm:"size:32;index" json:"category"`     // feature / fix / optimize / breaking
	IsPublished bool      `gorm:"default:false;index" json:"is_published"` // 是否已发布
	PublishedAt *time.Time `json:"published_at,omitempty"`            // 发布时间
	IsPinned    bool      `gorm:"default:false" json:"is_pinned"`     // 是否置顶
	SortOrder   int       `gorm:"default:0" json:"sort_order"`      // 排序
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// ChangelogRead 用户已读记录
type ChangelogRead struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	UserID      uint      `gorm:"index" json:"user_id"`
	ChangelogID uint      `gorm:"index" json:"changelog_id"`
	ReadAt      time.Time `json:"read_at"`
}

// ChangelogCategoryLabel 分类标签映射
func ChangelogCategoryLabel(cat string) string {
	switch cat {
	case "feature":
		return "新功能"
	case "fix":
		return "修复"
	case "optimize":
		return "优化"
	case "breaking":
		return "重大变更"
	default:
		return "其他"
	}
}

// ChangelogCategoryColor 分类颜色映射
func ChangelogCategoryColor(cat string) string {
	switch cat {
	case "feature":
		return "#10b981" // emerald-500
	case "fix":
		return "#ef4444" // red-500
	case "optimize":
		return "#3b82f6" // blue-500
	case "breaking":
		return "#f59e0b" // amber-500
	default:
		return "#6b7280" // gray-500
	}
}
