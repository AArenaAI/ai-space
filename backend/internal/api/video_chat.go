package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"log"
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
	Prompt                 string   `json:"prompt" binding:"required"`
	Model                  string   `json:"model"`
	Ratio                  string   `json:"ratio"`
	AspectRatio            string   `json:"aspect_ratio"`
	Resolution             string   `json:"resolution"`
	Duration               int64    `json:"duration"`
	GenerateAudio          bool     `json:"generate_audio"`
	Watermark              bool     `json:"watermark"`
	ReferenceImages        []string `json:"reference_image_urls"`
	ReferenceImageRoles    []string `json:"reference_image_roles"`
	ReferenceVideos        []string `json:"reference_video_urls"`
	ReferenceImageRoleMode string   `json:"reference_image_role_mode"`
}

func videoChatTitleFromPrompt(prompt string) string {
	if prompt == "" {
		return "新视频会话"
	}
	runes := []rune(prompt)
	if len(runes) > 30 {
		return string(runes[:30]) + "..."
	}
	return prompt
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
		ChatID uint   `json:"chat_id"`
		URL    string `gorm:"column:url" json:"url"`
		Status string `json:"status"`
	}
	chatIDs := make([]uint, 0, len(chats))
	for _, ch := range chats {
		chatIDs = append(chatIDs, ch.ID)
	}
	var successCovers []chatCover
	var latestStates []chatCover
	if len(chatIDs) > 0 {
		// 首封面优先使用该会话里第一条真正生成成功的视频。
		h.db.Raw(`
			SELECT chat_id, video_url AS url, status FROM video_chat_messages
			WHERE chat_id IN ? AND role = 'assistant' AND status IN ('succeeded', 'completed') AND video_url != ''
			AND id = (
				SELECT MIN(id) FROM video_chat_messages AS sub
				WHERE sub.chat_id = video_chat_messages.chat_id AND sub.role = 'assistant' AND sub.status IN ('succeeded', 'completed') AND sub.video_url != ''
			)
		`, chatIDs).Scan(&successCovers)

		// 没有成功内容时，返回最新 assistant 消息状态，供前端展示 pending/failed 占位卡。
		h.db.Raw(`
			SELECT chat_id, video_url AS url, status FROM video_chat_messages
			WHERE chat_id IN ? AND role = 'assistant'
			AND id = (
				SELECT MAX(id) FROM video_chat_messages AS sub
				WHERE sub.chat_id = video_chat_messages.chat_id AND sub.role = 'assistant'
			)
		`, chatIDs).Scan(&latestStates)
	}
	coverMap := make(map[uint]string, len(successCovers))
	for _, cv := range successCovers {
		coverMap[cv.ChatID] = cv.URL
	}
	statusMap := make(map[uint]string, len(latestStates))
	latestURLMap := make(map[uint]string, len(latestStates))
	for _, cv := range latestStates {
		statusMap[cv.ChatID] = cv.Status
		latestURLMap[cv.ChatID] = cv.URL
	}

	type chatWithCover struct {
		models.VideoChat
		CoverVideo string `json:"cover_video"`
		Status     string `json:"status"`
	}
	result := make([]chatWithCover, 0, len(chats))
	for _, ch := range chats {
		cover := coverMap[ch.ID]
		status := statusMap[ch.ID]
		if cover == "" && status == "" {
			status = "failed"
		}
		if cover == "" && (status == "succeeded" || status == "completed") {
			cover = latestURLMap[ch.ID]
		}
		result = append(result, chatWithCover{VideoChat: ch, CoverVideo: cover, Status: status})
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
	modelID := req.Model
	if modelID == "" {
		modelID = "doubao-seedance-2-0-fast-260128"
	}
	ratioInput := req.Ratio
	if ratioInput == "" {
		ratioInput = req.AspectRatio
	}
	_, duration, _, err := normalizeVideoGenerationParams(modelID, ratioInput, req.Resolution, req.Duration, len(req.ReferenceImages), len(req.ReferenceVideos))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	costFen := getModelCostFen(h.db, modelID)
	if duration > 0 {
		costFen *= int(duration)
	}
	if !ensureModelAccess(c, h.db, userID, modelID, costFen) {
		return
	}

	title := videoChatTitleFromPrompt(req.Prompt)
	chat := models.VideoChat{UserID: userID, Title: title}
	if err := h.db.Create(&chat).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建视频会话失败"})
		return
	}

	assistantMsg, err := h.createVideoChatMessagesAndTask(userID, chat.ID, req)
	if err != nil {
		h.db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("chat_id = ?", chat.ID).Delete(&models.VideoChatMessage{}).Error; err != nil {
				return err
			}
			if err := tx.Where("chat_id = ?", chat.ID).Delete(&models.VideoGeneration{}).Error; err != nil {
				return err
			}
			return tx.Delete(&chat).Error
		})
		c.JSON(http.StatusInternalServerError, gin.H{"error": cleanVideoGenerationErrorMessage(err)})
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
	var messages []models.VideoChatMessage
	h.db.Where("chat_id = ?", chat.ID).Find(&messages)
	for _, msg := range messages {
		deleteLocalAsset(msg.VideoURL, localVideoURLPrefix, videoAssetsDir())
	}

	if err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("chat_id = ?", chat.ID).Delete(&models.VideoChatMessage{}).Error; err != nil {
			return err
		}
		if err := tx.Where("chat_id = ?", chat.ID).Delete(&models.VideoGeneration{}).Error; err != nil {
			return err
		}
		return tx.Delete(&chat).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除视频会话失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功", "deleted_id": chat.ID})
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
	modelID := req.Model
	if modelID == "" {
		modelID = "doubao-seedance-2-0-fast-260128"
	}
	ratioInput := req.Ratio
	if ratioInput == "" {
		ratioInput = req.AspectRatio
	}
	_, duration, _, err := normalizeVideoGenerationParams(modelID, ratioInput, req.Resolution, req.Duration, len(req.ReferenceImages), len(req.ReferenceVideos))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	costFen := getModelCostFen(h.db, modelID)
	if duration > 0 {
		costFen *= int(duration)
	}
	if !ensureModelAccess(c, h.db, userID, modelID, costFen) {
		return
	}

	assistantMsg, err := h.createVideoChatMessagesAndTask(userID, chat.ID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": cleanVideoGenerationErrorMessage(err)})
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
	ratioInput := req.Ratio
	if ratioInput == "" {
		ratioInput = req.AspectRatio
	}
	ratio, duration, resolution, err := normalizeVideoGenerationParams(modelID, ratioInput, req.Resolution, req.Duration, len(req.ReferenceImages), len(req.ReferenceVideos))
	if err != nil {
		return nil, err
	}
	userMsg := models.VideoChatMessage{ChatID: chatID, Role: "user", Content: req.Prompt}
	if err := h.db.Create(&userMsg).Error; err != nil {
		return nil, err
	}

	assistantMsg := models.VideoChatMessage{
		ChatID:              chatID,
		Role:                "assistant",
		Content:             req.Prompt,
		Status:              "pending",
		Model:               modelID,
		Ratio:               ratio,
		Resolution:          resolution,
		Duration:            duration,
		GenerateAudio:       req.GenerateAudio,
		Watermark:           req.Watermark,
		ReferenceImageCount: len(req.ReferenceImages),
		ReferenceVideoCount: len(req.ReferenceVideos),
	}
	if err := h.db.Create(&assistantMsg).Error; err != nil {
		return nil, err
	}

	createReq := services.CreateVideoTaskRequest{
		Model:                  modelID,
		Prompt:                 req.Prompt,
		Ratio:                  ratio,
		Resolution:             resolution,
		Duration:               duration,
		GenerateAudio:          req.GenerateAudio,
		Watermark:              req.Watermark,
		ReferenceImageRoleMode: req.ReferenceImageRoleMode,
		ReturnLastFrame:        true,
	}
	createReq.ReferenceImages, err = resolveVideoReferenceURLs(h.db, h.cfg, userID, req.ReferenceImages, "image")
	if err != nil {
		errMsg := cleanVideoGenerationErrorMessage(err)
		h.db.Model(&assistantMsg).Updates(map[string]interface{}{"status": "failed", "error_message": errMsg})
		assistantMsg.Status = "failed"
		assistantMsg.ErrorMessage = errMsg
		return &assistantMsg, err
	}
	createReq.ReferenceImageRoles = normalizedReferenceImageRoles(req.ReferenceImageRoles, len(createReq.ReferenceImages))
	createReq.ReferenceVideos, err = resolveVideoReferenceURLs(h.db, h.cfg, userID, req.ReferenceVideos, "video")
	if err != nil {
		errMsg := cleanVideoGenerationErrorMessage(err)
		h.db.Model(&assistantMsg).Updates(map[string]interface{}{"status": "failed", "error_message": errMsg})
		assistantMsg.Status = "failed"
		assistantMsg.ErrorMessage = errMsg
		return &assistantMsg, err
	}

	// Launch async goroutine to create video task with Volcengine
	go h.submitVideoTaskAsync(userID, chatID, assistantMsg.ID, createReq)

	return &assistantMsg, nil
}

// submitVideoTaskAsync creates the video task in background.
// It updates the message with task_id when successful, or marks failed on error.
func (h *VideoChatHandler) submitVideoTaskAsync(userID uint, chatID uint, assistantMsgID uint, createReq services.CreateVideoTaskRequest) {
	log.Printf("[VideoChat] async create task refs images=%d videos=%d model=%s msg_id=%d", len(createReq.ReferenceImages), len(createReq.ReferenceVideos), createReq.Model, assistantMsgID)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	resp, err := h.videoService.CreateVideoTask(ctx, createReq)
	if err != nil {
		errMsg := cleanVideoTaskSubmissionErrorMessage(err)
		log.Printf("[VideoChat] async create task failed msg_id=%d err=%v", assistantMsgID, err)
		h.db.Model(&models.VideoChatMessage{}).Where("id = ?", assistantMsgID).Updates(map[string]interface{}{
			"status":        "failed",
			"error_message": errMsg,
			"updated_at":    time.Now(),
		})
		return
	}

	video := models.VideoGeneration{
		UserID:              userID,
		Prompt:              createReq.Prompt,
		Model:               createReq.Model,
		Ratio:               createReq.Ratio,
		Resolution:          createReq.Resolution,
		Duration:            createReq.Duration,
		GenerateAudio:       createReq.GenerateAudio,
		Watermark:           createReq.Watermark,
		ReferenceImageCount: len(createReq.ReferenceImages),
		ReferenceVideoCount: len(createReq.ReferenceVideos),
		TaskID:              resp.TaskID,
		ChatID:              chatID,
		MessageID:           assistantMsgID,
		Status:              resp.Status,
	}
	if err := h.db.Create(&video).Error; err != nil {
		log.Printf("[VideoChat] async save video generation failed msg_id=%d err=%v", assistantMsgID, err)
		return
	}

	h.db.Model(&models.VideoChatMessage{}).Where("id = ?", assistantMsgID).Updates(map[string]interface{}{
		"task_id":               resp.TaskID,
		"generation_id":         video.ID,
		"status":                resp.Status,
		"reference_image_count": len(createReq.ReferenceImages),
		"reference_video_count": len(createReq.ReferenceVideos),
		"updated_at":            time.Now(),
	})
	log.Printf("[VideoChat] async create task success msg_id=%d task=%s gen_id=%d", assistantMsgID, resp.TaskID, video.ID)
}

func (h *VideoChatHandler) refreshPendingVideoChatMessages(chatID uint) {
	// Mark stale async submissions (pending with no task_id for too long)
	staleCutoff := time.Now().Add(-10 * time.Minute)
	h.db.Model(&models.VideoChatMessage{}).
		Where("chat_id = ? AND role = ? AND status = ? AND task_id = '' AND generation_id = 0 AND updated_at < ?", chatID, "assistant", "pending", staleCutoff).
		Updates(map[string]interface{}{
			"status":        "failed",
			"error_message": "视频任务提交超时，请稍后重新提交。",
			"updated_at":    time.Now(),
		})

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
		if resp.LastFrameURL != "" {
			updates["last_frame_url"] = resp.LastFrameURL
			videoUpdates["last_frame_url"] = resp.LastFrameURL
		}
		if resp.Status == "succeeded" || resp.Status == "completed" {
			if msg.VideoURL == "" {
				localVideoURL, persistErr := persistRemoteVideoAsset(resp.VideoURL)
				if persistErr != nil {
					log.Printf("[VideoChat] persist video failed task=%s err=%v", msg.TaskID, persistErr)
					cleanMsg := videoAssetPersistenceErrorMessage(persistErr)
					updates["status"] = "failed"
					updates["error_message"] = cleanMsg
					videoUpdates["status"] = "failed"
					videoUpdates["error_message"] = cleanMsg
				} else {
					updates["video_url"] = localVideoURL
					videoUpdates["video_url"] = localVideoURL
				}
			}
		}
		if resp.Status == "failed" && resp.ErrorMessage != "" {
			log.Printf("[VideoChat] task failed task=%s raw_error=%s", msg.TaskID, resp.ErrorMessage)
			cleanMsg := cleanVideoGenerationErrorString(resp.ErrorMessage)
			updates["error_message"] = cleanMsg
			videoUpdates["error_message"] = cleanMsg
		}
		h.db.Model(&models.VideoChatMessage{}).Where("id = ?", msg.ID).Updates(updates)
		var video models.VideoGeneration
		if msg.GenerationID > 0 {
			h.db.Model(&models.VideoGeneration{}).Where("id = ?", msg.GenerationID).Updates(videoUpdates)
			h.db.Where("id = ?", msg.GenerationID).First(&video)
		} else {
			h.db.Model(&models.VideoGeneration{}).Where("task_id = ?", msg.TaskID).Updates(videoUpdates)
			h.db.Where("task_id = ?", msg.TaskID).First(&video)
		}
		if (video.Status == "succeeded" || video.Status == "completed") && video.ID > 0 {
			h.recordVideoUsageIfNeeded(&video, resp)
		}
	}
}

func (h *VideoChatHandler) recordVideoUsageIfNeeded(video *models.VideoGeneration, resp *services.VideoTaskResult) {
	if video == nil || resp == nil || video.UsageRecorded {
		return
	}
	if resp.CompletionTokens <= 0 {
		log.Printf("[VideoChat] skip usage log without completion tokens task=%s generation=%d", video.TaskID, video.ID)
		return
	}
	resolution := video.Resolution
	if resolution == "" {
		resolution = "720p"
	}
	usageSvc := services.NewUsageService(h.cfg)
	err := usageSvc.RecordVideoUsage(services.VideoUsageInput{
		UserID:              video.UserID,
		Model:               video.Model,
		ResourceID:          video.ID,
		ChatID:              video.ChatID,
		MessageID:           video.MessageID,
		TaskID:              video.TaskID,
		DurationSeconds:     int(video.Duration),
		Resolution:          resolution,
		ReferenceVideoCount: video.ReferenceVideoCount,
		CompletionTokens:    resp.CompletionTokens,
		Raw: map[string]any{
			"completion_tokens": resp.CompletionTokens,
			"task_id":           resp.TaskID,
			"source":            "volcengine_get_task",
		},
	})
	if err != nil {
		log.Printf("[VideoChat] record usage failed task=%s generation=%d err=%v", video.TaskID, video.ID, err)
		return
	}
	h.db.Model(video).Update("usage_recorded", true)
	video.UsageRecorded = true
}
