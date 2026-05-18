package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// getUserID 安全从 gin.Context 获取 userID，兼容 uint 和 float64 类型
func getUserID(c *gin.Context) uint {
	val, exists := c.Get("userID")
	if !exists {
		return 0
	}
	switch v := val.(type) {
	case uint:
		return v
	case float64:
		return uint(v)
	case int:
		return uint(v)
	case int64:
		return uint(v)
	default:
		return 0
	}
}

// getGuestID 安全从 gin.Context 获取 guestID，支持 header 和 query 参数
func getGuestID(c *gin.Context) string {
	// 1. 优先从 Header 获取
	if guestID := c.GetHeader("X-Guest-ID"); guestID != "" {
		return guestID
	}
	// 2. 兼容 Query 参数（作为 fallback）
	if guestID := c.Query("guest_id"); guestID != "" {
		return guestID
	}
	return ""
}

// checkGuestLimit 检查匿名用户是否超过每日聊天次数限制
// 返回 (ok, count)
func checkGuestLimit(db *gorm.DB, cfg *config.Config, guestID string) (bool, int64) {
	if cfg.GuestDailyChatLimit <= 0 {
		return true, 0
	}
	var count int64
	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	db.Model(&models.Message{}).
		Joins("JOIN conversations ON conversations.id = messages.conversation_id").
		Where("conversations.guest_id = ? AND messages.role = 'user' AND messages.created_at >= ?", guestID, startOfDay).
		Count(&count)
	return count < int64(cfg.GuestDailyChatLimit), count
}

// requireGuestOrUser 返回是否是认证用户或匿名用户
func requireGuestOrUser(c *gin.Context, cfg *config.Config, db *gorm.DB) (userID uint, guestID string, ok bool) {
	userID = getUserID(c)
	if userID > 0 {
		return userID, "", true
	}
	guestID = getGuestID(c)
	if guestID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "guest_id_required", "message": "匿名用户请先刷新页面以生成 visitor ID"})
		return 0, "", false
	}
	// 检查陙额
	ok, count := checkGuestLimit(db, cfg, guestID)
	if !ok {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "guest_limit_exceeded", "message": "匿名用户每日限额已用完", "limit": cfg.GuestDailyChatLimit, "used": count})
		return 0, "", false
	}
	return 0, guestID, true
}
