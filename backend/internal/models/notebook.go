package models

import (
	"time"

	"gorm.io/gorm"
)

// Notebook 是聊天页下的长期资料空间，用于把一组文件组织成可问答的知识笔记本。
type Notebook struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	UserID      uint           `gorm:"not null;index" json:"user_id"`
	WorkspaceID uint           `gorm:"default:0;index" json:"workspace_id"`
	Title       string         `gorm:"size:255;not null" json:"title"`
	Description string         `gorm:"type:text" json:"description"`
	CoverIcon   string         `gorm:"size:64" json:"cover_icon"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`

	Files []NotebookFile `json:"files,omitempty" gorm:"foreignKey:NotebookID"`
}

// NotebookFile 关联笔记本和已上传文件。文件本身仍复用 File/FileChunk/FileEmbedding。
type NotebookFile struct {
	ID         uint      `gorm:"primarykey" json:"id"`
	NotebookID uint      `gorm:"not null;index;uniqueIndex:idx_notebook_file" json:"notebook_id"`
	FileID     uint      `gorm:"not null;index;uniqueIndex:idx_notebook_file" json:"file_id"`
	SortOrder  int       `gorm:"default:0" json:"sort_order"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`

	File File `json:"file,omitempty" gorm:"foreignKey:FileID"`
}

// NotebookConversation 关联笔记本和普通 chat conversation，避免强改 conversation 主表语义。
type NotebookConversation struct {
	ID             uint      `gorm:"primarykey" json:"id"`
	NotebookID     uint      `gorm:"not null;index;uniqueIndex:idx_notebook_conversation" json:"notebook_id"`
	ConversationID uint      `gorm:"not null;index;uniqueIndex:idx_notebook_conversation" json:"conversation_id"`
	CreatedAt      time.Time `json:"created_at"`
}

// NotebookArtifact 保存 Studio 生成的输出文件，例如数据表格、摘要、FAQ、简报等。
type NotebookArtifact struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	NotebookID  uint           `gorm:"not null;index" json:"notebook_id"`
	UserID      uint           `gorm:"not null;index" json:"user_id"`
	Type        string         `gorm:"size:64;not null;index" json:"type"`
	Title       string         `gorm:"size:255;not null" json:"title"`
	Subtitle    string         `gorm:"size:255" json:"subtitle"`
	Content     string         `gorm:"type:text" json:"content"`
	SourceCount int            `gorm:"default:0" json:"source_count"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}
