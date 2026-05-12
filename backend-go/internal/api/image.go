package api

import (
	"aipool-backend/internal/services"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ImageHandler struct {
	db           *gorm.DB
	imageService *services.ImageService
}

func NewImageHandler(db *gorm.DB, imageService *services.ImageService) *ImageHandler {
	return &ImageHandler{
		db:           db,
		imageService: imageService,
	}
}

// 图片生成请求
type GenerateImageRequest struct {
	Prompt string `json:"prompt" binding:"required"`
	Size   string `json:"size"` // 1024x1024, 1024x1792, 1792x1024
}

// GenerateImage 生成图片
func (h *ImageHandler) GenerateImage(c *gin.Context) {
	userID := getUserID(c)

	var req GenerateImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 创建记录
	gen := &services.ImageGeneration{
		UserID: userID,
		Prompt: req.Prompt,
		Size:   req.Size,
		Status: "pending",
	}
	h.db.Create(gen)

	// 调用服务生成图片
	imageURL, err := h.imageService.GenerateImage(c, req.Prompt, req.Size)
	if err != nil {
		gen.Status = "failed"
		h.db.Save(gen)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	gen.ImageURL = imageURL
	gen.Status = "completed"
	h.db.Save(gen)

	c.JSON(http.StatusOK, gin.H{
		"id":         gen.ID,
		"prompt":     gen.Prompt,
		"image_url":  gen.ImageURL,
		"status":     gen.Status,
		"created_at": gen.CreatedAt,
	})
}

// ListImages 获取图片列表
func (h *ImageHandler) ListImages(c *gin.Context) {
	userID := getUserID(c)

	var images []services.ImageGeneration
	h.db.Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&images)

	c.JSON(http.StatusOK, gin.H{"images": images})
}

// DeleteImage 删除图片
func (h *ImageHandler) DeleteImage(c *gin.Context) {
	userID := getUserID(c)
	imageID := c.Param("id")

	result := h.db.Where("id = ? AND user_id = ?", imageID, userID).Delete(&services.ImageGeneration{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "图片不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// GetImage 获取单个图片
func (h *ImageHandler) GetImage(c *gin.Context) {
	userID := getUserID(c)
	imageID := c.Param("id")

	var image services.ImageGeneration
	if err := h.db.Where("id = ? AND user_id = ?", imageID, userID).First(&image).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "图片不存在"})
		return
	}

	c.JSON(http.StatusOK, image)
}

// AutoMigrate 自动迁移数据库表
func (h *ImageHandler) AutoMigrate() error {
	return h.db.AutoMigrate(&services.ImageGeneration{})
}
