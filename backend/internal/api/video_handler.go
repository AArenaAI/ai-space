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
	c.JSON(http.StatusOK, gin.H{"videos": videos})
}

// CreateVideo creates a video generation task
func (h *VideoHandler) CreateVideo(c *gin.Context) {
	userID := getUserID(c)
	var req struct {
		Prompt          string   `json:"prompt" binding:"required"`
		Model           string   `json:"model"`
		Ratio           string   `json:"ratio"`
		Resolution      string   `json:"resolution"`
		Duration        int64    `json:"duration"`
		GenerateAudio   bool     `json:"generate_audio"`
		Watermark       bool     `json:"watermark"`
		ReferenceImages []string `json:"reference_image_urls"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	modelID := req.Model
	if modelID == "" {
		modelID = "doubao-seedance-2-0-fast-260128"
	}
	ratio, duration, resolution, err := normalizeVideoGenerationParams(modelID, req.Ratio, req.Resolution, req.Duration, len(req.ReferenceImages))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
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
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	resp, err := h.videoService.CreateVideoTask(ctx, createReq)
	if err != nil {
		log.Printf("[Video] create task failed model=%s ratio=%s resolution=%s duration=%d audio=%v err=%v", modelID, ratio, resolution, duration, req.GenerateAudio, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create task: " + err.Error()})
		return
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
		Status:        resp.Status,
	}
	if err := h.db.Create(&video).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save task"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":       video.ID,
		"task_id":  video.TaskID,
		"status":   video.Status,
		"prompt":   video.Prompt,
		"model":    video.Model,
		"ratio":    video.Ratio,
		"duration": video.Duration,
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

	if video.Status != "succeeded" && video.Status != "completed" && video.Status != "failed" {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		resp, err := h.videoService.GetVideoTask(ctx, video.TaskID)
		if err == nil && resp != nil {
			video.Status = resp.Status
			if resp.Status == "succeeded" || resp.Status == "completed" {
				video.VideoURL = resp.VideoURL
			}
			if resp.Status == "failed" && resp.ErrorMessage != "" {
				video.ErrorMessage = resp.ErrorMessage
			}
			h.db.Save(&video)
		}
	}

	c.JSON(http.StatusOK, video)
}

// DeleteVideo deletes a video task
func (h *VideoHandler) DeleteVideo(c *gin.Context) {
	userID := getUserID(c)
	id := c.Param("id")

	result := h.db.Where("id = ? AND user_id = ?", id, userID).Delete(&models.VideoGeneration{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Video task not found"})
		return
	}
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

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	resp, err := h.videoService.GetVideoTask(ctx, video.TaskID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query Volcengine: " + err.Error()})
		return
	}

	video.Status = resp.Status
	if resp.Status == "succeeded" || resp.Status == "completed" {
		video.VideoURL = resp.VideoURL
	}
	if resp.Status == "failed" && resp.ErrorMessage != "" {
		video.ErrorMessage = resp.ErrorMessage
	}
	video.UpdatedAt = time.Now()
	h.db.Save(&video)

	c.JSON(http.StatusOK, video)
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

var officialVideoDurations = map[int64]bool{
	4: true, 5: true, 6: true, 7: true, 9: true, 10: true, 11: true, 13: true, 14: true, 15: true,
}

var standardSeedanceResolutions = map[string]bool{
	"480p": true,
	"720p": true,
	"1080p": true,
}

var fastSeedanceResolutions = map[string]bool{
	"480p": true,
	"720p": true,
}

func normalizeVideoGenerationParams(modelID string, ratio string, resolution string, duration int64, referenceImageCount int) (string, int64, string, error) {
	if ratio == "" || ratio == "auto" {
		ratio = "adaptive"
	}
	if !officialVideoRatios[ratio] {
		return "", 0, "", fmt.Errorf("unsupported ratio: %s", ratio)
	}

	if duration == 0 {
		duration = 5
	}
	if !officialVideoDurations[duration] {
		return "", 0, "", fmt.Errorf("duration must be one of 4, 5, 6, 7, 9, 10, 11, 13, 14, 15 seconds")
	}

	if referenceImageCount > 9 {
		return "", 0, "", fmt.Errorf("reference images must not exceed 9")
	}

	if resolution == "" {
		resolution = "720p"
	}
	allowedResolutions := standardSeedanceResolutions
	if strings.Contains(modelID, "seedance-2-0-fast") {
		allowedResolutions = fastSeedanceResolutions
	}
	if !allowedResolutions[resolution] {
		if strings.Contains(modelID, "seedance-2-0-fast") {
			return "", 0, "", fmt.Errorf("Seedance 2.0 Fast resolution must be 480p or 720p")
		}
		return "", 0, "", fmt.Errorf("Seedance 2.0 resolution must be 480p, 720p, or 1080p")
	}
	return ratio, duration, resolution, nil
}

// GetVideoModelsHandler returns supported video generation models
func GetVideoModelsHandler(c *gin.Context) {
	models := modelmeta.VideoModels()
	c.JSON(http.StatusOK, models)
}
