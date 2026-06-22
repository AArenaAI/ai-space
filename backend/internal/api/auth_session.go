package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"aipool-backend/internal/middleware"
	"aipool-backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	refreshTokenCookieName = "ai_space_refresh_token"
	refreshTokenTTL        = 30 * 24 * time.Hour
)

func generateAccessToken(userID uint, email string, secret string) (string, error) {
	return middleware.GenerateToken(userID, email, secret)
}

func parseAccessToken(token, secret string) (*middleware.Claims, error) {
	return middleware.ParseToken(token, secret)
}

func generateRefreshTokenValue() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func hashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func isRefreshTokenUsable(token models.RefreshToken, now time.Time) bool {
	return token.RevokedAt == nil && token.ExpiresAt.After(now)
}

func isRequestHTTPS(c *gin.Context) bool {
	if c.Request != nil && c.Request.TLS != nil {
		return true
	}
	proto := strings.ToLower(strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")))
	return proto == "https"
}

func (h *AuthHandler) setRefreshTokenCookie(c *gin.Context, token string, expiresAt time.Time) {
	maxAge := int(time.Until(expiresAt).Seconds())
	if maxAge < 0 {
		maxAge = 0
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     refreshTokenCookieName,
		Value:    token,
		Path:     "/api/auth",
		MaxAge:   maxAge,
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   isRequestHTTPS(c),
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *AuthHandler) clearRefreshTokenCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     refreshTokenCookieName,
		Value:    "",
		Path:     "/api/auth",
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		Secure:   isRequestHTTPS(c),
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *AuthHandler) issueRefreshToken(c *gin.Context, tx *gorm.DB, userID uint) error {
	value, err := generateRefreshTokenValue()
	if err != nil {
		return err
	}
	expiresAt := time.Now().Add(refreshTokenTTL)
	if err := tx.Create(&models.RefreshToken{
		UserID:    userID,
		TokenHash: hashRefreshToken(value),
		ExpiresAt: expiresAt,
	}).Error; err != nil {
		return err
	}
	h.setRefreshTokenCookie(c, value, expiresAt)
	return nil
}

func authUserPayload(user models.User, defaultWorkspaceID uint) gin.H {
	return gin.H{
		"id":                   user.ID,
		"email":                user.Email,
		"name":                 user.Name,
		"role":                 user.Role,
		"basic_credits":        user.BasicCredits,
		"advanced_credits":     user.AdvancedCredits,
		"elite_credits":        user.EliteCredits,
		"plan_tier":            user.PlanTier,
		"beta_phase":           user.BetaPhase,
		"beta_batch":           user.BetaBatch,
		"default_workspace_id": defaultWorkspaceID,
	}
}
