package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
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

type ChatBootstrapMediaTask struct {
	ID                uint      `json:"id"`
	Kind              string    `json:"kind"`
	Status            string    `json:"status"`
	Prompt            string    `json:"prompt,omitempty"`
	Model             string    `json:"model,omitempty"`
	Provider          string    `json:"provider,omitempty"`
	ChatID            uint      `json:"chat_id,omitempty"`
	MessageID         uint      `json:"message_id,omitempty"`
	GenerationID      uint      `json:"generation_id,omitempty"`
	TaskID            string    `json:"task_id,omitempty"`
	Href              string    `json:"href"`
	ConversationTitle string    `json:"conversation_title,omitempty"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type ChatBootstrapBilling struct {
	Tier            string `json:"tier"`
	BetaCredits     int    `json:"beta_credits"`
	BasicCredits    int    `json:"basic_credits"`
	AdvancedCredits int    `json:"advanced_credits"`
	EliteCredits    int    `json:"elite_credits"`
}

func (h *ChatBootstrapHandler) Get(c *gin.Context) {
	payload, status, ok := h.BuildPayload(c)
	if !ok {
		return
	}
	if status == http.StatusNotModified {
		c.Status(http.StatusNotModified)
		return
	}
	c.JSON(status, payload)
}

func (h *ChatBootstrapHandler) BuildPayload(c *gin.Context) (gin.H, int, bool) {
	userID, refreshedToken, ok := h.resolveBootstrapUser(c)
	if !ok {
		return nil, http.StatusInternalServerError, false
	}
	if userID == 0 {
		return gin.H{"auth_status": "anonymous", "http_status": http.StatusUnauthorized, "error": "未提供认证信息"}, http.StatusUnauthorized, true
	}

	var user models.User
	if err := h.db.First(&user, userID).Error; err != nil {
		return gin.H{"auth_status": "anonymous", "http_status": http.StatusUnauthorized, "error": "用户不存在"}, http.StatusUnauthorized, true
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
	pinnedConversations := h.listBootstrapPinnedConversations(userID, workspaceID, 12)
	recentNotebooks := h.listBootstrapRecentNotebooks(userID, workspaceID, 8)

	payload := gin.H{
		"auth_status": "authenticated",
		"http_status": http.StatusOK,
		"server_time": time.Now().UTC().Format(time.RFC3339Nano),
		"user":        authUserPayload(user, defaultWorkspaceID),
		"token":       refreshedToken,
		"workspace": gin.H{
			"current_id": workspaceID,
			"default_id": defaultWorkspaceID,
			"items":      workspaces,
		},
		"models":  mergeModelConfigs(modelmeta.ChatModels()),
		"billing": h.bootstrapBillingPayload(user),
		"sidebar": gin.H{
			"conversations":    conversationList,
			"pinned":           pinnedConversations,
			"recent_notebooks": recentNotebooks,
			"total":            conversationTotal,
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
		payload["requested_conversation_id"] = conversationID
		meta, snapshot, ok := h.buildConversationBootstrap(c, userID, conversationID)
		if !ok {
			payload["http_status"] = http.StatusNotFound
			payload["error"] = "对话不存在"
			return payload, http.StatusNotFound, true
		}
		if chatBootstrapETagMatches(c.GetHeader("If-None-Match"), snapshot.SnapshotVersion) {
			return payload, http.StatusNotModified, true
		}
		payload["conversation"] = meta
		payload["snapshot"] = snapshot
	}
	payload["active_tasks"] = gin.H{
		"chat":  h.listActiveChatTasks(userID, conversationID),
		"image": h.listActiveImageTasks(userID),
		"video": h.listActiveVideoTasks(userID),
	}

	return payload, http.StatusOK, true
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
	statuses := []string{"running", "streaming", "retrying"}
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

func (h *ChatBootstrapHandler) listActiveImageTasks(userID uint) []ChatBootstrapMediaTask {
	out := make([]ChatBootstrapMediaTask, 0, 20)
	var generations []services.ImageGeneration
	if err := h.db.Where("user_id = ? AND status IN ?", userID, []string{"pending"}).Order("updated_at DESC, id DESC").Limit(20).Find(&generations).Error; err == nil {
		for _, item := range generations {
			href := "/image"
			if strings.Contains(strings.ToLower(item.Provider), "seedream") {
				href = "/ai-comic"
			}
			out = append(out, ChatBootstrapMediaTask{ID: item.ID, Kind: "standalone", Status: item.Status, Prompt: item.Prompt, Provider: item.Provider, Href: href, UpdatedAt: item.UpdatedAt})
		}
	}
	type imageChatRow struct {
		models.ImageChatMessage
		ChatTitle string `gorm:"column:chat_title"`
	}
	var chatRows []imageChatRow
	if err := h.db.Table("image_chat_messages").
		Select("image_chat_messages.*, image_chats.title AS chat_title").
		Joins("JOIN image_chats ON image_chats.id = image_chat_messages.chat_id").
		Where("image_chats.user_id = ? AND image_chat_messages.role = ? AND image_chat_messages.status IN ?", userID, "assistant", []string{"pending"}).
		Where("(image_chat_messages.media_type = '' OR image_chat_messages.media_type = 'image' OR image_chat_messages.media_type IS NULL)").
		Order("image_chat_messages.updated_at DESC, image_chat_messages.id DESC").
		Limit(20).
		Find(&chatRows).Error; err == nil {
		for _, item := range chatRows {
			out = append(out, ChatBootstrapMediaTask{ID: item.ID, Kind: "chat", Status: item.Status, Prompt: item.Content, Model: item.Model, ChatID: item.ChatID, MessageID: item.ID, TaskID: item.TaskID, Href: fmt.Sprintf("/image/chat?chatId=%d", item.ChatID), ConversationTitle: item.ChatTitle, UpdatedAt: item.CreatedAt})
		}
	}
	if len(out) > 20 {
		out = out[:20]
	}
	return out
}

func (h *ChatBootstrapHandler) listActiveVideoTasks(userID uint) []ChatBootstrapMediaTask {
	out := make([]ChatBootstrapMediaTask, 0, 20)
	var generations []models.VideoGeneration
	if err := h.db.Where("user_id = ? AND status IN ?", userID, []string{"pending", "running"}).Order("updated_at DESC, id DESC").Limit(20).Find(&generations).Error; err == nil {
		for _, item := range generations {
			out = append(out, ChatBootstrapMediaTask{ID: item.ID, Kind: "standalone", Status: item.Status, Prompt: item.Prompt, Model: item.Model, TaskID: item.TaskID, Href: "/video", UpdatedAt: item.UpdatedAt})
		}
	}
	type videoChatRow struct {
		models.VideoChatMessage
		ChatTitle string `gorm:"column:chat_title"`
	}
	var chatRows []videoChatRow
	if err := h.db.Table("video_chat_messages").
		Select("video_chat_messages.*, video_chats.title AS chat_title").
		Joins("JOIN video_chats ON video_chats.id = video_chat_messages.chat_id").
		Where("video_chats.user_id = ? AND video_chat_messages.role = ? AND video_chat_messages.status IN ?", userID, "assistant", []string{"pending", "running"}).
		Order("video_chat_messages.updated_at DESC, video_chat_messages.id DESC").
		Limit(20).
		Find(&chatRows).Error; err == nil {
		for _, item := range chatRows {
			out = append(out, ChatBootstrapMediaTask{ID: item.ID, Kind: "chat", Status: item.Status, Prompt: item.Content, Model: item.Model, ChatID: item.ChatID, MessageID: item.ID, GenerationID: item.GenerationID, TaskID: item.TaskID, Href: fmt.Sprintf("/video/chat?chatId=%d", item.ChatID), ConversationTitle: item.ChatTitle, UpdatedAt: item.UpdatedAt})
		}
	}
	if len(out) > 20 {
		out = out[:20]
	}
	return out
}

func (h *ChatBootstrapHandler) bootstrapBillingPayload(user models.User) ChatBootstrapBilling {
	return ChatBootstrapBilling{
		Tier:            user.PlanTier,
		BetaCredits:     user.BetaCreditBalance,
		BasicCredits:    user.BasicCredits,
		AdvancedCredits: user.AdvancedCredits,
		EliteCredits:    user.EliteCredits,
	}
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

func (h *ChatBootstrapHandler) listBootstrapPinnedConversations(userID uint, workspaceID uint, limit int) []models.Conversation {
	if limit <= 0 {
		limit = 12
	}
	query := h.db.Model(&models.Conversation{}).
		Where("user_id = ? AND deleted_at IS NULL AND pinned = ?", userID, true).
		Where("NOT EXISTS (SELECT 1 FROM notebook_conversations WHERE notebook_conversations.conversation_id = conversations.id)")
	if workspaceID > 0 {
		query = query.Where("workspace_id = ?", workspaceID)
	}
	var conversations []models.Conversation
	if err := query.Order("updated_at DESC").Limit(limit).Find(&conversations).Error; err != nil {
		return []models.Conversation{}
	}
	return conversations
}

func (h *ChatBootstrapHandler) listBootstrapRecentNotebooks(userID uint, workspaceID uint, limit int) []NotebookListItem {
	if limit <= 0 {
		limit = 8
	}
	query := h.db.Model(&models.Notebook{}).Where("user_id = ?", userID)
	if workspaceID > 0 {
		query = query.Where("workspace_id = ?", workspaceID)
	}
	var notebooks []models.Notebook
	if err := query.Order("updated_at DESC").Limit(limit).Find(&notebooks).Error; err != nil {
		return []NotebookListItem{}
	}
	items := make([]NotebookListItem, 0, len(notebooks))
	for _, notebook := range notebooks {
		var count int64
		h.db.Model(&models.NotebookFile{}).Where("notebook_id = ?", notebook.ID).Count(&count)
		items = append(items, NotebookListItem{Notebook: notebook, FileCount: count})
	}
	return items
}

func (h *ChatBootstrapHandler) buildConversationBootstrap(c *gin.Context, userID uint, conversationID uint) (ChatBootstrapConversationMeta, ChatBootstrapSnapshot, bool) {
	var conv models.Conversation
	if err := h.db.Where("id = ? AND user_id = ?", conversationID, userID).First(&conv).Error; err != nil {
		return ChatBootstrapConversationMeta{}, ChatBootstrapSnapshot{}, false
	}

	msgTail := defaultChatBootstrapTail
	if tail, err := strconv.Atoi(c.Query("message_tail")); err == nil && tail > 0 && tail <= 200 {
		msgTail = tail
	}

	var total int64
	h.db.Model(&models.Message{}).Where("conversation_id = ?", conv.ID).Count(&total)
	snapshotVersion := fmt.Sprintf("%d:%d:%d:%s:group-window-v2", conv.ID, total, conv.UpdatedAt.UnixNano(), h.activeChatTaskSnapshotSignature(userID, conv.ID))

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
	h.applyActiveChatTaskMessageState(&messagesPayload, conv.ID, userID, conv.Model)
	var statusPayload gin.H
	if status := convHandler.buildLastAssistantStatusPayload(messages); status != nil {
		statusPayload = status
	}
	if statusPayload == nil {
		statusPayload = h.buildActiveTaskLastAssistantStatus(conv.ID, userID)
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
	statuses := []string{"running", "streaming", "retrying"}
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

func (h *ChatBootstrapHandler) activeChatTasksForConversation(userID uint, conversationID uint) []models.AIBackgroundTask {
	statuses := []string{"running", "streaming", "retrying"}
	var tasks []models.AIBackgroundTask
	if err := h.db.Where("user_id = ? AND conversation_id = ? AND status IN ?", userID, conversationID, statuses).
		Order("updated_at DESC, id DESC").
		Limit(20).
		Find(&tasks).Error; err != nil {
		return nil
	}
	return tasks
}

func (h *ChatBootstrapHandler) applyActiveChatTaskMessageState(messages *[]MessageWithGroup, conversationID uint, userID uint, fallbackModel string) {
	if messages == nil {
		return
	}
	tasks := h.activeChatTasksForConversation(userID, conversationID)
	if len(tasks) == 0 {
		return
	}
	existing := make(map[uint]int, len(*messages))
	for i, message := range *messages {
		if message.Role == "assistant" {
			existing[message.ID] = i
		}
	}
	for _, task := range tasks {
		model := firstNonEmptyBootstrap(task.Model, fallbackModel)
		if idx, ok := existing[task.AssistantMessageID]; ok && task.AssistantMessageID > 0 {
			(*messages)[idx].GenerationTaskID = task.ID
			(*messages)[idx].LastSequenceNumber = task.LastSequenceNumber
			(*messages)[idx].ServerGenerationStatus = task.Status
			continue
		}
		pending := MessageWithGroup{
			Message: models.Message{
				ID:             task.AssistantMessageID,
				ConversationID: task.ConversationID,
				Role:           "assistant",
				Content:        "",
				Model:          model,
				CreatedAt:      task.CreatedAt,
			},
			GenerationTaskID:       task.ID,
			LastSequenceNumber:     task.LastSequenceNumber,
			ServerGenerationStatus: task.Status,
		}
		*messages = append(*messages, pending)
		if task.AssistantMessageID > 0 {
			existing[task.AssistantMessageID] = len(*messages) - 1
		}
	}
	sort.SliceStable(*messages, func(i, j int) bool {
		if (*messages)[i].CreatedAt.Equal((*messages)[j].CreatedAt) {
			return (*messages)[i].ID < (*messages)[j].ID
		}
		return (*messages)[i].CreatedAt.Before((*messages)[j].CreatedAt)
	})
}

func (h *ChatBootstrapHandler) buildActiveTaskLastAssistantStatus(conversationID uint, userID uint) gin.H {
	tasks := h.activeChatTasksForConversation(userID, conversationID)
	if len(tasks) == 0 {
		return nil
	}
	task := tasks[0]
	return gin.H{
		"message": gin.H{
			"id":              task.AssistantMessageID,
			"conversation_id": task.ConversationID,
			"role":            "assistant",
			"content":         "",
			"model":           task.Model,
			"created_at":      task.CreatedAt,
		},
		"background_task": gin.H{
			"id":                   task.ID,
			"task_id":              task.ID,
			"assistant_message_id": task.AssistantMessageID,
			"conversation_id":      task.ConversationID,
			"status":               task.Status,
			"last_sequence_number": task.LastSequenceNumber,
			"completed_at":         task.CompletedAt,
		},
	}
}

func (h *ChatBootstrapHandler) activeChatTaskSnapshotSignature(userID uint, conversationID uint) string {
	statuses := []string{"running", "streaming", "retrying"}
	var tasks []models.AIBackgroundTask
	if err := h.db.Where("user_id = ? AND conversation_id = ? AND status IN ?", userID, conversationID, statuses).
		Order("updated_at DESC, id DESC").
		Limit(20).
		Find(&tasks).Error; err != nil || len(tasks) == 0 {
		return "no-active-task"
	}
	parts := make([]string, 0, len(tasks))
	for _, task := range tasks {
		parts = append(parts, fmt.Sprintf("%d:%d:%s:%d:%d", task.ID, task.AssistantMessageID, task.Status, task.LastSequenceNumber, task.UpdatedAt.UnixNano()))
	}
	return strings.Join(parts, "|")
}

func chatBootstrapETagMatches(headerValue string, snapshotVersion string) bool {
	if headerValue == "" || snapshotVersion == "" {
		return false
	}
	for _, value := range strings.Split(headerValue, ",") {
		trimmed := strings.TrimSpace(value)
		if trimmed == snapshotVersion || trimmed == fmt.Sprintf("\"%s\"", snapshotVersion) {
			return true
		}
	}
	return false
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
