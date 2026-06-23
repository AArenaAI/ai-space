package models

import "time"

// EmailVerification stores short-lived email verification codes for auth flows.
type EmailVerification struct {
	ID         uint       `gorm:"primarykey" json:"id"`
	Email      string     `gorm:"size:255;not null;index:idx_email_verification_lookup" json:"email"`
	Purpose    string     `gorm:"size:64;not null;index:idx_email_verification_lookup" json:"purpose"`
	CodeHash   string     `gorm:"size:255;not null" json:"-"`
	Attempts   int        `gorm:"default:0" json:"attempts"`
	ExpiresAt  time.Time  `gorm:"not null;index" json:"expires_at"`
	ConsumedAt *time.Time `json:"consumed_at"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}
