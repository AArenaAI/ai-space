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
	if msg.Role != "assistant" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "只能收藏 AI 回答"})
		return
	}

	// 查找对应的用户消息（用 id < msg.ID 更可靠，避免 created_at 时序问题）
	var userMsg models.Message
	if err := h.db.Where("conversation_id = ? AND role = ? AND id < ?", req.ConvID, "user", msg.ID).
		Order("id desc").
		First(&userMsg).Error; err != nil {
		userMsg.ID = 0
	}

	// 检查是否已收藏：对比模式同一轮回答共享 group_id，只允许收藏一次
	var existing models.MessageFavorite
	query := h.db.Where("user_id = ?", userID)
	if msg.GroupID > 0 {
		query = query.Where("group_id = ?", msg.GroupID)
	} else {
		query = query.Where("message_id = ?", req.MessageID)
	}
	if err := query.First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "已收藏"})
		return
	}

	fav := models.MessageFavorite{
		UserID:    userID,
		MessageID: req.MessageID,
		GroupID:   msg.GroupID,
		ConvID:    req.ConvID,
		UserMsgID: userMsg.ID,
		ModelID:   msg.Model,
		Content:   msg.Content,
		CreatedAt: time.Now(),
	}

	if err := h.db.Create(&fav).Error; err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			c.JSON(http.StatusConflict, gin.H{"error": "已收藏"})
			return
		}
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

	var msg models.Message
	deleteQuery := h.db.Where("user_id = ?", userID)
	if err := h.db.First(&msg, uint(messageID)).Error; err == nil && msg.GroupID > 0 {
		deleteQuery = deleteQuery.Where("group_id = ?", msg.GroupID)
	} else {
		deleteQuery = deleteQuery.Where("message_id = ?", uint(messageID))
	}

	if err := deleteQuery.
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

	keyword := strings.TrimSpace(c.Query("q"))

	// 构建基础查询
	var favs []models.MessageFavorite
	dbQuery := h.db.Where("user_id = ?", userID)
	if keyword != "" {
		like := "%" + keyword + "%"
		dbQuery = dbQuery.Where(
			"content LIKE ? OR model_id LIKE ?",
			like, like,
		)
	}
	if err := dbQuery.Order("created_at desc").
		Limit(pageSize).Offset(offset).
		Find(&favs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取收藏失败"})
		return
	}

	var total int64
	countQuery := h.db.Model(&models.MessageFavorite{}).Where("user_id = ?", userID)
	if keyword != "" {
		like := "%" + keyword + "%"
		countQuery = countQuery.Where(
			"content LIKE ? OR model_id LIKE ?",
			like, like,
		)
	}
	countQuery.Count(&total)

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
		h.db.Where("id IN ? AND role = ?", ids, "user").Find(&msgs)
		for _, m := range msgs {
			userQueries[m.ID] = m.Content
		}
	}

	items := make([]FavoriteItem, len(favs))
	for i, f := range favs {
		items[i] = FavoriteItem{
			ID:        f.ID,
			MessageID: f.MessageID,
			GroupID:   f.GroupID,
			ConvID:    f.ConvID,
			UserMsgID: f.UserMsgID,
			ModelID:   f.ModelID,
			Content:   f.Content,
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
	var msg models.Message
	query := h.db.Model(&models.MessageFavorite{}).Where("user_id = ?", userID)
	if err := h.db.First(&msg, uint(messageID)).Error; err == nil && msg.GroupID > 0 {
		query = query.Where("group_id = ?", msg.GroupID)
	} else {
		query = query.Where("message_id = ?", uint(messageID))
	}
	query.Count(&count)

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
		var msgs []models.Message
		h.db.Select("id, group_id").Where("id IN ?", ids).Find(&msgs)
		messageGroups := make(map[uint]uint, len(msgs))
		var groupIDs []uint
		for _, msg := range msgs {
			messageGroups[msg.ID] = msg.GroupID
			if msg.GroupID > 0 {
				groupIDs = append(groupIDs, msg.GroupID)
			}
		}

		var favs []models.MessageFavorite
		favQuery := h.db.Select("message_id, group_id").Where("user_id = ? AND message_id IN ?", userID, ids)
		if len(groupIDs) > 0 {
			favQuery = h.db.Select("message_id, group_id").Where("user_id = ? AND (message_id IN ? OR group_id IN ?)", userID, ids, groupIDs)
		}
		favQuery.Find(&favs)
		favMessages := make(map[uint]bool, len(favs))
		favGroups := make(map[uint]bool, len(favs))
		for _, f := range favs {
			if f.MessageID > 0 {
				favMessages[f.MessageID] = true
			}
			if f.GroupID > 0 {
				favGroups[f.GroupID] = true
			}
		}
		for _, id := range ids {
			if favMessages[id] || (messageGroups[id] > 0 && favGroups[messageGroups[id]]) {
				result[id] = true
			}
		}
	}

	c.JSON(http.StatusOK, result)
}
