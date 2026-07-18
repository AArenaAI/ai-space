package middleware

import (
	"crypto/sha256"
	"encoding/hex"
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

func setupSessionAuthTestDB(t *testing.T) (*gorm.DB, models.User, string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.RefreshToken{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	user := models.User{Email: "user@example.com", Password: "x", Name: "User"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	sessionValue := "session-cookie-value"
	sum := sha256.Sum256([]byte(sessionValue))
	if err := db.Create(&models.RefreshToken{
		UserID:    user.ID,
		TokenHash: hex.EncodeToString(sum[:]),
		ExpiresAt: time.Now().Add(time.Hour),
	}).Error; err != nil {
		t.Fatalf("create session token: %v", err)
	}
	return db, user, sessionValue
}

func TestSessionAuthMiddlewareAcceptsSessionCookieWithoutBearer(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, user, sessionValue := setupSessionAuthTestDB(t)
	cfg := &config.Config{JWTSecret: "test-secret"}

	r := gin.New()
	r.Use(SessionAuthMiddleware(db, cfg))
	r.GET("/protected", func(c *gin.Context) {
		userID, _ := c.Get("userID")
		email, _ := c.Get("email")
		source, _ := c.Get("auth_source")
		if userID != user.ID {
			t.Fatalf("userID = %v, want %v", userID, user.ID)
		}
		if email != user.Email {
			t.Fatalf("email = %v, want %v", email, user.Email)
		}
		if source != "session_cookie" {
			t.Fatalf("auth_source = %v, want session_cookie", source)
		}
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sessionValue, Path: "/"})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d body = %q, want 204", w.Code, w.Body.String())
	}
}

func TestOptionalSessionAuthMiddlewareSetsUserFromSessionCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, user, sessionValue := setupSessionAuthTestDB(t)
	cfg := &config.Config{JWTSecret: "test-secret"}

	r := gin.New()
	r.Use(OptionalSessionAuthMiddleware(db, cfg))
	r.GET("/optional", func(c *gin.Context) {
		userID, exists := c.Get("userID")
		if !exists {
			t.Fatal("userID was not set")
		}
		if userID != user.ID {
			t.Fatalf("userID = %v, want %v", userID, user.ID)
		}
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/optional", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sessionValue, Path: "/"})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d body = %q, want 204", w.Code, w.Body.String())
	}
}

func TestOptionalSessionAuthMiddlewareAllowsAnonymousWhenCookieMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _, _ := setupSessionAuthTestDB(t)
	cfg := &config.Config{JWTSecret: "test-secret"}

	r := gin.New()
	r.Use(OptionalSessionAuthMiddleware(db, cfg))
	r.GET("/optional", func(c *gin.Context) {
		if _, exists := c.Get("userID"); exists {
			t.Fatal("userID should not be set for anonymous request")
		}
		c.Status(http.StatusNoContent)
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/optional", nil))

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d body = %q, want 204", w.Code, w.Body.String())
	}
}
