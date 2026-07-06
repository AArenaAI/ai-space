package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupAuthSessionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Workspace{}, &models.RefreshToken{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestAuthSessionRequiresRefreshCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupAuthSessionTestDB(t)
	h := NewAuthHandler(db, &config.Config{JWTSecret: "test-secret"})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)

	h.Session(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusUnauthorized, w.Body.String())
	}
}

func TestAuthSessionReturnsUserForValidRefreshCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupAuthSessionTestDB(t)
	user := models.User{Email: "user@example.com", Name: "Test User", Role: "user"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	workspace := models.Workspace{UserID: user.ID, Name: "默认工作区", IsDefault: true}
	if err := db.Create(&workspace).Error; err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	refreshValue := "refresh-token-value"
	if err := db.Create(&models.RefreshToken{
		UserID:    user.ID,
		TokenHash: hashRefreshToken(refreshValue),
		ExpiresAt: time.Now().Add(time.Hour),
	}).Error; err != nil {
		t.Fatalf("create refresh token: %v", err)
	}

	h := NewAuthHandler(db, &config.Config{JWTSecret: "test-secret"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	c.Request.AddCookie(&http.Cookie{Name: refreshTokenCookieName, Value: refreshValue})

	h.Session(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusOK, w.Body.String())
	}
	var payload struct {
		Token string `json:"token"`
		User  struct {
			ID                 uint   `json:"id"`
			Email              string `json:"email"`
			DefaultWorkspaceID uint   `json:"default_workspace_id"`
		} `json:"user"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Token == "" {
		t.Fatalf("session response must include a fresh access token")
	}
	claims, err := parseAccessToken(payload.Token, "test-secret")
	if err != nil {
		t.Fatalf("parse session token: %v", err)
	}
	if claims.UserID != user.ID || claims.Email != user.Email {
		t.Fatalf("unexpected token claims: %+v", claims)
	}
	if payload.User.ID != user.ID || payload.User.Email != user.Email || payload.User.DefaultWorkspaceID != workspace.ID {
		t.Fatalf("unexpected user payload: %+v", payload.User)
	}
}


func TestAuthSessionUsesValidCookieWhenLegacyApiCookieComesFirst(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupAuthSessionTestDB(t)
	user := models.User{Email: "user@example.com", Name: "Test User", Role: "user"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	workspace := models.Workspace{UserID: user.ID, Name: "默认工作区", IsDefault: true}
	if err := db.Create(&workspace).Error; err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	validRefresh := "valid-site-wide-refresh-token"
	if err := db.Create(&models.RefreshToken{UserID: user.ID, TokenHash: hashRefreshToken(validRefresh), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatalf("create refresh token: %v", err)
	}

	h := NewAuthHandler(db, &config.Config{JWTSecret: "test-secret"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	c.Request.Header.Set("Cookie", refreshTokenCookieName+"=stale-api-scoped-token; "+refreshTokenCookieName+"="+validRefresh)

	h.Session(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusOK, w.Body.String())
	}
}


func TestAuthSessionAcceptsLegacyRefreshCookieName(t *testing.T) {
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
	c.Request = httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	c.Request.AddCookie(&http.Cookie{Name: legacyRefreshTokenCookieName, Value: refreshValue})

	h.Session(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusOK, w.Body.String())
	}
}
