package api

import (
	"aipool-backend/internal/models"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ConversationHandler struct {
	db *gorm.DB
}

func NewConversationHandler(db *gorm.DB) *ConversationHandler {
	return &ConversationHandler{db: db}
}

func (h *ConversationHandler) List(c *gin.Context) {
	userID := getUserID(c)

	var conversations []models.Conversation
	if err := h.db.Where("user_id = ?", userID).Order("pinned desc, updated_at desc").Find(&conversations).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取对话列表失败"})
		return
	}

	c.JSON(http.StatusOK, conversations)
}

func (h *ConversationHandler) Create(c *gin.Context) {
	userID := getUserID(c)

	var req struct {
		Title     string `json:"title"`
		Model     string `json:"model"`
		SkillKey  string `json:"skill_key,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	conv := models.Conversation{
		UserID:   userID,
		Title:    req.Title,
		Model:    req.Model,
		SkillKey: req.SkillKey,
	}

	if err := h.db.Create(&conv).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建对话失败"})
		return
	}

	c.JSON(http.StatusCreated, conv)
}

func (h *ConversationHandler) Get(c *gin.Context) {
	userID := getUserID(c)
	id := c.Param("id")

	var conv models.Conversation
	if err := h.db.Where("id = ? AND user_id = ?", id, userID).First(&conv).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "对话不存在"})
		return
	}

	// 加载消息
	h.db.Where("conversation_id = ?", conv.ID).Order("created_at asc").Find(&conv.Messages)

	c.JSON(http.StatusOK, conv)
}

func (h *ConversationHandler) Delete(c *gin.Context) {
	userID := getUserID(c)
	id := c.Param("id")

	if err := h.db.Where("id = ? AND user_id = ?", id, userID).Delete(&models.Conversation{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除对话失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

func (h *ConversationHandler) Update(c *gin.Context) {
	userID := getUserID(c)
	id := c.Param("id")

	var req struct {
		Title  string `json:"title"`
		Pinned *bool  `json:"pinned,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var conv models.Conversation
	if err := h.db.Where("id = ? AND user_id = ?", id, userID).First(&conv).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "对话不存在"})
		return
	}

	updates := map[string]interface{}{}
	if req.Title != "" {
		updates["title"] = req.Title
	}
	if req.Pinned != nil {
		updates["pinned"] = *req.Pinned
	}

	if len(updates) > 0 {
		if err := h.db.Model(&conv).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "更新对话失败"})
			return
		}
	}

	c.JSON(http.StatusOK, conv)
}

func (h *ConversationHandler) GetMessages(c *gin.Context) {
	userID := getUserID(c)
	convID := c.Param("id")

	// 验证对话属于当前用户
	var conv models.Conversation
	if err := h.db.Where("id = ? AND user_id = ?", convID, userID).First(&conv).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "对话不存在"})
		return
	}

	var messages []models.Message
	if err := h.db.Where("conversation_id = ?", convID).Order("created_at asc").Find(&messages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取消息失败"})
		return
	}

	c.JSON(http.StatusOK, messages)
}

func (h *ConversationHandler) AddMessage(c *gin.Context) {
	userID := getUserID(c)
	convID := c.Param("id")

	// 验证对话属于当前用户
	var conv models.Conversation
	if err := h.db.Where("id = ? AND user_id = ?", convID, userID).First(&conv).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "对话不存在"})
		return
	}

	var req struct {
		Role    string `json:"role" binding:"required"`
		Content string `json:"content" binding:"required"`
		Model   string `json:"model"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cid, _ := strconv.ParseUint(convID, 10, 32)
	msg := models.Message{
		ConversationID: uint(cid),
		Role:           req.Role,
		Content:        req.Content,
		Model:          req.Model,
		CreatedAt:      time.Now(),
	}

	if err := h.db.Create(&msg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "添加消息失败"})
		return
	}

	// 更新对话时间
	h.db.Model(&conv).Update("updated_at", time.Now())

	c.JSON(http.StatusCreated, msg)
}
