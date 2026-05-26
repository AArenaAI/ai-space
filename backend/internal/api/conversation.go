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

type ConversationHandler struct {
	db *gorm.DB
}

func NewConversationHandler(db *gorm.DB) *ConversationHandler {
	return &ConversationHandler{db: db}
}

type ConversationSearchResult struct {
	ID               uint      `json:"id"`
	Title            string    `json:"title"`
	Model            string    `json:"model"`
	SkillKey         string    `json:"skill_key"`
	Pinned           bool      `json:"pinned"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
	MatchedContent   string    `json:"matched_content"`
	MatchedRole      string    `json:"matched_role"`
	MatchedMessageID uint      `json:"matched_message_id"`
}

func (h *ConversationHandler) List(c *gin.Context) {
	userID := getUserID(c)

	// 分页参数
	limit := 200
	offset := 0
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 && l <= 500 {
		limit = l
	}
	if o, err := strconv.Atoi(c.Query("offset")); err == nil && o >= 0 {
		offset = o
	}

	// 支持 workspace_id 过滤，默认查所有
	workspaceIDStr := c.Query("workspace_id")

	var total int64
	countQuery := h.db.Model(&models.Conversation{}).Where("user_id = ?", userID)
	if workspaceIDStr != "" {
		if wid, err := strconv.ParseUint(workspaceIDStr, 10, 32); err == nil {
			countQuery = countQuery.Where("workspace_id = ?", uint(wid))
		}
	}
	skillKey := c.Query("skill_key")
	if skillKey != "" {
		countQuery = countQuery.Where("skill_key = ?", skillKey)
	}
	countQuery.Count(&total)

	type ConversationWithModel struct {
		models.Conversation
		LatestModel string `gorm:"column:latest_model" json:"-"`
	}

	query := h.db.Table("conversations").
		Select("conversations.*, (SELECT model FROM messages WHERE messages.conversation_id = conversations.id AND messages.role = 'assistant' AND messages.model <> '' ORDER BY messages.created_at DESC, messages.id DESC LIMIT 1) as latest_model").
		Where("conversations.user_id = ?", userID)

	if workspaceIDStr != "" {
		if wid, err := strconv.ParseUint(workspaceIDStr, 10, 32); err == nil {
			query = query.Where("conversations.workspace_id = ?", uint(wid))
		}
	}
	if skillKey != "" {
		query = query.Where("conversations.skill_key = ?", skillKey)
	}

	var rows []ConversationWithModel
	if err := query.Order("conversations.pinned DESC, conversations.updated_at DESC").
		Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取对话列表失败"})
		return
	}

	conversations := make([]models.Conversation, len(rows))
	for i := range rows {
		if rows[i].LatestModel != "" {
			rows[i].Conversation.Model = rows[i].LatestModel
		}
		conversations[i] = rows[i].Conversation
	}

	c.JSON(http.StatusOK, gin.H{
		"conversations": conversations,
		"total":         total,
		"limit":         limit,
		"offset":        offset,
	})
}

func (h *ConversationHandler) Search(c *gin.Context) {
	userID := getUserID(c)
	keyword := strings.TrimSpace(c.Query("q"))
	if keyword == "" {
		c.JSON(http.StatusOK, []ConversationSearchResult{})
		return
	}

	like := "%" + keyword + "%"
	titleMatchSQL := "CASE WHEN conversations.title LIKE ? THEN 1 ELSE 0 END AS title_match"
	matchedContentSQL := "COALESCE((SELECT content FROM messages WHERE messages.conversation_id = conversations.id AND messages.content LIKE ? ORDER BY messages.created_at DESC, messages.id DESC LIMIT 1), (SELECT content FROM messages WHERE messages.conversation_id = conversations.id ORDER BY messages.created_at DESC, messages.id DESC LIMIT 1), '') AS matched_content"
	matchedRoleSQL := "COALESCE((SELECT role FROM messages WHERE messages.conversation_id = conversations.id AND messages.content LIKE ? ORDER BY messages.created_at DESC, messages.id DESC LIMIT 1), '') AS matched_role"
	matchedMessageIDSQL := "COALESCE((SELECT id FROM messages WHERE messages.conversation_id = conversations.id AND messages.content LIKE ? ORDER BY messages.created_at DESC, messages.id DESC LIMIT 1), 0) AS matched_message_id"
	query := h.db.Table("conversations").
		Select("conversations.id, conversations.title, conversations.model, conversations.skill_key, conversations.pinned, conversations.created_at, conversations.updated_at, "+titleMatchSQL+", "+matchedContentSQL+", "+matchedRoleSQL+", "+matchedMessageIDSQL, like, like, like, like).
		Where("conversations.user_id = ?", userID).
		Where("conversations.title LIKE ? OR EXISTS (SELECT 1 FROM messages WHERE messages.conversation_id = conversations.id AND messages.content LIKE ?)", like, like)

	if workspaceIDStr := c.Query("workspace_id"); workspaceIDStr != "" {
		if wid, err := strconv.ParseUint(workspaceIDStr, 10, 32); err == nil && wid > 0 {
			query = query.Where("conversations.workspace_id = ?", uint(wid))
		}
	}
	if sk := c.Query("skill_key"); sk != "" {
		query = query.Where("conversations.skill_key = ?", sk)
	}

	var results []ConversationSearchResult
	if err := query.Order("title_match DESC, conversations.updated_at DESC").Limit(50).Scan(&results).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "搜索对话失败"})
		return
	}

	for i := range results {
		results[i].MatchedContent = extractContext(results[i].MatchedContent, keyword, 40)
	}

	c.JSON(http.StatusOK, results)
}

func extractContext(text, keyword string, radius int) string {
	if text == "" {
		return ""
	}
	runes := []rune(text)
	lowerText := strings.ToLower(text)
	lowerRunes := []rune(lowerText)
	lowerKeyword := strings.ToLower(keyword)
	idx := -1
	for i := range lowerRunes {
		if i+len([]rune(lowerKeyword)) > len(lowerRunes) {
			break
		}
		match := true
		for j, kr := range []rune(lowerKeyword) {
			if lowerRunes[i+j] != kr {
				match = false
				break
			}
		}
		if match {
			idx = i
			break
		}
	}
	if idx == -1 {
		if len(runes) > 120 {
			return string(runes[:120]) + "..."
		}
		return text
	}
	start := idx - radius
	if start < 0 {
		start = 0
	}
	end := idx + len([]rune(keyword)) + radius
	if end > len(runes) {
		end = len(runes)
	}
	prefix := ""
	suffix := ""
	if start > 0 {
		prefix = "..."
	}
	if end < len(runes) {
		suffix = "..."
	}
	return prefix + string(runes[start:end]) + suffix
}

func (h *ConversationHandler) Create(c *gin.Context) {
	userID := getUserID(c)

	var req struct {
		Title       string `json:"title"`
		Model       string `json:"model"`
		SkillKey    string `json:"skill_key,omitempty"`
		WorkspaceID uint   `json:"workspace_id,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 如果未指定 workspace_id，自动查找用户的默认工作区
	workspaceID := req.WorkspaceID
	if workspaceID == 0 {
		var defaultWS models.Workspace
		if err := h.db.Where("user_id = ? AND is_default = ?", userID, true).First(&defaultWS).Error; err == nil {
			workspaceID = defaultWS.ID
		}
	}

	conv := models.Conversation{
		UserID:      userID,
		WorkspaceID: workspaceID,
		Title:       req.Title,
		Model:       req.Model,
		SkillKey:    req.SkillKey,
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

	// 分页参数：不传时默认加载所有消息（兼容）
	msgLimit := 0
	msgTail := 0
	if l, err := strconv.Atoi(c.Query("message_limit")); err == nil && l > 0 {
		msgLimit = l
	}
	if t, err := strconv.Atoi(c.Query("message_tail")); err == nil && t > 0 {
		msgTail = t
	}

	msgQuery := h.db.Where("conversation_id = ?", conv.ID).Order("created_at asc, id asc").Preload("MessageFiles")
	if msgTail > 0 {
		var total int64
		h.db.Model(&models.Message{}).Where("conversation_id = ?", conv.ID).Count(&total)
		offset := int(total) - msgTail
		if offset < 0 {
			offset = 0
		}
		msgQuery = msgQuery.Offset(offset)
		if msgLimit > 0 {
			msgQuery = msgQuery.Limit(msgLimit)
		} else {
			msgQuery = msgQuery.Limit(msgTail)
		}
	} else if msgLimit > 0 {
		msgQuery = msgQuery.Limit(msgLimit)
	}
	msgQuery.Find(&conv.Messages)

	for i := len(conv.Messages) - 1; i >= 0; i-- {
		if conv.Messages[i].Role == "assistant" && conv.Messages[i].Model != "" {
			conv.Model = conv.Messages[i].Model
			break
		}
	}

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

	limit := 50
	offset := 0
	tail := 0
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 && l <= 200 {
		limit = l
	}
	if o, err := strconv.Atoi(c.Query("offset")); err == nil && o >= 0 {
		offset = o
	}
	if t, err := strconv.Atoi(c.Query("tail")); err == nil && t > 0 && t <= 200 {
		tail = t
	}

	var total int64
	h.db.Model(&models.Message{}).Where("conversation_id = ?", convID).Count(&total)

	query := h.db.Where("conversation_id = ?", convID).Order("created_at asc, id asc").Preload("MessageFiles")
	if tail > 0 && int(total) > tail {
		offset = int(total) - tail
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}

	var messages []models.Message
	if err := query.Find(&messages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取消息失败"})
		return
	}

	// 加载消息组信息
	var groups []models.MessageGroup
	h.db.Where("conversation_id = ?", convID).Find(&groups)
	groupMap := make(map[uint]*models.MessageGroup)
	for i := range groups {
		groupMap[groups[i].ID] = &groups[i]
	}

	// 组装响应：包含 group_id / group_index
	type MessageWithGroup struct {
		models.Message
		GroupID     uint     `json:"group_id,omitempty"`
		GroupIndex  int      `json:"group_index"`
		GroupModels []string `json:"group_models,omitempty"`
	}
	result := make([]MessageWithGroup, len(messages))
	for i, m := range messages {
		result[i] = MessageWithGroup{
			Message:    m,
			GroupID:    m.GroupID,
			GroupIndex: m.GroupIndex,
		}
		if g, ok := groupMap[m.GroupID]; ok {
			result[i].GroupModels = g.GetModels()
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"messages": result,
		"total":    total,
		"limit":    limit,
		"offset":   offset,
	})
}

func (h *ConversationHandler) GetMessage(c *gin.Context) {
	userID := getUserID(c)
	convID := c.Param("id")
	messageID := c.Param("message_id")

	// 验证对话属于当前用户
	var conv models.Conversation
	if err := h.db.Where("id = ? AND user_id = ?", convID, userID).First(&conv).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "对话不存在"})
		return
	}

	var msg models.Message
	if err := h.db.Where("id = ? AND conversation_id = ?", messageID, convID).Preload("MessageFiles").First(&msg).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "消息不存在"})
		return
	}

	var task models.AIBackgroundTask
	status := ""
	var taskPayload gin.H
	if err := h.db.Where("assistant_message_id = ?", msg.ID).Order("updated_at DESC, id DESC").First(&task).Error; err == nil {
		status = task.Status
		lastSequence := task.LastSequenceNumber
		if lastSequence == 0 {
			var lastEvent models.AIBackgroundTaskEvent
			if err := h.db.Where("task_id = ?", task.ID).Order("sequence_number DESC").First(&lastEvent).Error; err == nil {
				lastSequence = lastEvent.SequenceNumber
			}
		}
		taskPayload = gin.H{
			"id":                   task.ID,
			"task_id":              task.ID,
			"status":               status,
			"conversation_id":      task.ConversationID,
			"assistant_message_id": task.AssistantMessageID,
			"last_sequence_number": lastSequence,
			"completed_at":         task.CompletedAt,
			"error_message":        task.ErrorMessage,
		}
	}
	if status == "" {
		if strings.TrimSpace(msg.Content) != "" {
			status = "completed"
		} else {
			status = "generating"
		}
		taskPayload = gin.H{"status": status}
	}

	c.JSON(http.StatusOK, gin.H{
		"message":         msg,
		"background_task": taskPayload,
	})
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
