package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 图片存储目录（相对于工作目录）
const imagesDir = "./data/images"

type ImageHandler struct {
	db           *gorm.DB
	imageService *services.ImageService
	cfg          *config.Config
}

func NewImageHandler(db *gorm.DB, imageService *services.ImageService, cfg *config.Config) *ImageHandler {
	return &ImageHandler{
		db:           db,
		imageService: imageService,
		cfg:          cfg,
	}
}

// 图片生成请求
type GenerateImageRequest struct {
	Prompt            string `json:"prompt" binding:"required"`
	Size              string `json:"size"`         // 兼容旧前端：直接传像素尺寸
	AspectRatio       string `json:"aspect_ratio"` // 纵横比：auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
	Resolution        string `json:"resolution"`   // 分辨率：1K, 2K
	Quality           string `json:"quality"`      // 质量：low, medium, high, auto（默认 medium）
	ReferenceImageURL string `json:"reference_image_url"` // 参考图 URL（用于 image-to-image）
}

// roundTo16 将整数四舍五入到最接近的 16 的倍数（gpt-image-2 要求每边像素必须是 16 的倍数）
func roundTo16(v int) int {
	return ((v + 8) / 16) * 16
}

// resolveSize 将 aspect_ratio + resolution 映射为像素尺寸字符串
// 各分辨率 1:1 基准：1K=1024, 2K=2048, 4K=3840
// gpt-image-2 支持 auto 尺寸，auto 直接传 "auto"
func resolveSize(req GenerateImageRequest) string {
	// 如果直接传了 size，优先使用
	if req.Size != "" {
		return req.Size
	}

	// Auto 模式直接传 auto 让模型自动决定
	if req.AspectRatio == "auto" {
		return "auto"
	}

	switch req.Resolution {
	case "2K":
		switch req.AspectRatio {
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
		switch req.AspectRatio {
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
	default: // 1K
		switch req.AspectRatio {
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

// generateFileName 生成随机文件名
func generateFileName() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b) + ".png"
}

// resolveBaseURL 从请求中推断 base URL（用于 goroutine 中构建图片访问链接）
func resolveBaseURL(c *gin.Context, cfg *config.Config) string {
	if cfg.BaseURL != "" {
		return strings.TrimSuffix(cfg.BaseURL, "/")
	}
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	if proto := c.GetHeader("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	}
	host := c.GetHeader("X-Forwarded-Host")
	if host == "" {
		host = c.Request.Host
	}
	return scheme + "://" + host
}

// buildImageURL 构造图片访问 URL
func buildImageURL(baseURL, filename string) string {
	return baseURL + "/api/images/file/" + filename
}

// saveBase64Image 将 base64 数据保存为本地图片文件，返回文件名
func saveBase64Image(b64Data string) (string, error) {
	if err := os.MkdirAll(imagesDir, 0755); err != nil {
		return "", fmt.Errorf("创建图片目录失败: %w", err)
	}
	filename := generateFileName()
	path := filepath.Join(imagesDir, filename)
	data, err := base64.StdEncoding.DecodeString(b64Data)
	if err != nil {
		return "", fmt.Errorf("base64 解码失败: %w", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		return "", fmt.Errorf("写入图片文件失败: %w", err)
	}
	return filename, nil
}

// EditImageRequest 图片编辑请求
type EditImageRequest struct {
	Prompt    string `json:"prompt"`                    // 编辑 prompt（替换背景时需要）
	Size      string `json:"size"`                      // 尺寸（可选）
	ImageURL  string `json:"image_url"`                 // 源图 URL（可选，和 image_data 二选一）
	ImageData string `json:"image_data"`                // 源图 base64 数据（可选，和 image_url 二选一）
	EditMode  string `json:"edit_mode" binding:"required"` // remove-bg 或 replace-bg
}

// EditImage 编辑图片（背景移除 / 背景替换）
// 支持两种传图方式：
// 1. image_url — 已保存在 data/images/ 目录下的图片文件名（完整 URL）
// 2. image_data — base64 编码的图片数据
func (h *ImageHandler) EditImage(c *gin.Context) {
	userID := getUserID(c)

	var req EditImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 验证编辑模式
	if req.EditMode != "remove-bg" && req.EditMode != "replace-bg" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "edit_mode 必须是 remove-bg 或 replace-bg"})
		return
	}

	// 替换背景时必须提供 prompt
	if req.EditMode == "replace-bg" && req.Prompt == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "替换背景时必须提供 prompt 描述新背景"})
		return
	}

	// 至少需要提供 image_url 或 image_data
	if req.ImageURL == "" && req.ImageData == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "必须提供 image_url 或 image_data"})
		return
	}

	baseURL := resolveBaseURL(c, h.cfg)
	ctx := context.Background()
	size := req.Size
	if size == "" {
		size = "1024x1024"
	}

	var imageFilePath string

	if req.ImageData != "" {
		// 方案 A: 从前端传来的 base64 数据直接保存为本地文件
		cleanData := req.ImageData
		// 处理可能包含的 data:image/xxx;base64, 前缀
		if idx := strings.Index(cleanData, "base64,"); idx != -1 {
			cleanData = cleanData[idx+7:]
		}
		// 去 whitespace
		cleanData = strings.TrimSpace(cleanData)

		var saveErr error
		imageFilePath, saveErr = saveBase64ToImages(cleanData)
		if saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存源图失败: " + saveErr.Error()})
			return
		}
	} else {
		// 方案 B: 支持两种方式：
		//   - public_id (以 file_ 开头)：从上传文件库查路径
		//   - URL/文件名：从 data/images/ 目录读取
		var filename string
		if strings.HasPrefix(req.ImageURL, "file_") {
			var file models.File
			if err := h.db.Where("public_id = ?", req.ImageURL).First(&file).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "图片不存在"})
				return
			}
			filename = filepath.Base(file.StoragePath)
		} else {
			parts := strings.Split(req.ImageURL, "/")
			if len(parts) == 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "无效的图片 URL"})
				return
			}
			filename = parts[len(parts)-1]
		}
		if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "非法文件名"})
			return
		}

		imageFilePath = filepath.Join(imagesDir, filename)
		if _, statErr := os.Stat(imageFilePath); statErr != nil {
			// 如果 data/images/ 没有，去 uploads 目录找
			uploadDir := "./uploads"
			imageFilePath = filepath.Join(uploadDir, filename)
			if _, statErr2 := os.Stat(imageFilePath); statErr2 != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "图片文件不存在"})
				return
			}
		}
	}

	var imageURL, b64Data string
	var err error

	if req.EditMode == "remove-bg" {
		imageURL, b64Data, err = h.imageService.RemoveBackground(ctx, size, imageFilePath)
	} else {
		editPrompt := req.Prompt + ". Keep the subject the same, only change the background."
		imageURL, b64Data, err = h.imageService.GenerateEditImage(ctx, editPrompt, size, imageFilePath)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "背景编辑失败: " + err.Error()})
		return
	}

	// 保存结果到本地
	var savedImageURL string
	if b64Data != "" {
		savedFilename, saveErr := saveBase64Image(b64Data)
		if saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存编辑结果失败: " + saveErr.Error()})
			return
		}
		savedImageURL = buildImageURL(baseURL, savedFilename)
	} else {
		savedImageURL = imageURL
	}

	// 可选：把编辑结果也记录到 DB（复用 ImageGeneration 表）
	gen := &services.ImageGeneration{
		UserID:            userID,
		Prompt:            req.Prompt,
		Size:              size,
		ImageURL:          savedImageURL,
		ReferenceImageURL: req.ImageURL,
		Status:            "completed",
	}
	if req.EditMode == "remove-bg" {
		gen.Prompt = "[背景移除] " + req.ImageURL
	}
	h.db.Create(gen)

	c.JSON(http.StatusOK, gin.H{
		"image_url": savedImageURL,
		"id":        gen.ID,
		"status":    "completed",
	})
}

// saveBase64ToImages 将 base64 数据保存到 data/images/ 目录，返回完整文件路径
func saveBase64ToImages(b64Data string) (string, error) {
	if err := os.MkdirAll(imagesDir, 0755); err != nil {
		return "", fmt.Errorf("创建图片目录失败: %w", err)
	}
	filename := generateFileName()
	path := filepath.Join(imagesDir, filename)
	data, err := base64.StdEncoding.DecodeString(b64Data)
	if err != nil {
		return "", fmt.Errorf("base64 解码失败: %w", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		return "", fmt.Errorf("写入图片文件失败: %w", err)
	}
	return path, nil
}

// GenerateImage 异步生成图片
// 前端提交后立即返回 pending 状态，后端在 goroutine 中完成实际生成
func (h *ImageHandler) GenerateImage(c *gin.Context) {
	userID := getUserID(c)

	var req GenerateImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	size := resolveSize(req)

	// 质量默认 medium
	quality := req.Quality
	if quality == "" {
		quality = "medium"
	}

	// 处理参考图：从 URL 提取本地文件名
	var referenceImagePath string
	if req.ReferenceImageURL != "" {
		// URL 格式: https://host/api/images/file/<filename>
		parts := strings.Split(req.ReferenceImageURL, "/")
		if len(parts) > 0 {
			filename := parts[len(parts)-1]
			// 安全校验
			if !strings.Contains(filename, "..") && !strings.Contains(filename, "/") {
				refPath := filepath.Join(imagesDir, filename)
				if _, statErr := os.Stat(refPath); statErr == nil {
					referenceImagePath = refPath
				}
			}
		}
	}

	// 创建记录
	gen := &services.ImageGeneration{
		UserID:            userID,
		Prompt:            req.Prompt,
		Size:              size,
		Quality:           quality,
		ReferenceImageURL: req.ReferenceImageURL,
		Status:            "pending",
	}
	if err := h.db.Create(gen).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建记录失败: " + err.Error()})
		return
	}

	// 提前解析 baseURL，因为 goroutine 里 gin.Context 可能已经失效
	baseURL := resolveBaseURL(c, h.cfg)

	// 启动后台 goroutine 异步生成图片
	go h.processImageJob(gen.ID, req.Prompt, size, quality, referenceImagePath, baseURL)

	// 立即返回，不等待实际生成
	c.JSON(http.StatusOK, gin.H{
		"id":         gen.ID,
		"prompt":     gen.Prompt,
		"size":       size,
		"status":     "pending",
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

// ServeImageFile 本地图片文件服务
func (h *ImageHandler) ServeImageFile(c *gin.Context) {
	filename := c.Param("filename")
	// 安全校验：防止目录穿越
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "非法文件名"})
		return
	}
	path := filepath.Join(imagesDir, filename)
	c.File(path)
}

// AutoMigrate 自动迁移数据库表
func (h *ImageHandler) AutoMigrate() error {
	return h.db.AutoMigrate(&services.ImageGeneration{})
}

// processImageJob 后台处理单个图片生成任务（用于异步 goroutine 和启动恢复）
func (h *ImageHandler) processImageJob(recordID uint, prompt, size, quality, referenceImagePath, baseURL string) {
	ctx := context.Background()

	var imageURL, b64Data string
	var err error

	if referenceImagePath != "" {
		// image-to-image 模式：基于参考图编辑
		imageURL, b64Data, err = h.imageService.EditImage(ctx, prompt, size, referenceImagePath)
	} else {
		// 普通文生图模式
		imageURL, b64Data, err = h.imageService.GenerateImage(ctx, prompt, size, quality)
	}

	if err != nil {
		fmt.Printf("[图片生成失败] ID=%d size=%s quality=%s ref=%s err=%v\n", recordID, size, quality, referenceImagePath, err)
		if saveErr := h.db.Model(&services.ImageGeneration{}).Where("id = ?", recordID).Update("status", "failed").Error; saveErr != nil {
			fmt.Printf("[更新状态失败] ID=%d err=%v\n", recordID, saveErr)
		}
		return
	}

	// 处理 b64_json
	if b64Data != "" {
		filename, err := saveBase64Image(b64Data)
		if err != nil {
			fmt.Printf("[保存图片失败] ID=%d err=%v\n", recordID, err)
			if saveErr := h.db.Model(&services.ImageGeneration{}).Where("id = ?", recordID).Update("status", "failed").Error; saveErr != nil {
				fmt.Printf("[更新状态失败] ID=%d err=%v\n", recordID, saveErr)
			}
			return
		}
		imageURL = buildImageURL(baseURL, filename)
	}

	if imageURL == "" {
		fmt.Printf("[图片生成异常] ID=%d 未获取到 URL 或数据\n", recordID)
		if saveErr := h.db.Model(&services.ImageGeneration{}).Where("id = ?", recordID).Update("status", "failed").Error; saveErr != nil {
			fmt.Printf("[更新状态失败] ID=%d err=%v\n", recordID, saveErr)
		}
		return
	}

	if saveErr := h.db.Model(&services.ImageGeneration{}).Where("id = ?", recordID).Updates(map[string]interface{}{
		"image_url": imageURL,
		"status":    "completed",
	}).Error; saveErr != nil {
		fmt.Printf("[更新记录失败] ID=%d err=%v\n", recordID, saveErr)
	}
	fmt.Printf("[图片生成成功] ID=%d url=%s\n", recordID, imageURL)
}

// RecoverPendingJobs 服务启动时扫描并恢复所有 pending 状态的图片生成任务
// 防止进程重启导致异步 goroutine 丢失
func (h *ImageHandler) RecoverPendingJobs() {
	var pending []services.ImageGeneration
	if err := h.db.Where("status = ?", "pending").Find(&pending).Error; err != nil {
		fmt.Printf("[任务恢复] 查询 pending 任务失败: %v\n", err)
		return
	}

	if len(pending) == 0 {
		return
	}

	baseURL := h.cfg.BaseURL
	if baseURL == "" {
		baseURL = "http://localhost:9091"
	}
	baseURL = strings.TrimSuffix(baseURL, "/")

	fmt.Printf("[任务恢复] 发现 %d 个未完成的图片生成任务，正在重新执行...\n", len(pending))
	for _, job := range pending {
		// 从 ReferenceImageURL 提取本地文件路径
		var referenceImagePath string
		if job.ReferenceImageURL != "" {
			parts := strings.Split(job.ReferenceImageURL, "/")
			if len(parts) > 0 {
				filename := parts[len(parts)-1]
				if !strings.Contains(filename, "..") && !strings.Contains(filename, "/") {
					refPath := filepath.Join(imagesDir, filename)
					if _, statErr := os.Stat(refPath); statErr == nil {
						referenceImagePath = refPath
					}
				}
			}
		}
		go h.processImageJob(job.ID, job.Prompt, job.Size, job.Quality, referenceImagePath, baseURL)
	}
}
