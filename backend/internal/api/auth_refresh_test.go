package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func TestRefreshCookieSettingsUseHttpOnlySecureSameSiteLax(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewAuthHandler(&gorm.DB{}, &config.Config{JWTSecret: "test-secret"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	c.Request.Header.Set("X-Forwarded-Proto", "https")

	h.setRefreshTokenCookie(c, "refresh-token-value", time.Now().Add(30*24*time.Hour))

	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one cookie, got %d", len(cookies))
	}
	cookie := cookies[0]
	if cookie.Name != refreshTokenCookieName {
		t.Fatalf("expected cookie %q, got %q", refreshTokenCookieName, cookie.Name)
	}
	if !cookie.HttpOnly {
		t.Fatalf("refresh cookie must be HttpOnly")
	}
	if !cookie.Secure {
		t.Fatalf("refresh cookie must be Secure behind https")
	}
	if cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("refresh cookie SameSite = %v, want Lax", cookie.SameSite)
	}
	if cookie.Path != "/api/auth" {
		t.Fatalf("refresh cookie path = %q, want /api/auth", cookie.Path)
	}
}

func TestRefreshTokenValidityRejectsExpiredOrRevokedTokens(t *testing.T) {
	now := time.Now()
	if !isRefreshTokenUsable(models.RefreshToken{ExpiresAt: now.Add(time.Minute)}, now) {
		t.Fatalf("future unrevoked refresh token should be usable")
	}
	revokedAt := now.Add(-time.Minute)
	if isRefreshTokenUsable(models.RefreshToken{ExpiresAt: now.Add(time.Minute), RevokedAt: &revokedAt}, now) {
		t.Fatalf("revoked refresh token should not be usable")
	}
	if isRefreshTokenUsable(models.RefreshToken{ExpiresAt: now.Add(-time.Second)}, now) {
		t.Fatalf("expired refresh token should not be usable")
	}
}

func TestAccessTokenDurationIsShortLived(t *testing.T) {
	token, err := generateAccessToken(123, "user@example.com", "secret")
	if err != nil {
		t.Fatalf("generate access token: %v", err)
	}
	claims, err := parseAccessToken(token, "secret")
	if err != nil {
		t.Fatalf("parse access token: %v", err)
	}
	duration := time.Until(claims.ExpiresAt.Time)
	if duration > 2*time.Hour || duration < 50*time.Minute {
		t.Fatalf("access token duration = %s, want about 1h", duration)
	}
}
