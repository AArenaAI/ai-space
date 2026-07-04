package models

import "time"

// GaokaoPlan stores a saved volunteer-planning snapshot for a user.
type GaokaoPlan struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	UserID          uint      `gorm:"index" json:"user_id"`
	Title           string    `gorm:"size:160" json:"title"`
	Province        string    `gorm:"size:64;index" json:"province"`
	Score           int       `json:"score"`
	Rank            int       `json:"rank"`
	Subjects        string    `gorm:"size:128" json:"subjects"`
	Strategy        string    `gorm:"size:32" json:"strategy"`
	ProfileJSON     string    `gorm:"type:jsonb" json:"profile_json"`
	Recommendations string    `gorm:"type:jsonb" json:"recommendations"`
	Summary         string    `gorm:"type:text" json:"summary,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (GaokaoPlan) TableName() string { return "gaokao_plans" }
