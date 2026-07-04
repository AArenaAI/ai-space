package models

import "time"

// GaokaoEnrollmentPlan stores source enrollment-plan rows separately from admission/cutoff rows.
// Plan files often use different batch/group encodings than admission files, so keeping this
// table separate avoids corrupting admission records while still allowing fuzzy lookup at runtime.
type GaokaoEnrollmentPlan struct {
	ID                 uint         `gorm:"primaryKey" json:"id"`
	Year               int          `gorm:"index" json:"year"`
	SourceProvince     string       `gorm:"size:64;index" json:"source_province"`
	Batch              string       `gorm:"size:128;index" json:"batch"`
	SubjectType        string       `gorm:"size:64;index" json:"subject_type"`
	SchoolID           uint         `gorm:"index" json:"school_id"`
	School             GaokaoSchool `gorm:"foreignKey:SchoolID" json:"school,omitempty"`
	MajorID            uint         `gorm:"index" json:"major_id"`
	Major              GaokaoMajor  `gorm:"foreignKey:MajorID" json:"major,omitempty"`
	MajorGroup         string       `gorm:"size:512;index" json:"major_group"`
	MajorNameRaw       string       `gorm:"size:512;index" json:"major_name_raw"`
	MajorCodeRaw       string       `gorm:"size:128" json:"major_code_raw"`
	SubjectRequirement string       `gorm:"size:512" json:"subject_requirement"`
	PlanCount          int          `json:"plan_count"`
	Duration           string       `gorm:"size:64" json:"duration"`
	Tuition            int          `json:"tuition"`
	MajorNote          string       `gorm:"type:text" json:"major_note"`
	Source             string       `gorm:"type:text" json:"source"`
	CreatedAt          time.Time    `json:"created_at"`
	UpdatedAt          time.Time    `json:"updated_at"`
}

func (GaokaoEnrollmentPlan) TableName() string { return "gaokao_enrollment_plans" }
