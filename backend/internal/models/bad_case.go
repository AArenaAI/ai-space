package models

import "time"

// BadCase 用户提交的 Bad Case（逻辑错误报告）
type BadCase struct {
	ID                   uint      `gorm:"primaryKey" json:"id"`
	UserID               uint      `gorm:"index;not null" json:"user_id"`
	ModelID              string    `gorm:"size:64;not null" json:"model_id"`
	ModelName            string    `gorm:"size:128" json:"model_name"`
	BadCaseDescription   string    `gorm:"type:text;not null" json:"bad_case_description"`
	ExpectedAnswer       string    `gorm:"type:text;not null" json:"expected_answer"`
	ConversationID     *uint     `gorm:"index" json:"conversation_id,omitempty"`
	MessageID          *uint     `gorm:"index" json:"message_id,omitempty"`
	Status             string    `gorm:"size:32;default:'pending'" json:"status"` // pending | approved | rejected | fixed
	StatusMessage      string    `gorm:"size:256" json:"status_message,omitempty"`
	AdminID            *uint     `gorm:"index" json:"admin_id,omitempty"`
	ReviewedAt         *time.Time `json:"reviewed_at,omitempty"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// TableName 指定表名
func (BadCase) TableName() string {
	return "bad_cases"
}
