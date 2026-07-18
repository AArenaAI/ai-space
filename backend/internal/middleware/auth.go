package middleware

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
)

type Claims struct {
	UserID uint   `json:"user_id"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

const AccessTokenTTL = time.Hour

const (
	sessionCookieName       = "ai_space_session"
	legacySessionCookieName = "ai_space_refresh_token"
)

func GenerateToken(userID uint, email string, secret string) (string, error) {
	claims := Claims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(AccessTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func ParseToken(tokenString string, secret string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if token == nil || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

func setAuthContext(c *gin.Context, userID uint, email string, source string) {
	c.Set("userID", userID)
	c.Set("email", email)
	c.Set("auth_source", source)
}

func resolveBearerAuth(c *gin.Context, cfg *config.Config) bool {
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		return false
	}
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || parts[0] != "Bearer" {
		return false
	}
	claims, err := ParseToken(parts[1], cfg.JWTSecret)
	if err != nil {
		return false
	}
	setAuthContext(c, claims.UserID, claims.Email, "bearer")
	return true
}

func hashSessionCookie(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func sessionCookieValues(r *http.Request) []string {
	if r == nil {
		return nil
	}
	values := make([]string, 0, 2)
	for _, cookie := range r.Cookies() {
		if cookie.Name != sessionCookieName && cookie.Name != legacySessionCookieName {
			continue
		}
		value := strings.TrimSpace(cookie.Value)
		if value != "" {
			values = append(values, value)
		}
	}
	return values
}

func resolveCookieSession(c *gin.Context, db *gorm.DB) bool {
	if db == nil {
		return false
	}
	now := time.Now()
	for _, value := range sessionCookieValues(c.Request) {
		var stored models.RefreshToken
		if err := db.Where("token_hash = ? AND revoked_at IS NULL AND expires_at > ?", hashSessionCookie(value), now).First(&stored).Error; err != nil {
			continue
		}
		var user models.User
		if err := db.First(&user, stored.UserID).Error; err != nil {
			continue
		}
		setAuthContext(c, user.ID, user.Email, "session_cookie")
		return true
	}
	return false
}

func resolveAnyAuth(c *gin.Context, db *gorm.DB, cfg *config.Config) bool {
	if resolveBearerAuth(c, cfg) {
		return true
	}
	return resolveCookieSession(c, db)
}

func AuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !resolveBearerAuth(c, cfg) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "未提供认证信息"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func SessionAuthMiddleware(db *gorm.DB, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !resolveAnyAuth(c, db, cfg) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "未提供认证信息"})
			c.Abort()
			return
		}
		c.Next()
	}
}

// OptionalAuthMiddleware 可选认证中间件：有合法 token 则设置 userID，无则不报错，继续执行
func OptionalAuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		resolveBearerAuth(c, cfg)
		c.Next()
	}
}

func OptionalSessionAuthMiddleware(db *gorm.DB, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		resolveAnyAuth(c, db, cfg)
		c.Next()
	}
}

// GetGuestID 从请求中获取匿名用户 ID（优先 header，其次 query）
func GetGuestID(c *gin.Context) string {
	guestID := c.GetHeader("X-Guest-ID")
	if guestID == "" {
		guestID = c.Query("guest_id")
	}
	return guestID
}
