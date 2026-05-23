package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type VideoChatHandler struct {
	db           *gorm.DB
	videoService *services.VideoService
	cfg          *config.Config
}

func NewVideoChatHandler(db *gorm.DB, videoService *services.VideoService, cfg *config.Config) *VideoChatHandler {
	return &VideoChatHandler{db: db, videoService: videoService, cfg: cfg}
}

// AutoMigrate 创建视频会话表
func (h *VideoChatHandler) AutoMigrate() {
	h.db.AutoMigrate(&models.VideoChat{}, &models.VideoChatMessage{})
}

type videoChatRequest struct {
	Prompt          string   `json:"prompt" binding:"required"`
	Model           string   `json:"model"`
	Ratio           string   `json:"ratio"`
	AspectRatio     string   `json:"aspect_ratio"`
	Duration        int64    `json:"duration"`
	GenerateAudio   bool     `json:"generate_audio"`
	Watermark       bool     `json:"watermark"`
	ReferenceImages []string `json:"reference_image_urls"`
	ReferenceVideos []string `json:"reference_video_urls"`
	ReferenceAudios []string `json:"reference_audio_urls"`
}

// ListVideoChats 获取用户的视频会话列表
func (h *VideoChatHandler) ListVideoChats(c *gin.Context) {
	userID := getUserID(c)
	var chats []models.VideoChat
	if err := h.db.Where("user_id = ?", userID).Order("updated_at DESC").Find(&chats).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取视频会话列表失败"})
		return
	}

	type chatCover struct {
		ChatID   uint   `json:"chat_id"`
		VideoURL string `json:"video_url"`
	}
	chatIDs := make([]uint, 0, len(chats))
	for _, ch := range chats {
		chatIDs = append(chatIDs, ch.ID)
	}
	var covers []chatCover
	if len(chatIDs) > 0 {
		h.db.Raw(`
			SELECT chat_id, video_url FROM video_chat_messages
			WHERE chat_id IN ? AND role = 'assistant' AND status IN ('succeeded', 'completed') AND video_url != ''
			AND id = (
				SELECT MIN(id) FROM video_chat_messages AS sub
				WHERE sub.chat_id = video_chat_messages.chat_id AND sub.role = 'assistant' AND sub.status IN ('succeeded', 'completed') AND sub.video_url != ''
			)
		`, chatIDs).Scan(&covers)
	}
	coverMap := make(map[uint]string, len(covers))
	for _, cv := range covers {
		coverMap[cv.ChatID] = cv.VideoURL
	}

	type chatWithCover struct {
		models.VideoChat
		CoverVideo string `json:"cover_video"`
	}
	result := make([]chatWithCover, 0, len(chats))
	for _, ch := range chats {
		result = append(result, chatWithCover{VideoChat: ch, CoverVideo: coverMap[ch.ID]})
	}
	c.JSON(http.StatusOK, gin.H{"chats": result})
}

// CreateVideoChat 创建新视频会话并发送第一条消息
func (h *VideoChatHandler) CreateVideoChat(c *gin.Context) {
	userID := getUserID(c)
	var req videoChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	title := req.Prompt
	if title == "" {
		title = "新视频会话"
	}
	if len(title) > 30 {
		title = title[:30] + "..."
	}
	chat := models.VideoChat{UserID: userID, Title: title}
	if err := h.db.Create(&chat).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建视频会话失败"})
		return
	}

	assistantMsg, err := h.createVideoChatMessagesAndTask(userID, chat.ID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"chat":       chat,
		"chat_id":    chat.ID,
		"message_id": assistantMsg.ID,
		"task_id":    assistantMsg.TaskID,
		"status":     assistantMsg.Status,
	})
}

// GetVideoChat 获取会话详情
func (h *VideoChatHandler) GetVideoChat(c *gin.Context) {
	userID := getUserID(c)
	chatID := c.Param("id")
	var chat models.VideoChat
	if err := h.db.Where("id = ? AND user_id = ?", chatID, userID).First(&chat).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "视频会话不存在"})
		return
	}
	c.JSON(http.StatusOK, chat)
}

// UpdateVideoChat 更新会话标题
func (h *VideoChatHandler) UpdateVideoChat(c *gin.Context) {
	userID := getUserID(c)
	chatID := c.Param("id")
	var req struct {
		Title string `json:"title" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result := h.db.Model(&models.VideoChat{}).Where("id = ? AND user_id = ?", chatID, userID).Update("title", req.Title)
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "视频会话不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

// DeleteVideoChat 删除会话及所有消息
func (h *VideoChatHandler) DeleteVideoChat(c *gin.Context) {
	userID := getUserID(c)
	chatID := c.Param("id")
	var chat models.VideoChat
	if err := h.db.Where("id = ? AND user_id = ?", chatID, userID).First(&chat).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "视频会话不存在"})
		return
	}
	h.db.Where("chat_id = ?", chat.ID).Delete(&models.VideoChatMessage{})
	h.db.Delete(&chat)
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// ListVideoChatMessages 获取会话消息列表，同时刷新未完成视频任务状态
func (h *VideoChatHandler) ListVideoChatMessages(c *gin.Context) {
	userID := getUserID(c)
	chatID := c.Param("id")
	var chat models.VideoChat
	if err := h.db.Where("id = ? AND user_id = ?", chatID, userID).First(&chat).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "视频会话不存在"})
		return
	}

	h.refreshPendingVideoChatMessages(chat.ID)

	var messages []models.VideoChatMessage
	if err := h.db.Where("chat_id = ?", chat.ID).Order("created_at ASC").Find(&messages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取视频消息失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"messages": messages})
}

// SendVideoChatMessage 在现有视频会话中发送新消息并生成视频
func (h *VideoChatHandler) SendVideoChatMessage(c *gin.Context) {
	userID := getUserID(c)
	chatID := c.Param("id")
	var chat models.VideoChat
	if err := h.db.Where("id = ? AND user_id = ?", chatID, userID).First(&chat).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "视频会话不存在"})
		return
	}

	var req videoChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	assistantMsg, err := h.createVideoChatMessagesAndTask(userID, chat.ID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.db.Model(&chat).Update("updated_at", time.Now())

	c.JSON(http.StatusOK, gin.H{
		"message_id": assistantMsg.ID,
		"chat_id":    chat.ID,
		"task_id":    assistantMsg.TaskID,
		"status":     assistantMsg.Status,
	})
}

func (h *VideoChatHandler) createVideoChatMessagesAndTask(userID uint, chatID uint, req videoChatRequest) (*models.VideoChatMessage, error) {
	modelID := req.Model
	if modelID == "" {
		modelID = "doubao-seedance-2-0-fast-260128"
	}
	ratio := req.Ratio
	if ratio == "" {
		ratio = req.AspectRatio
	}
	duration := req.Duration
	if duration <= 0 {
		duration = 5
	}
	resolution := ""
	if ratio != "" && ratio != "auto" {
		resolution = resolveVideoResolution(ratio)
	}

	userMsg := models.VideoChatMessage{ChatID: chatID, Role: "user", Content: req.Prompt}
	if err := h.db.Create(&userMsg).Error; err != nil {
		return nil, err
	}

	assistantMsg := models.VideoChatMessage{
		ChatID:        chatID,
		Role:          "assistant",
		Content:       req.Prompt,
		Status:        "pending",
		Model:         modelID,
		Ratio:         ratio,
		Duration:      duration,
		GenerateAudio: req.GenerateAudio,
		Watermark:     req.Watermark,
	}
	if err := h.db.Create(&assistantMsg).Error; err != nil {
		return nil, err
	}

	createReq := services.CreateVideoTaskRequest{
		Model:           modelID,
		Prompt:          req.Prompt,
		Ratio:           ratio,
		Resolution:      resolution,
		Duration:        duration,
		GenerateAudio:   req.GenerateAudio,
		Watermark:       req.Watermark,
		ReferenceImages: filterAndResolveURLs(req.ReferenceImages),
		ReferenceVideos: filterAndResolveURLs(req.ReferenceVideos),
		ReferenceAudios: filterAndResolveURLs(req.ReferenceAudios),
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	resp, err := h.videoService.CreateVideoTask(ctx, createReq)
	if err != nil {
		errMsg := "创建视频任务失败: " + err.Error()
		h.db.Model(&assistantMsg).Updates(map[string]interface{}{"status": "failed", "error_message": errMsg})
		assistantMsg.Status = "failed"
		assistantMsg.ErrorMessage = errMsg
		return &assistantMsg, err
	}

	video := models.VideoGeneration{
		UserID:        userID,
		Prompt:        req.Prompt,
		Model:         modelID,
		Ratio:         ratio,
		Duration:      duration,
		GenerateAudio: req.GenerateAudio,
		Watermark:     req.Watermark,
		TaskID:        resp.TaskID,
		ChatID:        chatID,
		MessageID:     assistantMsg.ID,
		Status:        resp.Status,
	}
	if err := h.db.Create(&video).Error; err != nil {
		return nil, err
	}

	h.db.Model(&assistantMsg).Updates(map[string]interface{}{
		"task_id":       resp.TaskID,
		"generation_id": video.ID,
		"status":        resp.Status,
	})
	assistantMsg.TaskID = resp.TaskID
	assistantMsg.GenerationID = video.ID
	assistantMsg.Status = resp.Status
	return &assistantMsg, nil
}

func (h *VideoChatHandler) refreshPendingVideoChatMessages(chatID uint) {
	var messages []models.VideoChatMessage
	if err := h.db.Where("chat_id = ? AND role = ? AND task_id != '' AND status NOT IN ?", chatID, "assistant", []string{"succeeded", "completed", "failed"}).Find(&messages).Error; err != nil {
		return
	}
	for _, msg := range messages {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		resp, err := h.videoService.GetVideoTask(ctx, msg.TaskID)
		cancel()
		if err != nil || resp == nil {
			continue
		}
		updates := map[string]interface{}{"status": resp.Status, "updated_at": time.Now()}
		videoUpdates := map[string]interface{}{"status": resp.Status, "updated_at": time.Now()}
		if resp.Status == "succeeded" {
			updates["video_url"] = resp.VideoURL
			videoUpdates["video_url"] = resp.VideoURL
		}
		if resp.Status == "failed" && resp.ErrorMessage != "" {
			updates["error_message"] = resp.ErrorMessage
			videoUpdates["error_message"] = resp.ErrorMessage
		}
		h.db.Model(&models.VideoChatMessage{}).Where("id = ?", msg.ID).Updates(updates)
		if msg.GenerationID > 0 {
			h.db.Model(&models.VideoGeneration{}).Where("id = ?", msg.GenerationID).Updates(videoUpdates)
		} else {
			h.db.Model(&models.VideoGeneration{}).Where("task_id = ?", msg.TaskID).Updates(videoUpdates)
		}
	}
}
