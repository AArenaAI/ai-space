package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"github.com/gin-gonic/gin"
)

func TestAuthRefreshInvalidTokenDoesNotClearCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupAuthSessionTestDB(t)
	h := NewAuthHandler(db, &config.Config{JWTSecret: "test-secret"})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	c.Request.AddCookie(&http.Cookie{Name: refreshTokenCookieName, Value: "old-or-invalid-refresh-token"})

	h.Refresh(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusUnauthorized, w.Body.String())
	}
	if strings.Contains(w.Header().Get("Set-Cookie"), refreshTokenCookieName+"=") {
		t.Fatalf("invalid refresh must not clear refresh cookie; Set-Cookie=%q", w.Header().Get("Set-Cookie"))
	}
}

func TestAuthRefreshRevokedTokenDoesNotClearCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupAuthSessionTestDB(t)
	user := models.User{Email: "user@example.com", Name: "Test User", Role: "user"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	refreshValue := "revoked-refresh-token"
	now := time.Now()
	if err := db.Create(&models.RefreshToken{
		UserID:    user.ID,
		TokenHash: hashRefreshToken(refreshValue),
		ExpiresAt: now.Add(time.Hour),
		RevokedAt: &now,
	}).Error; err != nil {
		t.Fatalf("create refresh token: %v", err)
	}

	h := NewAuthHandler(db, &config.Config{JWTSecret: "test-secret"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	c.Request.AddCookie(&http.Cookie{Name: refreshTokenCookieName, Value: refreshValue})

	h.Refresh(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusUnauthorized, w.Body.String())
	}
	if strings.Contains(w.Header().Get("Set-Cookie"), refreshTokenCookieName+"=") {
		t.Fatalf("revoked refresh must not clear refresh cookie; Set-Cookie=%q", w.Header().Get("Set-Cookie"))
	}
}


func TestAuthRefreshUsesValidCookieWhenLegacyApiCookieComesFirst(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupAuthSessionTestDB(t)
	user := models.User{Email: "user@example.com", Name: "Test User", Role: "user"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	validRefresh := "valid-site-wide-refresh-token"
	if err := db.Create(&models.RefreshToken{UserID: user.ID, TokenHash: hashRefreshToken(validRefresh), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatalf("create refresh token: %v", err)
	}

	h := NewAuthHandler(db, &config.Config{JWTSecret: "test-secret"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	c.Request.Header.Set("Cookie", refreshTokenCookieName+"=stale-api-scoped-token; "+refreshTokenCookieName+"="+validRefresh)

	h.Refresh(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusOK, w.Body.String())
	}
	setCookies := strings.Join(w.Header().Values("Set-Cookie"), "\n")
	if !strings.Contains(setCookies, "Path=/api") {
		t.Fatalf("refresh should still clear legacy /api cookie; Set-Cookie=%q", setCookies)
	}
}


func TestAuthRefreshAcceptsLegacyRefreshCookieNameAndMigratesToSessionCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupAuthSessionTestDB(t)
	user := models.User{Email: "legacy@example.com", Name: "Legacy User", Role: "user"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	refreshValue := "legacy-refresh-token-value"
	if err := db.Create(&models.RefreshToken{UserID: user.ID, TokenHash: hashRefreshToken(refreshValue), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatalf("create refresh token: %v", err)
	}

	h := NewAuthHandler(db, &config.Config{JWTSecret: "test-secret"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	c.Request.AddCookie(&http.Cookie{Name: legacyRefreshTokenCookieName, Value: refreshValue})

	h.Refresh(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusOK, w.Body.String())
	}
	setCookies := strings.Join(w.Header().Values("Set-Cookie"), "\n")
	if !strings.Contains(setCookies, refreshTokenCookieName+"=") {
		t.Fatalf("refresh should issue new session cookie; Set-Cookie=%q", setCookies)
	}
	if !strings.Contains(setCookies, legacyRefreshTokenCookieName+"=") {
		t.Fatalf("refresh should clear legacy refresh cookie; Set-Cookie=%q", setCookies)
	}
}
