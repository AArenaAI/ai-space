package models

import "time"

// GaokaoSchool stores basic college metadata used by the Gaokao planner.
type GaokaoSchool struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	Code       string    `gorm:"size:512;uniqueIndex" json:"code"`
	Name       string    `gorm:"size:160;index" json:"name"`
	Province   string    `gorm:"size:64;index" json:"province"`
	City       string    `gorm:"size:64;index" json:"city"`
	Level      string    `gorm:"size:128;index" json:"level"`
	Ownership  string    `gorm:"size:32;index" json:"ownership"` // 公办 | 民办 | 中外合作
	MoeCode    string    `gorm:"size:32;index" json:"moe_code,omitempty"`
	Department string    `gorm:"size:128;index" json:"department,omitempty"`
	SchoolType string    `gorm:"size:64;index" json:"school_type,omitempty"` // 综合类 | 理工类 | 师范类 ...
	DualClass  string    `gorm:"size:64;index" json:"dual_class,omitempty"`
	Tags       string    `gorm:"type:text" json:"tags,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (GaokaoSchool) TableName() string { return "gaokao_schools" }

// GaokaoMajor stores major metadata and broad career signals.
type GaokaoMajor struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	Code       string    `gorm:"size:512;uniqueIndex" json:"code"`
	Name       string    `gorm:"size:512;index" json:"name"`
	Category   string    `gorm:"size:128;index" json:"category"`
	Heat       string    `gorm:"size:16;index" json:"heat"` // 高 | 中 | 低
	Employment string    `gorm:"type:text" json:"employment,omitempty"`
	Postgrad   string    `gorm:"type:text" json:"postgrad,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (GaokaoMajor) TableName() string { return "gaokao_majors" }

// GaokaoAdmissionRecord stores province-specific historical admission data.
type GaokaoAdmissionRecord struct {
	ID                 uint         `gorm:"primaryKey" json:"id"`
	Year               int          `gorm:"index:idx_gaokao_record_lookup,priority:1" json:"year"`
	SourceProvince     string       `gorm:"size:64;index:idx_gaokao_record_lookup,priority:2" json:"source_province"`
	Batch              string       `gorm:"size:64;index" json:"batch"`
	SubjectType        string       `gorm:"size:64;index" json:"subject_type"`
	SchoolID           uint         `gorm:"index" json:"school_id"`
	School             GaokaoSchool `gorm:"foreignKey:SchoolID" json:"school,omitempty"`
	MajorID            uint         `gorm:"index" json:"major_id"`
	Major              GaokaoMajor  `gorm:"foreignKey:MajorID" json:"major,omitempty"`
	MajorGroup         string       `gorm:"size:512;index" json:"major_group"`
	SubjectRequirement string       `gorm:"size:512" json:"subject_requirement"`
	MinScore           int          `json:"min_score"`
	MinRank            int          `gorm:"index" json:"min_rank"`
	AvgScore           int          `json:"avg_score"`
	AvgRank            int          `json:"avg_rank"`
	PlanCount          int          `json:"plan_count"`
	Tuition            int          `json:"tuition"`
	Campus             string       `gorm:"type:text" json:"campus"`
	Source             string       `gorm:"type:text" json:"source,omitempty"`
	CreatedAt          time.Time    `json:"created_at"`
	UpdatedAt          time.Time    `json:"updated_at"`
}

func (GaokaoAdmissionRecord) TableName() string { return "gaokao_admission_records" }
