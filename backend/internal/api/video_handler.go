package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"log"
	"net/http"
	"strconv"
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
		Duration        int64    `json:"duration"`
		GenerateAudio   bool     `json:"generate_audio"`
		Watermark       bool     `json:"watermark"`
		ReferenceImages []string `json:"reference_image_urls"`
		ReferenceVideos []string `json:"reference_video_urls"`
		ReferenceAudios []string `json:"reference_audio_urls"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	modelID := req.Model
	if modelID == "" {
		modelID = "doubao-seedance-2-0-fast-260128"
	}
	ratio := req.Ratio
	duration := req.Duration
	if duration <= 0 {
		duration = 5
	}

	resolution := ""
	if ratio != "" && ratio != "auto" {
		resolution = resolveVideoResolution(ratio)
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

	if video.Status != "succeeded" && video.Status != "failed" {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		resp, err := h.videoService.GetVideoTask(ctx, video.TaskID)
		if err == nil && resp != nil {
			video.Status = resp.Status
			if resp.Status == "succeeded" {
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
	if resp.Status == "succeeded" {
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

// resolveVideoResolution maps aspect ratio to resolution for Seedance models
func resolveVideoResolution(ratio string) string {
	// Seedance models use resolution instead of ratio
	// Supported resolutions: 480p, 540p, 720p, 1080p
	parts := strings.Split(ratio, ":")
	if len(parts) == 2 {
		w, wErr := strconv.Atoi(strings.TrimSpace(parts[0]))
		h, hErr := strconv.Atoi(strings.TrimSpace(parts[1]))
		if wErr == nil && hErr == nil {
			if h > w {
				// Portrait / square
				return "720p"
			}
		}
	}
	// Landscape or fallback
	return "1080p"
}

// GetVideoModelsHandler returns supported video generation models
func GetVideoModelsHandler(c *gin.Context) {
	models := []ModelInfo{
		{ID: "doubao-seedance-2-0-fast-260128", Name: "Seedance 2.0 Fast", Provider: "Volcengine", Description: "Fast video generation from Volcengine", Color: "#ff6a00", Capabilities: []string{"video"}},
		{ID: "doubao-seedance-2-0-260128", Name: "Seedance 2.0", Provider: "Volcengine", Description: "Standard video generation from Volcengine", Color: "#ff0050", Capabilities: []string{"video"}},
	}
	c.JSON(http.StatusOK, models)
}
