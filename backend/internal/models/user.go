package models

import (
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type User struct {
	ID              uint           `gorm:"primarykey" json:"id"`
	Email           string         `gorm:"uniqueIndex;not null" json:"email"`
	Password        string         `gorm:"not null" json:"-"`
	Name            string         `json:"name"`
	BasicCredits    int            `gorm:"default:30" json:"basic_credits"`
	AdvancedCredits int            `gorm:"default:0" json:"advanced_credits"`
	EliteCredits    int            `gorm:"default:0" json:"elite_credits"`
	PlanTier        string         `gorm:"default:'free'" json:"plan_tier"`
	Role            string         `gorm:"default:'user';index" json:"role"`
	CreditsResetAt  time.Time      `json:"credits_reset_at"`
	BetaPhase       string         `gorm:"size:32;default:''" json:"beta_phase,omitempty"` // 内测阶段：phase_1 | phase_2 | phase_3 | completed
	BetaPhase1Used  bool           `gorm:"default:false" json:"beta_phase_1_used,omitempty"` // 试探期额度是否已用完
	BetaPhase2Used  bool           `gorm:"default:false" json:"beta_phase_2_used,omitempty"` // 深水区额度是否已用完
	BetaPhase3Used  bool           `gorm:"default:false" json:"beta_phase_3_used,omitempty"` // 枯竭期额度是否已用完
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"-"`
}

func (u *User) HashPassword() error {
	hashed, err := bcrypt.GenerateFromPassword([]byte(u.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	u.Password = string(hashed)
	return nil
}

func (u *User) CheckPassword(password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(password))
	return err == nil
}
