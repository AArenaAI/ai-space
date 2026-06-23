package api

import (
	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/models"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const defaultChatBootstrapTail = 32
const defaultChatBootstrapConversationLimit = 30

type ChatBootstrapHandler struct {
	db *gorm.DB
}

func NewChatBootstrapHandler(db *gorm.DB) *ChatBootstrapHandler {
	return &ChatBootstrapHandler{db: db}
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

func (h *ChatBootstrapHandler) Get(c *gin.Context) {
	userID := getUserID(c)
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

	conversationID := parseOptionalUint(firstNonEmptyBootstrap(c.Query("id"), c.Query("conversation_id")))
	if conversationID > 0 {
		meta, snapshot, ok := h.buildConversationBootstrap(c, userID, conversationID)
		if !ok {
			return
		}
		payload["conversation"] = meta
		payload["snapshot"] = snapshot
	}

	c.JSON(http.StatusOK, payload)
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
