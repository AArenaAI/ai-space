package models

import "time"

// PPTTemplate PPT模板
 type PPTTemplate struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	Name        string    `json:"name"`
	Category    string    `json:"category"`
	Description string    `json:"description"`
	PreviewURL  string    `json:"preview_url"`
	ThemeJSON   string    `json:"theme_json"` // 包含 colors, fonts, layouts
	IsActive    bool      `json:"is_active" gorm:"default:true"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// PPTGeneration PPT生成记录
 type PPTGeneration struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	UserID       uint      `json:"user_id"`
	GuestID      string    `json:"guest_id" gorm:"size:64"`
	Title        string    `json:"title"`
	Topic        string    `json:"topic"`
	TemplateID   string    `json:"template_id"`
	Language     string    `json:"language" gorm:"default:'zh-CN'"`
	Audience     string    `json:"audience"`
	Purpose      string    `json:"purpose"`
	ExtraContent string    `json:"extra_content" gorm:"type:text"`
	ReferenceURL string    `json:"reference_url"`
	SlideCount   int       `json:"slide_count"`
	WithImages   string    `json:"with_images" gorm:"default:'key_slides'"` // none, cover, key_slides, all
	WithNotes    bool      `json:"with_notes" gorm:"default:true"`
	QualityMode  string    `json:"quality_mode" gorm:"default:'standard'"` // fast, standard, premium
	Status       string    `json:"status" gorm:"default:'pending'"`
	SlidesJSON   string    `json:"slides_json" gorm:"type:text"`
	OutlineJSON  string    `json:"outline_json" gorm:"type:text"`
	Progress     int       `json:"progress" gorm:"default:0"`
	ProgressMsg  string    `json:"progress_msg"`
	Model        string    `json:"model"`
	PromptTokens int       `json:"prompt_tokens"`
	CompTokens   int       `json:"comp_tokens"`
	Cost         float64   `json:"cost"`
	ErrorMsg     string    `json:"error_msg"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// PPT 状态常量
const (
	PPTStatusPending          = "pending"
	PPTStatusPlanning         = "planning"
	PPTStatusOutlineReady     = "outline_ready"
	PPTStatusGeneratingSlides = "generating_slides"
	PPTStatusGeneratingImages = "generating_images"
	PPTStatusCompleted        = "completed"
	PPTStatusPartialCompleted = "partial_completed"
	PPTStatusImageFailed      = "image_failed"
	PPTStatusFailed           = "failed"
)

// PPTSlide 单页幻灯片记录
 type PPTSlide struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	PPTID        uint      `json:"ppt_id" gorm:"index"`
	Page         int       `json:"page"`
	Type         string    `json:"type"` // cover, agenda, section, content, chart, summary, end
	Title        string    `json:"title"`
	Subtitle     string    `json:"subtitle"`
	ContentJSON  string    `json:"content_json" gorm:"type:text"`
	Layout       string    `json:"layout"`
	ImagePrompt  string    `json:"image_prompt" gorm:"type:text"`
	ImageURL     string    `json:"image_url"`
	SpeakerNotes string    `json:"speaker_notes" gorm:"type:text"`
	ChartJSON    string    `json:"chart_json" gorm:"type:text"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// PPTRevision PPT 修订记录
 type PPTRevision struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	PPTID       uint      `json:"ppt_id"`
	UserID      uint      `json:"user_id"`
	SlidePage   int       `json:"slide_page"`
	Type        string    `json:"type"` // content, image, layout
	OldValue    string    `json:"old_value" gorm:"type:text"`
	NewValue    string    `json:"new_value" gorm:"type:text"`
	Instruction string    `json:"instruction"`
	CreatedAt   time.Time `json:"created_at"`
}

// PPTImageJob PPT 图片生成任务（替换裸 goroutine，支持重试与恢复）
 type PPTImageJob struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	PPTID     uint      `json:"ppt_id" gorm:"index:idx_ppt_image_job_pptid"`
	Page      int       `json:"page"`
	Prompt    string    `json:"prompt" gorm:"type:text"`
	Status    string    `json:"status" gorm:"default:'pending'"` // pending, processing, completed, failed
	ImageURL  string    `json:"image_url"`
	ErrorMsg  string    `json:"error_msg"`
	Attempts  int       `json:"attempts" gorm:"default:0"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Slide 简化幻灯片（兼容旧结构）
 type Slide struct {
	Title    string   `json:"title"`
	Content  []string `json:"content"`
	Subtitle string   `json:"subtitle,omitempty"`
}
