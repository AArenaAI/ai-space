package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/models"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const defaultChatBootstrapTail = 32
const defaultChatBootstrapConversationLimit = 30

type ChatBootstrapHandler struct {
	db  *gorm.DB
	cfg *config.Config
}

func NewChatBootstrapHandler(db *gorm.DB, cfg *config.Config) *ChatBootstrapHandler {
	return &ChatBootstrapHandler{db: db, cfg: cfg}
}

type ChatBootstrapConversationMeta struct {
	ID            uint      `json:"id"`
	Title         string    `json:"title"`
	Model         string    `json:"model,omitempty"`
	SkillKey      string    `json:"skill_key,omitempty"`
	WorkspaceID   uint      `json:"workspace_id,omitempty"`
	Compare       bool      `json:"compare"`
	CompareModels []string  `json:"compare_models,omitempty"`
	Pinned        bool      `json:"pinned"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type ChatBootstrapSnapshot struct {
	Messages            []MessageWithGroup `json:"messages"`
	Total               int64              `json:"total"`
	HasMore             bool               `json:"has_more"`
	SnapshotVersion     string             `json:"snapshot_version,omitempty"`
	LastAssistantStatus gin.H              `json:"last_assistant_status,omitempty"`
}

type ChatBootstrapActiveTask struct {
	ID                 uint      `json:"id"`
	ConversationID     uint      `json:"conversation_id"`
	AssistantMessageID uint      `json:"assistant_message_id"`
	Model              string    `json:"model,omitempty"`
	Provider           string    `json:"provider,omitempty"`
	Status             string    `json:"status"`
	LastSequenceNumber int64     `json:"last_sequence_number"`
	UpdatedAt          time.Time `json:"updated_at"`
}

func (h *ChatBootstrapHandler) Get(c *gin.Context) {
	userID, refreshedToken, ok := h.resolveBootstrapUser(c)
	if !ok {
		return
	}
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"auth_status": "anonymous", "error": "未提供认证信息"})
		return
	}

	var user models.User
	if err := h.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"auth_status": "anonymous", "error": "用户不存在"})
		return
	}

	var workspaces []models.Workspace
	h.db.Where("user_id = ?", userID).Order("is_default desc, created_at asc").Find(&workspaces)
	var defaultWorkspaceID uint
	for _, workspace := range workspaces {
		if workspace.IsDefault {
			defaultWorkspaceID = workspace.ID
			break
		}
	}

	workspaceID := parseOptionalUint(c.Query("workspace_id"))
	if workspaceID == 0 {
		workspaceID = parseOptionalUint(c.Query("current_workspace_id"))
	}
	if workspaceID == 0 {
		workspaceID = defaultWorkspaceID
	}

	conversationLimit := defaultChatBootstrapConversationLimit
	if limit, err := strconv.Atoi(c.Query("conversation_limit")); err == nil && limit > 0 && limit <= 100 {
		conversationLimit = limit
	}
	conversationList, conversationTotal := h.listBootstrapConversations(userID, workspaceID, conversationLimit)

	payload := gin.H{
		"auth_status": "authenticated",
		"server_time": time.Now().UTC().Format(time.RFC3339Nano),
		"user":        authUserPayload(user, defaultWorkspaceID),
		"token":       refreshedToken,
		"workspace": gin.H{
			"current_id": workspaceID,
			"default_id": defaultWorkspaceID,
			"items":      workspaces,
		},
		"models": mergeModelConfigs(modelmeta.ChatModels()),
		"sidebar": gin.H{
			"conversations": conversationList,
			"total":         conversationTotal,
		},
		"feature_flags": gin.H{
			"chat_bootstrap":             true,
			"dynamic_bootstrap_shell":    true,
			"compare_user_message_id":    true,
			"local_background_chat_task": true,
		},
	}
	if refreshedToken == "" {
		delete(payload, "token")
	}

	conversationID := parseOptionalUint(firstNonEmptyBootstrap(c.Query("id"), c.Query("conversation_id")))
	if conversationID > 0 {
		meta, snapshot, ok := h.buildConversationBootstrap(c, userID, conversationID)
		if !ok {
			return
		}
		payload["conversation"] = meta
		payload["snapshot"] = snapshot
	}
	payload["active_tasks"] = gin.H{"chat": h.listActiveChatTasks(userID, conversationID)}

	c.JSON(http.StatusOK, payload)
}

func (h *ChatBootstrapHandler) resolveBootstrapUser(c *gin.Context) (uint, string, bool) {
	if userID := getUserID(c); userID > 0 {
		return userID, "", true
	}
	cookie, err := c.Request.Cookie(refreshTokenCookieName)
	if err != nil || cookie == nil || cookie.Value == "" {
		return 0, "", true
	}
	now := time.Now()
	var stored models.RefreshToken
	if err := h.db.Where("token_hash = ?", hashRefreshToken(cookie.Value)).First(&stored).Error; err != nil || !isRefreshTokenUsable(stored, now) {
		auth := NewAuthHandler(h.db, h.cfg)
		auth.clearRefreshTokenCookie(c)
		return 0, "", true
	}
	var user models.User
	if err := h.db.First(&user, stored.UserID).Error; err != nil {
		return 0, "", true
	}
	var token string
	auth := NewAuthHandler(h.db, h.cfg)
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.RefreshToken{}).Where("id = ? AND revoked_at IS NULL", stored.ID).Update("revoked_at", now).Error; err != nil {
			return err
		}
		var err error
		token, err = generateAccessToken(user.ID, user.Email, h.cfg.JWTSecret)
		if err != nil {
			return err
		}
		return auth.issueRefreshToken(c, tx, user.ID)
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"auth_status": "anonymous", "error": "刷新登录状态失败"})
		return 0, "", false
	}
	c.Set("userID", user.ID)
	c.Set("email", user.Email)
	return user.ID, token, true
}

func (h *ChatBootstrapHandler) listActiveChatTasks(userID uint, conversationID uint) []ChatBootstrapActiveTask {
	statuses := []string{"running", "streaming", "retrying", "incomplete"}
	query := h.db.Model(&models.AIBackgroundTask{}).Where("user_id = ? AND status IN ?", userID, statuses)
	if conversationID > 0 {
		query = query.Where("conversation_id = ?", conversationID)
	}
	var tasks []models.AIBackgroundTask
	if err := query.Order("updated_at DESC, id DESC").Limit(20).Find(&tasks).Error; err != nil {
		return []ChatBootstrapActiveTask{}
	}
	out := make([]ChatBootstrapActiveTask, len(tasks))
	for i, task := range tasks {
		out[i] = ChatBootstrapActiveTask{ID: task.ID, ConversationID: task.ConversationID, AssistantMessageID: task.AssistantMessageID, Model: task.Model, Provider: task.Provider, Status: task.Status, LastSequenceNumber: task.LastSequenceNumber, UpdatedAt: task.UpdatedAt}
	}
	return out
}

func (h *ChatBootstrapHandler) listBootstrapConversations(userID uint, workspaceID uint, limit int) ([]models.Conversation, int64) {
	queryBase := h.db.Model(&models.Conversation{}).
		Where("user_id = ? AND deleted_at IS NULL", userID).
		Where("NOT EXISTS (SELECT 1 FROM notebook_conversations WHERE notebook_conversations.conversation_id = conversations.id)")
	if workspaceID > 0 {
		queryBase = queryBase.Where("workspace_id = ?", workspaceID)
	}
	var total int64
	queryBase.Count(&total)

	type ConversationWithModel struct {
		models.Conversation
		LatestModel string `gorm:"column:latest_model" json:"-"`
	}
	query := h.db.Table("conversations").
		Select("conversations.*, (SELECT model FROM messages WHERE messages.conversation_id = conversations.id AND messages.role = 'assistant' AND messages.model <> '' ORDER BY messages.created_at DESC, messages.id DESC LIMIT 1) as latest_model").
		Where("conversations.user_id = ?", userID).
		Where("conversations.deleted_at IS NULL").
		Where("NOT EXISTS (SELECT 1 FROM notebook_conversations WHERE notebook_conversations.conversation_id = conversations.id)")
	if workspaceID > 0 {
		query = query.Where("conversations.workspace_id = ?", workspaceID)
	}
	var rows []ConversationWithModel
	if err := query.Order("conversations.pinned DESC, conversations.updated_at DESC").Limit(limit).Find(&rows).Error; err != nil {
		return []models.Conversation{}, 0
	}
	conversations := make([]models.Conversation, len(rows))
	for i := range rows {
		if rows[i].LatestModel != "" {
			rows[i].Conversation.Model = rows[i].LatestModel
		}
		conversations[i] = rows[i].Conversation
	}
	return conversations, total
}

func (h *ChatBootstrapHandler) buildConversationBootstrap(c *gin.Context, userID uint, conversationID uint) (ChatBootstrapConversationMeta, ChatBootstrapSnapshot, bool) {
	var conv models.Conversation
	if err := h.db.Where("id = ? AND user_id = ?", conversationID, userID).First(&conv).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "对话不存在"})
		return ChatBootstrapConversationMeta{}, ChatBootstrapSnapshot{}, false
	}

	msgTail := defaultChatBootstrapTail
	if tail, err := strconv.Atoi(c.Query("message_tail")); err == nil && tail > 0 && tail <= 200 {
		msgTail = tail
	}

	var total int64
	h.db.Model(&models.Message{}).Where("conversation_id = ?", conv.ID).Count(&total)
	snapshotVersion := fmt.Sprintf("%d:%d:%d:group-window-v2", conv.ID, total, conv.UpdatedAt.UnixNano())

	msgQuery := h.db.Where("conversation_id = ?", conv.ID).Order("created_at asc, id asc").Preload("MessageFiles")
	if msgTail > 0 {
		offset := int(total) - msgTail
		if offset < 0 {
			offset = 0
		}
		msgQuery = msgQuery.Offset(offset).Limit(msgTail)
	}
	var messages []models.Message
	msgQuery.Find(&messages)
	h.ensureActiveTaskMessages(&messages, conv.ID, userID)
	convHandler := NewConversationHandler(h.db)
	if expanded, err := convHandler.expandMessagesToCompleteGroups(conv.ID, messages); err == nil {
		messages = expanded
	}
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "assistant" && messages[i].Model != "" {
			conv.Model = messages[i].Model
			break
		}
	}

	messagesPayload := convHandler.buildMessagesWithGroupPayload(conv.ID, messages)
	var statusPayload gin.H
	if status := convHandler.buildLastAssistantStatusPayload(messages); status != nil {
		statusPayload = status
	}

	meta := ChatBootstrapConversationMeta{
		ID:            conv.ID,
		Title:         conv.Title,
		Model:         conv.Model,
		SkillKey:      conv.SkillKey,
		WorkspaceID:   conv.WorkspaceID,
		Compare:       conv.Compare,
		CompareModels: conv.GetCompareModels(),
		Pinned:        conv.Pinned,
		CreatedAt:     conv.CreatedAt,
		UpdatedAt:     conv.UpdatedAt,
	}
	snapshot := ChatBootstrapSnapshot{
		Messages:            messagesPayload,
		Total:               total,
		HasMore:             len(messages) < int(total),
		SnapshotVersion:     snapshotVersion,
		LastAssistantStatus: statusPayload,
	}
	return meta, snapshot, true
}

func (h *ChatBootstrapHandler) ensureActiveTaskMessages(messages *[]models.Message, conversationID uint, userID uint) {
	if messages == nil {
		return
	}
	statuses := []string{"running", "streaming", "retrying", "incomplete"}
	var tasks []models.AIBackgroundTask
	if err := h.db.Where("user_id = ? AND conversation_id = ? AND status IN ?", userID, conversationID, statuses).
		Order("updated_at DESC, id DESC").
		Limit(20).
		Find(&tasks).Error; err != nil || len(tasks) == 0 {
		return
	}
	existing := make(map[uint]bool, len(*messages))
	for _, message := range *messages {
		existing[message.ID] = true
	}
	missingIDs := make([]uint, 0)
	for _, task := range tasks {
		if task.AssistantMessageID > 0 && !existing[task.AssistantMessageID] {
			missingIDs = append(missingIDs, task.AssistantMessageID)
			existing[task.AssistantMessageID] = true
		}
	}
	if len(missingIDs) == 0 {
		return
	}
	var activeMessages []models.Message
	if err := h.db.Where("conversation_id = ? AND id IN ?", conversationID, missingIDs).
		Order("created_at asc, id asc").
		Preload("MessageFiles").
		Find(&activeMessages).Error; err != nil || len(activeMessages) == 0 {
		return
	}
	*messages = append(*messages, activeMessages...)
	sort.SliceStable(*messages, func(i, j int) bool {
		if (*messages)[i].CreatedAt.Equal((*messages)[j].CreatedAt) {
			return (*messages)[i].ID < (*messages)[j].ID
		}
		return (*messages)[i].CreatedAt.Before((*messages)[j].CreatedAt)
	})
}

func parseOptionalUint(value string) uint {
	if value == "" {
		return 0
	}
	parsed, err := strconv.ParseUint(value, 10, 32)
	if err != nil {
		return 0
	}
	return uint(parsed)
}

func firstNonEmptyBootstrap(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
