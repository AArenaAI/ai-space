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
	if len(cookies) != 2 {
		t.Fatalf("expected site cookie plus legacy cleanup cookie, got %d", len(cookies))
	}
	var cookie *http.Cookie
	var legacyCleanup *http.Cookie
	for _, item := range cookies {
		if item.Name != refreshTokenCookieName {
			t.Fatalf("expected cookie %q, got %q", refreshTokenCookieName, item.Name)
		}
		switch item.Path {
		case "/":
			cookie = item
		case "/api":
			legacyCleanup = item
		}
	}
	if cookie == nil {
		t.Fatalf("missing site-wide refresh cookie")
	}
	if legacyCleanup == nil || legacyCleanup.MaxAge != -1 {
		t.Fatalf("missing legacy /api cleanup cookie: %+v", legacyCleanup)
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
	if cookie.Path != "/" {
		t.Fatalf("refresh cookie path = %q, want /", cookie.Path)
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
