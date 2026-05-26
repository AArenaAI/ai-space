package models

import "time"

// DocumentArtifact stores generated document-reader outputs such as knowledge graphs and infographics.
type DocumentArtifact struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"not null;index:idx_document_artifacts_owner_file_kind,priority:1" json:"user_id"`
	FileID    uint      `gorm:"not null;index:idx_document_artifacts_owner_file_kind,priority:2" json:"file_id"`
	Kind      string    `gorm:"size:32;not null;index:idx_document_artifacts_owner_file_kind,priority:3" json:"kind"` // knowledge_graph | infographic
	Title     string    `gorm:"size:255" json:"title"`
	Summary   string    `gorm:"type:text" json:"summary"`
	Payload   string    `gorm:"type:text;not null" json:"payload"`
	Raw       string    `gorm:"type:text" json:"raw"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
