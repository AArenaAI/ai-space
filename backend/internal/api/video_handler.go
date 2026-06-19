package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type VideoHandler struct {
	db           *gorm.DB
	videoService *services.VideoService
	cfg          *config.Config
}

func NewVideoHandler(db *gorm.DB, cfg *config.Config) *VideoHandler {
	videoService := services.NewVideoService(cfg.VolcengineAPIKey, cfg.VolcengineBaseURL)
	return &VideoHandler{
		db:           db,
		videoService: videoService,
		cfg:          cfg,
	}
}

func ensureVideoFailureMessage(video *models.VideoGeneration) {
	if video == nil || video.Status != "failed" || strings.TrimSpace(video.ErrorMessage) != "" {
		return
	}
	if strings.TrimSpace(video.TaskID) == "" {
		video.ErrorMessage = "视频任务提交失败，但后端未返回具体原因。请检查任务提交日志或重新提交。"
		return
	}
	video.ErrorMessage = fmt.Sprintf("视频任务 %s 生成失败，但生成服务未返回具体原因。请检查视频任务日志或更换提示词/素材后重试。", video.TaskID)
}

func (h *VideoHandler) AutoMigrate() {
	h.db.AutoMigrate(&models.VideoGeneration{})
}

// ListVideos returns the user's video generation list
func (h *VideoHandler) ListVideos(c *gin.Context) {
	userID := getUserID(c)
	var videos []models.VideoGeneration
	if err := h.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&videos).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get video list"})
		return
	}
	for i := range videos {
		ensureVideoFailureMessage(&videos[i])
	}
	c.JSON(http.StatusOK, gin.H{"videos": videos})
}

// CreateVideo creates a video generation task
func (h *VideoHandler) CreateVideo(c *gin.Context) {
	userID := getUserID(c)
	var req struct {
		Prompt                 string   `json:"prompt" binding:"required"`
		Model                  string   `json:"model"`
		Ratio                  string   `json:"ratio"`
		Resolution             string   `json:"resolution"`
		Duration               int64    `json:"duration"`
		GenerateAudio          bool     `json:"generate_audio"`
		Watermark              bool     `json:"watermark"`
		ReferenceImages        []string `json:"reference_image_urls"`
		ReferenceImageRoles    []string `json:"reference_image_roles"`
		ReferenceVideos        []string `json:"reference_video_urls"`
		ReferenceImageRoleMode string   `json:"reference_image_role_mode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	modelID := req.Model
	if modelID == "" {
		modelID = "doubao-seedance-2-0-fast-260128"
	}
	ratio, duration, resolution, err := normalizeVideoGenerationParams(modelID, req.Ratio, req.Resolution, req.Duration, len(req.ReferenceImages), len(req.ReferenceVideos))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
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
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	createReq.ReferenceImageRoles = normalizedReferenceImageRoles(req.ReferenceImageRoles, len(createReq.ReferenceImages))
	createReq.ReferenceVideos, err = resolveVideoReferenceURLs(h.db, h.cfg, userID, req.ReferenceVideos, "video")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	log.Printf("[Video] create task refs images=%d videos=%d model=%s", len(createReq.ReferenceImages), len(createReq.ReferenceVideos), modelID)

	// Create DB record first, then submit async
	video := models.VideoGeneration{
		UserID:              userID,
		Prompt:              req.Prompt,
		Model:               modelID,
		Ratio:               ratio,
		Resolution:          resolution,
		Duration:            duration,
		GenerateAudio:       req.GenerateAudio,
		Watermark:           req.Watermark,
		ReferenceImageCount: len(createReq.ReferenceImages),
		ReferenceVideoCount: len(createReq.ReferenceVideos),
		Status:              "pending",
	}
	if err := h.db.Create(&video).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save task"})
		return
	}

	// Launch async goroutine to create video task with Volcengine
	go h.submitVideoTaskAsync(userID, video.ID, createReq)

	c.JSON(http.StatusOK, gin.H{
		"id":         video.ID,
		"task_id":    "",
		"status":     "pending",
		"prompt":     video.Prompt,
		"model":      video.Model,
		"ratio":      video.Ratio,
		"resolution": video.Resolution,
		"duration":   video.Duration,
	})
}

// GetVideo queries video generation details (sync latest status from Volcengine)
func (h *VideoHandler) GetVideo(c *gin.Context) {
	userID := getUserID(c)
	id := c.Param("id")

	var video models.VideoGeneration
	if err := h.db.Where("id = ? AND user_id = ?", id, userID).First(&video).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Video task not found"})
		return
	}

	if video.Status != "succeeded" && video.Status != "completed" && video.Status != "failed" && strings.TrimSpace(video.TaskID) != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		resp, err := h.videoService.GetVideoTask(ctx, video.TaskID)
		if err == nil && resp != nil {
			video.Status = resp.Status
			if resp.Status == "succeeded" || resp.Status == "completed" {
				if resp.LastFrameURL != "" {
					video.LastFrameURL = resp.LastFrameURL
				}
				if video.VideoURL == "" {
					localVideoURL, persistErr := persistRemoteVideoAsset(resp.VideoURL)
					if persistErr != nil {
						log.Printf("[Video] persist video failed task=%s err=%v", video.TaskID, persistErr)
						video.Status = "failed"
						video.ErrorMessage = videoAssetPersistenceErrorMessage(persistErr)
					} else {
						video.VideoURL = localVideoURL
					}
				}
			}
			if resp.Status == "failed" {
				if resp.ErrorMessage != "" {
					video.ErrorMessage = cleanVideoGenerationErrorString(resp.ErrorMessage)
				} else if resp.ErrorCode != "" {
					video.ErrorMessage = cleanVideoGenerationErrorString(resp.ErrorCode)
				}
				ensureVideoFailureMessage(&video)
			}
			h.db.Save(&video)
			if video.Status == "succeeded" || video.Status == "completed" {
				h.recordVideoUsageIfNeeded(&video, resp)
			}
		}
	}

	ensureVideoFailureMessage(&video)
	c.JSON(http.StatusOK, video)
}

// DeleteVideo deletes a video task
func (h *VideoHandler) DeleteVideo(c *gin.Context) {
	userID := getUserID(c)
	id := c.Param("id")

	var video models.VideoGeneration
	if err := h.db.Where("id = ? AND user_id = ?", id, userID).First(&video).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Video task not found"})
		return
	}
	deleteLocalAsset(video.VideoURL, localVideoURLPrefix, videoAssetsDir())
	h.db.Delete(&video)
	c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully"})
}

// RefreshVideoStatus manually refreshes task status (for frontend polling)
func (h *VideoHandler) RefreshVideoStatus(c *gin.Context) {
	userID := getUserID(c)
	id := c.Param("id")

	var video models.VideoGeneration
	if err := h.db.Where("id = ? AND user_id = ?", id, userID).First(&video).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Video task not found"})
		return
	}

	if video.Status == "failed" || video.Status == "succeeded" || video.Status == "completed" || strings.TrimSpace(video.TaskID) == "" {
		ensureVideoFailureMessage(&video)
		if video.Status == "failed" && strings.TrimSpace(video.ErrorMessage) != "" {
			h.db.Model(&models.VideoGeneration{}).Where("id = ?", video.ID).Update("error_message", video.ErrorMessage)
		}
		c.JSON(http.StatusOK, video)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	resp, err := h.videoService.GetVideoTask(ctx, video.TaskID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": cleanVideoGenerationErrorMessage(err)})
		return
	}

	video.Status = resp.Status
	if resp.Status == "succeeded" || resp.Status == "completed" {
		if resp.LastFrameURL != "" {
			video.LastFrameURL = resp.LastFrameURL
		}
		if video.VideoURL == "" {
			localVideoURL, persistErr := persistRemoteVideoAsset(resp.VideoURL)
			if persistErr != nil {
				log.Printf("[Video] persist video failed task=%s err=%v", video.TaskID, persistErr)
				video.Status = "failed"
				video.ErrorMessage = videoAssetPersistenceErrorMessage(persistErr)
			} else {
				video.VideoURL = localVideoURL
			}
		}
	}
	if resp.Status == "failed" {
		if resp.ErrorMessage != "" {
			video.ErrorMessage = cleanVideoGenerationErrorString(resp.ErrorMessage)
		} else if resp.ErrorCode != "" {
			video.ErrorMessage = cleanVideoGenerationErrorString(resp.ErrorCode)
		}
		ensureVideoFailureMessage(&video)
	}
	video.UpdatedAt = time.Now()
	h.db.Save(&video)
	if video.Status == "succeeded" || video.Status == "completed" {
		h.recordVideoUsageIfNeeded(&video, resp)
	}

	c.JSON(http.StatusOK, video)
}

func (h *VideoHandler) recordVideoUsageIfNeeded(video *models.VideoGeneration, resp *services.VideoTaskResult) {
	if video == nil || resp == nil || video.UsageRecorded {
		return
	}
	if resp.CompletionTokens <= 0 {
		log.Printf("[Video] skip usage log without completion tokens task=%s generation=%d", video.TaskID, video.ID)
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
		log.Printf("[Video] record usage failed task=%s generation=%d err=%v", video.TaskID, video.ID, err)
		return
	}
	h.db.Model(video).Update("usage_recorded", true)
	video.UsageRecorded = true
}

// submitVideoTaskAsync creates the video task in background for standalone video generation.
func (h *VideoHandler) submitVideoTaskAsync(userID uint, videoID uint, createReq services.CreateVideoTaskRequest) {
	log.Printf("[Video] async create task refs images=%d videos=%d model=%s video_id=%d", len(createReq.ReferenceImages), len(createReq.ReferenceVideos), createReq.Model, videoID)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	resp, err := h.videoService.CreateVideoTask(ctx, createReq)
	if err != nil {
		errMsg := cleanVideoTaskSubmissionErrorMessage(err)
		if !strings.Contains(errMsg, "model=") {
			errMsg = fmt.Sprintf("%s（model=%s, ratio=%s, resolution=%s, duration=%d, refs=image:%d/video:%d）", errMsg, createReq.Model, createReq.Ratio, createReq.Resolution, createReq.Duration, len(createReq.ReferenceImages), len(createReq.ReferenceVideos))
		}
		log.Printf("[Video] async create task failed video_id=%d model=%s ratio=%s resolution=%s duration=%d refs=image:%d/video:%d err=%v", videoID, createReq.Model, createReq.Ratio, createReq.Resolution, createReq.Duration, len(createReq.ReferenceImages), len(createReq.ReferenceVideos), err)
		h.db.Model(&models.VideoGeneration{}).Where("id = ?", videoID).Updates(map[string]interface{}{
			"status":        "failed",
			"error_message": errMsg,
			"updated_at":    time.Now(),
		})
		return
	}

	h.db.Model(&models.VideoGeneration{}).Where("id = ?", videoID).Updates(map[string]interface{}{
		"task_id":    resp.TaskID,
		"status":     resp.Status,
		"updated_at": time.Now(),
	})
	log.Printf("[Video] async create task success video_id=%d task=%s", videoID, resp.TaskID)
}

// filterAndResolveURLs filters empty URLs and resolves local references
func filterAndResolveURLs(urls []string) []string {
	var result []string
	for _, url := range urls {
		if url == "" {
			continue
		}
		if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") {
			result = append(result, url)
		} else {
			result = append(result, url)
		}
	}
	return result
}

var officialVideoRatios = map[string]bool{
	"16:9":     true,
	"4:3":      true,
	"1:1":      true,
	"3:4":      true,
	"9:16":     true,
	"21:9":     true,
	"adaptive": true,
}

func normalizeSeedanceModelKey(modelID string) string {
	model := strings.ToLower(strings.TrimSpace(modelID))
	model = strings.NewReplacer(".", "-", "_", "-").Replace(model)
	if model == "doubao-seedance-2-0-pro-260128" {
		return "doubao-seedance-2-0-260128"
	}
	return model
}

func isSeedance1Model(modelID string) bool {
	return strings.Contains(normalizeSeedanceModelKey(modelID), "seedance-1-0")
}

func isSeedance15Model(modelID string) bool {
	return strings.Contains(normalizeSeedanceModelKey(modelID), "seedance-1-5")
}

func isFastLikeSeedanceModel(modelID string) bool {
	model := normalizeSeedanceModelKey(modelID)
	return strings.Contains(model, "seedance-2-0-fast") || strings.Contains(model, "seedance-2-0-mini") || strings.Contains(model, "seedance-1-0-pro-fast")
}

func validateSeedanceDuration(modelID string, duration int64) error {
	if isSeedance1Model(modelID) {
		if duration >= 2 && duration <= 12 {
			return nil
		}
		return fmt.Errorf("Seedance 1.0 duration must be an integer from 2 to 12 seconds")
	}
	if isSeedance15Model(modelID) {
		if duration == -1 || (duration >= 4 && duration <= 12) {
			return nil
		}
		return fmt.Errorf("Seedance 1.5 Pro duration must be -1 or an integer from 4 to 12 seconds")
	}
	if duration == -1 || (duration >= 4 && duration <= 15) {
		return nil
	}
	return fmt.Errorf("Seedance 2.0 duration must be -1 or an integer from 4 to 15 seconds")
}

var standardSeedanceResolutions = map[string]bool{
	"480p":  true,
	"720p":  true,
	"1080p": true,
}

var fastSeedanceResolutions = map[string]bool{
	"480p": true,
	"720p": true,
}

func normalizeVideoGenerationParams(modelID string, ratio string, resolution string, duration int64, referenceImageCount int, referenceVideoCount int) (string, int64, string, error) {
	if ratio == "" || ratio == "auto" {
		ratio = "adaptive"
	}
	if !officialVideoRatios[ratio] {
		return "", 0, "", fmt.Errorf("unsupported ratio: %s", ratio)
	}

	if duration == 0 {
		duration = 5
	}
	if err := validateSeedanceDuration(modelID, duration); err != nil {
		return "", 0, "", err
	}

	if referenceImageCount > 9 {
		return "", 0, "", fmt.Errorf("reference images must not exceed 9")
	}
	if referenceVideoCount > 3 {
		return "", 0, "", fmt.Errorf("reference videos must not exceed 3")
	}

	if resolution == "" {
		resolution = "720p"
	}
	allowedResolutions := standardSeedanceResolutions
	if isFastLikeSeedanceModel(modelID) {
		allowedResolutions = fastSeedanceResolutions
	}
	if !allowedResolutions[resolution] {
		if isFastLikeSeedanceModel(modelID) {
			return "", 0, "", fmt.Errorf("Seedance fast/mini models support 480p or 720p resolution")
		}
		return "", 0, "", fmt.Errorf("Seedance resolution must be 480p, 720p, or 1080p")
	}
	return ratio, duration, resolution, nil
}

// GetVideoModelsHandler returns supported video generation models
func GetVideoModelsHandler(c *gin.Context) {
	models := mergeModelConfigs(modelmeta.VideoModels())
	c.JSON(http.StatusOK, models)
}
