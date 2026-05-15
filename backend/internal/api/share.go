package api

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"aipool-backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ShareHandler struct {
	db *gorm.DB
}

func NewShareHandler(db *gorm.DB) *ShareHandler {
	return &ShareHandler{db: db}
}

// 生成随机 short slug，16 位 URL-safe base64
func generateSlug() string {
	b := make([]byte, 12)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)[:16]
}

// POST /api/conversations/:id/share — 创建分享
func (h *ShareHandler) Create(c *gin.Context) {
	userID := getUserID(c)
	convID := c.Param("id")

	var req struct {
		SelectedMessages []string `json:"selected_messages"` // 选中的 message ID 列表
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 验证对话属于当前用户
	var conv models.Conversation
	if err := h.db.Where("id = ? AND user_id = ?", convID, userID).First(&conv).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "对话不存在"})
		return
	}

	selectedJSON, _ := json.Marshal(req.SelectedMessages)

	share := models.ConversationShare{
		Slug:           generateSlug(),
		ConversationID: conv.ID,
		UserID:         userID,
		SelectedMsgs:   string(selectedJSON),
		Title:          conv.Title,
		Model:          conv.Model,
	}

	if err := h.db.Create(&share).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建分享失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"slug": share.Slug,
		"url":  "/share/" + share.Slug,
	})
}

// GET /api/share/:slug — 通过 short slug 获取分享内容
func (h *ShareHandler) GetBySlug(c *gin.Context) {
	slug := c.Param("slug")

	var share models.ConversationShare
	if err := h.db.Where("slug = ?", slug).First(&share).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "分享不存在或已过期"})
		return
	}

	// 检查是否过期
	if share.ExpiresAt != nil && share.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "分享链接已过期"})
		return
	}

	// 解析选中的 message IDs
	var selectedIDs []string
	json.Unmarshal([]byte(share.SelectedMsgs), &selectedIDs)

	var messages []models.Message
	// 尝试先用 conversation_id 查询全部消息
	h.db.Where("conversation_id = ?", share.ConversationID).Order("created_at asc").Find(&messages)

	// 如果有选中的 ID，尝试精确匹配
	filtered := messages
	if len(selectedIDs) > 0 {
		filtered = []models.Message{}
		for _, msg := range messages {
			for _, sid := range selectedIDs {
				// 支持 uint 转字符串对比（前端 String(id) 转换后）
				if fmt.Sprintf("%d", msg.ID) == sid || fmt.Sprintf("%v", msg.ID) == sid {
					filtered = append(filtered, msg)
					break
				}
			}
		}
		// 如果 ID 匹配一个都没成功（很可能是前端 uuid 未被后端持久化），回退到全部消息
		if len(filtered) == 0 {
			filtered = messages
		} else {
			messages = filtered
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"title":    share.Title,
		"model":    share.Model,
		"messages": messages,
		"created_at": share.CreatedAt,
	})
}
