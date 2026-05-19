package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ImageChatHandler struct {
	db           *gorm.DB
	imageService *services.ImageService
	cfg          *config.Config
	usageService *services.UsageService
}

func NewImageChatHandler(db *gorm.DB, imageService *services.ImageService, cfg *config.Config, usageService *services.UsageService) *ImageChatHandler {
	return &ImageChatHandler{
		db:           db,
		imageService: imageService,
		cfg:          cfg,
		usageService: usageService,
	}
}

// ListImageChats 获取用户的 AI 画图会话列表
func (h *ImageChatHandler) ListImageChats(c *gin.Context) {
	userID := getUserID(c)
	var chats []models.ImageChat
	if err := h.db.Where("user_id = ?", userID).Order("updated_at DESC").Find(&chats).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取会话列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"chats": chats})
}

// CreateImageChat 创建新会话并可选发送第一条消息生成图片
func (h *ImageChatHandler) CreateImageChat(c *gin.Context) {
	userID := getUserID(c)
	var req struct {
		Prompt      string   `json:"prompt"`
		AspectRatio string   `json:"aspect_ratio"`
		Resolution  string   `json:"resolution"`
		Quality     string   `json:"quality"`
		RefImages   []string `json:"reference_image_urls"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 创建会话
	title := req.Prompt
	if title == "" {
		title = "新会话"
	}
	if len(title) > 30 {
		title = title[:30] + "..."
	}
	chat := models.ImageChat{
		UserID: userID,
		Title:  title,
	}
	if err := h.db.Create(&chat).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建会话失败"})
		return
	}

	// 如果有 prompt，创建用户消息并启动生成
	if req.Prompt != "" {
		userMsg := models.ImageChatMessage{
			ChatID:  chat.ID,
			Role:    "user",
			Content: req.Prompt,
		}
		h.db.Create(&userMsg)

		assistantMsg := models.ImageChatMessage{
			ChatID:  chat.ID,
			Role:    "assistant",
			Content: req.Prompt,
			Status:  "pending",
		}
		h.db.Create(&assistantMsg)

		size := resolveSizeFromReq(req.AspectRatio, req.Resolution)
		quality := req.Quality
		if quality == "" {
			quality = "medium"
		}

		// 解析参考图路径
		var refPaths []string
		for _, url := range req.RefImages {
			if p := resolveRefImagePath(h.db, url); p != "" {
				refPaths = append(refPaths, p)
			}
		}

		baseURL := resolveBaseURL(c, h.cfg)
		go h.processImageChatJob(assistantMsg.ID, req.Prompt, size, quality, refPaths, baseURL, chat.ID)
	}

	c.JSON(http.StatusOK, chat)
}

// GetImageChat 获取会话详情
func (h *ImageChatHandler) GetImageChat(c *gin.Context) {
	userID := getUserID(c)
	chatID := c.Param("id")

	var chat models.ImageChat
	if err := h.db.Where("id = ? AND user_id = ?", chatID, userID).First(&chat).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "会话不存在"})
		return
	}
	c.JSON(http.StatusOK, chat)
}

// UpdateImageChat 更新会话标题
func (h *ImageChatHandler) UpdateImageChat(c *gin.Context) {
	userID := getUserID(c)
	chatID := c.Param("id")

	var req struct {
		Title string `json:"title"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result := h.db.Model(&models.ImageChat{}).Where("id = ? AND user_id = ?", chatID, userID).Update("title", req.Title)
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "会话不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

// DeleteImageChat 删除会话及所有消息
func (h *ImageChatHandler) DeleteImageChat(c *gin.Context) {
	userID := getUserID(c)
	chatID := c.Param("id")

	var chat models.ImageChat
	if err := h.db.Where("id = ? AND user_id = ?", chatID, userID).First(&chat).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "会话不存在"})
		return
	}

	// 删除消息
	h.db.Where("chat_id = ?", chat.ID).Delete(&models.ImageChatMessage{})
	// 删除会话
	h.db.Delete(&chat)

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// ListImageChatMessages 获取会话消息列表
func (h *ImageChatHandler) ListImageChatMessages(c *gin.Context) {
	userID := getUserID(c)
	chatID := c.Param("id")

	var chat models.ImageChat
	if err := h.db.Where("id = ? AND user_id = ?", chatID, userID).First(&chat).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "会话不存在"})
		return
	}

	var messages []models.ImageChatMessage
	if err := h.db.Where("chat_id = ?", chat.ID).Order("created_at ASC").Find(&messages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取消息失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"messages": messages})
}

// SendImageChatMessage 在现有会话中发送新消息并生成图片
func (h *ImageChatHandler) SendImageChatMessage(c *gin.Context) {
	userID := getUserID(c)
	chatID := c.Param("id")

	var chat models.ImageChat
	if err := h.db.Where("id = ? AND user_id = ?", chatID, userID).First(&chat).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "会话不存在"})
		return
	}

	var req struct {
		Prompt      string   `json:"prompt" binding:"required"`
		AspectRatio string   `json:"aspect_ratio"`
		Resolution  string   `json:"resolution"`
		Quality     string   `json:"quality"`
		RefImages   []string `json:"reference_image_urls"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 保存用户消息
	userMsg := models.ImageChatMessage{
		ChatID:  chat.ID,
		Role:    "user",
		Content: req.Prompt,
	}
	h.db.Create(&userMsg)

	// 保存 AI pending 消息
	assistantMsg := models.ImageChatMessage{
		ChatID:  chat.ID,
		Role:    "assistant",
		Content: req.Prompt,
		Status:  "pending",
	}
	h.db.Create(&assistantMsg)

	// 更新会话时间
	h.db.Model(&chat).Update("updated_at", time.Now())

	size := resolveSizeFromReq(req.AspectRatio, req.Resolution)
	quality := req.Quality
	if quality == "" {
		quality = "medium"
	}

	var refPaths []string
	for _, url := range req.RefImages {
		if p := resolveRefImagePath(h.db, url); p != "" {
			refPaths = append(refPaths, p)
		}
	}

	baseURL := resolveBaseURL(c, h.cfg)
	go h.processImageChatJob(assistantMsg.ID, req.Prompt, size, quality, refPaths, baseURL, chat.ID)

	c.JSON(http.StatusOK, gin.H{
		"message_id": assistantMsg.ID,
		"chat_id":    chat.ID,
		"status":     "pending",
	})
}

// processImageChatJob 后台生成图片
func (h *ImageChatHandler) processImageChatJob(msgID uint, prompt, size, quality string, refPaths []string, baseURL string, chatID uint) {
	ctx := context.Background()

	var imageURL, b64Data string
	var err error

	if len(refPaths) > 0 {
		imageURL, b64Data, err = h.imageService.EditImage(ctx, prompt, size, refPaths)
	} else {
		imageURL, b64Data, err = h.imageService.GenerateImage(ctx, prompt, size, quality)
	}

	if err != nil {
		errMsg := err.Error()
		h.db.Model(&models.ImageChatMessage{}).Where("id = ?", msgID).Updates(map[string]interface{}{
			"status":        "failed",
			"error_message": errMsg,
		})
		if h.usageService != nil {
			_ = h.usageService.RecordImageUsage(0, h.cfg.ImageGenModel, 0, nil)
		}
		return
	}

	// 保存 base64 图片
	if b64Data != "" {
		filename, saveErr := saveBase64Image(b64Data)
		if saveErr != nil {
			h.db.Model(&models.ImageChatMessage{}).Where("id = ?", msgID).Update("status", "failed")
			return
		}
		imageURL = buildImageURL(baseURL, filename)
	}

	if imageURL == "" {
		h.db.Model(&models.ImageChatMessage{}).Where("id = ?", msgID).Update("status", "failed")
		return
	}

	// 更新消息状态
	h.db.Model(&models.ImageChatMessage{}).Where("id = ?", msgID).Updates(map[string]interface{}{
		"image_url": imageURL,
		"status":    "completed",
	})

	// 更新会话时间
	h.db.Model(&models.ImageChat{}).Where("id = ?", chatID).Update("updated_at", time.Now())

	// 记录用量
	if h.usageService != nil {
		_ = h.usageService.RecordImageUsage(0, h.cfg.ImageGenModel, 1, nil)
	}
}

// resolveSizeFromReq 将 aspect_ratio + resolution 映射为像素尺寸
func resolveSizeFromReq(aspectRatio, resolution string) string {
	if aspectRatio == "" && resolution == "" {
		return "1024x1024"
	}
	if aspectRatio == "auto" {
		return "auto"
	}
	switch resolution {
	case "2K":
		switch aspectRatio {
		case "1:1":
			return "2048x2048"
		case "2:3":
			return "1360x2048"
		case "3:2":
			return "2048x1360"
		case "3:4":
			return "1536x2048"
		case "4:3":
			return "2048x1536"
		case "4:5":
			return "1632x2048"
		case "5:4":
			return "2048x1632"
		case "9:16":
			return "1152x2048"
		case "16:9":
			return "2048x1152"
		case "21:9":
			return "2048x880"
		default:
			return "2048x2048"
		}
	case "4K":
		switch aspectRatio {
		case "1:1":
			return "3840x3840"
		case "2:3":
			return "2560x3840"
		case "3:2":
			return "3840x2560"
		case "3:4":
			return "2880x3840"
		case "4:3":
			return "3840x2880"
		case "4:5":
			return "3072x3840"
		case "5:4":
			return "3840x3072"
		case "9:16":
			return "2160x3840"
		case "16:9":
			return "3840x2160"
		case "21:9":
			return "3840x1648"
		default:
			return "3840x3840"
		}
	default:
		switch aspectRatio {
		case "1:1":
			return "1024x1024"
		case "2:3":
			return "688x1024"
		case "3:2":
			return "1024x688"
		case "3:4":
			return "768x1024"
		case "4:3":
			return "1024x768"
		case "4:5":
			return "816x1024"
		case "5:4":
			return "1024x816"
		case "9:16":
			return "576x1024"
		case "16:9":
			return "1024x576"
		case "21:9":
			return "1024x432"
		default:
			return "1024x1024"
		}
	}
}

// resolveRefImagePath 解析参考图 URL 为本地路径
func resolveRefImagePath(db *gorm.DB, url string) string {
	if url == "" {
		return ""
	}
	if strings.HasPrefix(url, "file_") {
		var file models.File
		if err := db.Where("public_id = ?", url).First(&file).Error; err == nil {
			return file.StoragePath
		}
		return ""
	}
	parts := strings.Split(url, "/")
	if len(parts) > 0 {
		filename := parts[len(parts)-1]
		if !strings.Contains(filename, "..") && !strings.Contains(filename, "/") {
			refPath := "./data/images/" + filename
			if _, statErr := os.Stat(refPath); statErr == nil {
				return refPath
			}
		}
	}
	return ""
}
