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
	if len(cookies) != 3 {
		t.Fatalf("expected new session cookie plus legacy cleanup cookies, got %d: %+v", len(cookies), cookies)
	}
	var sessionCookie *http.Cookie
	legacyCleanupPaths := map[string]bool{"/": false, "/api": false}
	for _, item := range cookies {
		switch item.Name {
		case refreshTokenCookieName:
			if item.Path != "/" {
				t.Fatalf("session cookie path = %q, want /", item.Path)
			}
			sessionCookie = item
		case legacyRefreshTokenCookieName:
			if _, ok := legacyCleanupPaths[item.Path]; !ok {
				t.Fatalf("unexpected legacy cleanup path %q", item.Path)
			}
			if item.MaxAge != -1 {
				t.Fatalf("legacy cleanup cookie MaxAge = %d, want -1", item.MaxAge)
			}
			legacyCleanupPaths[item.Path] = true
		default:
			t.Fatalf("unexpected cookie %q", item.Name)
		}
	}
	if sessionCookie == nil {
		t.Fatalf("missing site-wide session cookie")
	}
	for path, seen := range legacyCleanupPaths {
		if !seen {
			t.Fatalf("missing legacy cleanup cookie for path %s", path)
		}
	}
	if !sessionCookie.HttpOnly {
		t.Fatalf("refresh cookie must be HttpOnly")
	}
	if !sessionCookie.Secure {
		t.Fatalf("refresh cookie must be Secure behind https")
	}
	if sessionCookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("refresh cookie SameSite = %v, want Lax", sessionCookie.SameSite)
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
