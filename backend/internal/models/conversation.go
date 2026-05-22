package models

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"
)

type Conversation struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	UserID    uint           `gorm:"not null;index" json:"user_id"`
	WorkspaceID uint         `gorm:"default:0;index" json:"workspace_id"` // 所属工作区，0=默认
	GuestID   string         `gorm:"index;size:64" json:"guest_id"`              // 匿名用户 ID
	Title     string         `json:"title"`
	Model     string         `json:"model"`
	Pinned    bool           `gorm:"default:false" json:"pinned"`
	Compare   bool           `gorm:"default:false" json:"compare"`            // 是否是对比对话
	CompareModels string     `gorm:"type:text" json:"compare_models,omitempty"` // JSON 数组，对比选用的模型列表
	SkillKey  string         `gorm:"index;size:64" json:"skill_key,omitempty"` // 关联的技能 key
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	Messages []Message `json:"messages,omitempty" gorm:"foreignKey:ConversationID"`
}

// GetCompareModels 解析 CompareModels JSON
func (c *Conversation) GetCompareModels() []string {
	var m []string
	json.Unmarshal([]byte(c.CompareModels), &m)
	return m
}

// SetCompareModels 序列化 CompareModels
func (c *Conversation) SetCompareModels(m []string) {
	b, _ := json.Marshal(m)
	c.CompareModels = string(b)
}

type Message struct {
	ID             uint           `gorm:"primarykey" json:"id"`
	ConversationID uint           `gorm:"not null;index" json:"conversation_id"`
	Role           string         `gorm:"not null" json:"role"` // user / assistant / system
	Content        string         `gorm:"not null" json:"content"`
	Model          string         `json:"model"`
	TokensUsed     int            `json:"tokens_used"`
	CompletedAt    *time.Time     `json:"completed_at,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`

	GroupID    uint `gorm:"index" json:"group_id,omitempty"`    // 所属消息组
	GroupIndex int  `json:"group_index,omitempty"`              // 在组内的顺序

	// 文件关联（仅 user 消息可能有）
	MessageFiles []MessageFile `json:"files,omitempty" gorm:"foreignKey:MessageID"`
}

// MessageFile 消息与文件的关联（用于图片显示等）
type MessageFile struct {
	ID        uint   `gorm:"primarykey" json:"id"`
	MessageID uint   `gorm:"not null;index;uniqueIndex:idx_msg_file" json:"message_id"`
	FileID    uint   `gorm:"not null;index;uniqueIndex:idx_msg_file" json:"file_id"`
	PublicID  string `gorm:"size:64" json:"public_id"`
	Type      string `gorm:"size:16" json:"type"`          // image / document
	Filename  string `gorm:"size:255" json:"filename"`
}
