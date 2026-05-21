package api

import (
	"aipool-backend/internal/models"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type FavoriteHandler struct {
	db *gorm.DB
}

func NewFavoriteHandler(db *gorm.DB) *FavoriteHandler {
	return &FavoriteHandler{db: db}
}

type FavoriteItem struct {
	ID        uint      `json:"id"`
	MessageID uint      `json:"message_id"`
	GroupID   uint      `json:"group_id,omitempty"`
	ConvID    uint      `json:"conv_id"`
	UserMsgID uint      `json:"user_msg_id"`
	ModelID   string    `json:"model_id"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	// 关联信息
	ConvTitle string `json:"conv_title,omitempty"`
	UserQuery string `json:"user_query,omitempty"`
}

// Create 收藏消息
func (h *FavoriteHandler) Create(c *gin.Context) {
	userID := getUserID(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		return
	}

	var req struct {
		MessageID uint `json:"message_id" binding:"required"`
		ConvID    uint `json:"conv_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 验证消息属于该用户
	var msg models.Message
	if err := h.db.Joins("JOIN conversations ON conversations.id = messages.conversation_id").
		Where("messages.id = ? AND conversations.user_id = ?", req.MessageID, userID).
		First(&msg).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "消息不存在"})
		return
	}

	// 查找对应的用户消息
	var userMsg models.Message
	h.db.Where("conversation_id = ? AND role = ? AND created_at <= ?", req.ConvID, "user", msg.CreatedAt).
		Order("created_at desc, id desc").
		First(&userMsg)

	// 检查是否已收藏
	var existing models.MessageFavorite
	if err := h.db.Where("user_id = ? AND message_id = ?", userID, req.MessageID).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "已收藏"})
		return
	}

	fav := models.MessageFavorite{
		UserID:    userID,
		MessageID: req.MessageID,
		ConvID:    req.ConvID,
		UserMsgID: userMsg.ID,
		ModelID:   msg.Model,
		Content:   msg.Content,
		CreatedAt: time.Now(),
	}

	if err := h.db.Create(&fav).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "收藏失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": fav.ID, "created_at": fav.CreatedAt})
}

// Delete 取消收藏
func (h *FavoriteHandler) Delete(c *gin.Context) {
	userID := getUserID(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		return
	}

	messageIDStr := c.Param("message_id")
	messageID, err := strconv.ParseUint(messageIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的消息ID"})
		return
	}

	if err := h.db.Where("user_id = ? AND message_id = ?", userID, uint(messageID)).
		Delete(&models.MessageFavorite{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "取消收藏失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已取消收藏"})
}

// List 收藏列表
func (h *FavoriteHandler) List(c *gin.Context) {
	userID := getUserID(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		return
	}

	pageStr := c.DefaultQuery("page", "1")
	pageSizeStr := c.DefaultQuery("page_size", "20")
	page, _ := strconv.Atoi(pageStr)
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(pageSizeStr)
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	var favs []models.MessageFavorite
	if err := h.db.Where("user_id = ?", userID).
		Order("created_at desc").
		Limit(pageSize).Offset(offset).
		Find(&favs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取收藏失败"})
		return
	}

	var total int64
	h.db.Model(&models.MessageFavorite{}).Where("user_id = ?", userID).Count(&total)

	// 补充对话标题和用户问题
	convIDs := make(map[uint]bool)
	userMsgIDs := make(map[uint]bool)
	for _, f := range favs {
		convIDs[f.ConvID] = true
		if f.UserMsgID > 0 {
			userMsgIDs[f.UserMsgID] = true
		}
	}

	convTitles := make(map[uint]string)
	if len(convIDs) > 0 {
		var convs []models.Conversation
		var ids []uint
		for id := range convIDs {
			ids = append(ids, id)
		}
		h.db.Where("id IN ?", ids).Find(&convs)
		for _, c := range convs {
			convTitles[c.ID] = c.Title
		}
	}

	userQueries := make(map[uint]string)
	if len(userMsgIDs) > 0 {
		var msgs []models.Message
		var ids []uint
		for id := range userMsgIDs {
			ids = append(ids, id)
		}
		h.db.Where("id IN ?", ids).Find(&msgs)
		for _, m := range msgs {
			userQueries[m.ID] = m.Content
		}
	}

	items := make([]FavoriteItem, len(favs))
	for i, f := range favs {
		content := f.Content
		if len(content) > 300 {
			content = strings.TrimSpace(content[:300]) + "..."
		}
		items[i] = FavoriteItem{
			ID:        f.ID,
			MessageID: f.MessageID,
			GroupID:   f.GroupID,
			ConvID:    f.ConvID,
			UserMsgID: f.UserMsgID,
			ModelID:   f.ModelID,
			Content:   content,
			CreatedAt: f.CreatedAt,
			ConvTitle: convTitles[f.ConvID],
			UserQuery: userQueries[f.UserMsgID],
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"items":      items,
		"total":      total,
		"page":       page,
		"page_size":  pageSize,
		"total_page": (int(total) + pageSize - 1) / pageSize,
	})
}

// Check 检查是否已收藏
func (h *FavoriteHandler) Check(c *gin.Context) {
	userID := getUserID(c)
	if userID == 0 {
		c.JSON(http.StatusOK, gin.H{"favorited": false})
		return
	}

	messageIDStr := c.Query("message_id")
	messageID, err := strconv.ParseUint(messageIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"favorited": false})
		return
	}

	var count int64
	h.db.Model(&models.MessageFavorite{}).
		Where("user_id = ? AND message_id = ?", userID, uint(messageID)).
		Count(&count)

	c.JSON(http.StatusOK, gin.H{"favorited": count > 0})
}

// CheckBatch 批量检查是否已收藏
func (h *FavoriteHandler) CheckBatch(c *gin.Context) {
	userID := getUserID(c)
	if userID == 0 {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	idsStr := c.Query("message_ids")
	if idsStr == "" {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	var ids []uint
	for _, s := range strings.Split(idsStr, ",") {
		if id, err := strconv.ParseUint(strings.TrimSpace(s), 10, 32); err == nil {
			ids = append(ids, uint(id))
		}
	}

	result := make(map[uint]bool)
	if len(ids) > 0 {
		var favs []models.MessageFavorite
		h.db.Select("message_id").Where("user_id = ? AND message_id IN ?", userID, ids).Find(&favs)
		for _, f := range favs {
			result[f.MessageID] = true
		}
	}

	c.JSON(http.StatusOK, result)
}
