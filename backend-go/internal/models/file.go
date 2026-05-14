package models

import "time"

// File 用户上传的文件元数据
type File struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	PublicID        string    `gorm:"size:64;uniqueIndex" json:"public_id"`               // 对外暴露的文件 ID，不可枚举
	UserID          uint      `gorm:"not null;index" json:"user_id"`                       // 0 = 未登录用户
	Filename        string    `gorm:"not null" json:"filename"`
	MimeType        string    `json:"mime_type"`
	Size            int64     `json:"size"`
	StoragePath     string    `gorm:"not null" json:"-"`                                  // 磁盘存储路径
	ParseStatus     string    `gorm:"size:16;default:'pending'" json:"parse_status"`      // pending | parsing | done | error | unsupported
	EmbeddingStatus string    `gorm:"size:16;default:'pending'" json:"embedding_status"`  // pending | indexing | done | error | skipped
	ErrorMessage    string    `gorm:"type:text" json:"error_message"`                     // 解析失败原因
	Content         string    `gorm:"type:text" json:"content"`                           // 解析后的完整文本
	Summary         string    `gorm:"type:text" json:"summary"`                           // 文件摘要
	PageCount       int       `json:"page_count"`
	TokenCount      int       `json:"token_count"`                                        // 文件总 token 数
	HasImages       bool      `json:"has_images"`                                         // 是否含图片
	HasTables       bool      `json:"has_tables"`                                         // 是否含表格
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// FileChunk 文件切分后的文本块
// 支持结构化块类型，便于引用和检索
type FileChunk struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	FileID          uint      `gorm:"not null;index" json:"file_id"`
	BlockID         string    `gorm:"size:64;index" json:"block_id"`                   // 例如 "p3-b7", "slide2-b1", "sheet1-r10"
	ChunkIndex      int       `json:"chunk_index"`
	Page            int       `json:"page"`                                            // 所属页码
	Slide           int       `json:"slide"`                                           // PPTX slide 编号
	SheetName       string    `gorm:"size:128" json:"sheet_name"`                    // XLSX sheet 名
	BlockType       string    `gorm:"size:32;default:'paragraph'" json:"block_type"` // paragraph | heading | table | code | image_ref | image_caption
	Content         string    `gorm:"type:text" json:"content"`                      // 文本内容
	Markdown        string    `gorm:"type:text" json:"markdown"`                     // Markdown 格式（如果与 Content 不同）
	TokenCount      int       `json:"token_count"`
	TextHash        string    `gorm:"size:64;index" json:"text_hash"`                // 内容 hash，避免重复 embedding
	Metadata        string    `gorm:"type:text" json:"metadata"`                     // JSON 元数据
	EmbeddingStatus string    `gorm:"size:32;default:'pending'" json:"embedding_status"` // pending | done | error | skipped
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// FileEmbedding 文件 chunk 的向量嵌入
// 支持多 provider 共存，通过 provider/model/dimension 区分
type FileEmbedding struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	FileID    uint      `gorm:"not null;index" json:"file_id"`
	ChunkID   uint      `gorm:"not null;index;uniqueIndex:idx_embedding_unique" json:"chunk_id"`
	Provider  string    `gorm:"size:32;not null;uniqueIndex:idx_embedding_unique" json:"provider"`  // openai | gemini | local
	Model     string    `gorm:"size:128;not null;uniqueIndex:idx_embedding_unique" json:"model"`    // text-embedding-3-small
	Dimension int       `gorm:"not null;uniqueIndex:idx_embedding_unique" json:"dimension"`         // 1536
	TextHash  string    `gorm:"size:64;not null;uniqueIndex:idx_embedding_unique" json:"text_hash"` // 用于一致性校验
	Vector    []byte    `gorm:"type:blob;not null" json:"-"`                                        // float32[] BLOB
	CreatedAt time.Time
	UpdatedAt time.Time
}

// FileEmbeddingJob 文件 embedding 异步任务
// 用于服务重启后恢复未完成的 embedding 任务
type FileEmbeddingJob struct {
	ID           uint   `gorm:"primaryKey" json:"id"`
	FileID       uint   `gorm:"not null;index" json:"file_id"`
	Provider     string `gorm:"size:32" json:"provider"`
	Model        string `gorm:"size:128" json:"model"`
	Dimension    int    `json:"dimension"`
	Status       string `gorm:"size:16;default:'pending'" json:"status"` // pending | running | done | error
	Attempts     int    `gorm:"default:0" json:"attempts"`
	ErrorMessage string `gorm:"type:text" json:"error_message"`
	CreatedAt    time.Time
	StartedAt    *time.Time
	FinishedAt   *time.Time
	UpdatedAt    time.Time
}

// ConversationFile 对话与文件的关联
type ConversationFile struct {
	ID             uint `gorm:"primaryKey" json:"id"`
	ConversationID uint `gorm:"not null;index" json:"conversation_id"`
	FileID         uint `gorm:"not null;index" json:"file_id"`
}
