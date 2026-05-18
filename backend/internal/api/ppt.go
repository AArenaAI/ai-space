package api

import (
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type PPTHandler struct {
	db           *gorm.DB
	pptService   *services.PPTService
	usageService *services.UsageService
}

func NewPPTHandler(db *gorm.DB, pptService *services.PPTService, usageService *services.UsageService) *PPTHandler {
	return &PPTHandler{
		db:           db,
		pptService:   pptService,
		usageService: usageService,
	}
}

// saveSlides 统一保存 slides：SlidesJSON 为主数据源，PPTSlide 表为辅助表
func (h *PPTHandler) saveSlides(gen *models.PPTGeneration, slides []services.FullSlide) error {
	slidesJSON, err := json.Marshal(slides)
	if err != nil {
		return err
	}
	gen.SlidesJSON = string(slidesJSON)

	// 同步辅助表：先清除旧记录，再批量插入
	if err := h.db.Where("ppt_id = ?", gen.ID).Delete(&models.PPTSlide{}).Error; err != nil {
		return err
	}
	for _, slide := range slides {
		contentJSON, _ := json.Marshal(slide.Content)
		var imagePrompt, imageURL string
		if slide.Image != nil {
			imagePrompt = slide.Image.Prompt
			imageURL = slide.Image.URL
		}
		var chartJSON string
		if slide.Chart != nil {
			b, _ := json.Marshal(slide.Chart)
			chartJSON = string(b)
		}
		pptSlide := models.PPTSlide{
			PPTID:        gen.ID,
			Page:         slide.Page,
			Type:         slide.Type,
			Title:        slide.Title,
			Subtitle:     slide.Subtitle,
			ContentJSON:  string(contentJSON),
			Layout:       slide.Layout,
			ImagePrompt:  imagePrompt,
			ImageURL:     imageURL,
			SpeakerNotes: slide.SpeakerNotes,
			ChartJSON:    chartJSON,
		}
		if err := h.db.Create(&pptSlide).Error; err != nil {
			return err
		}
	}

	return h.db.Save(gen).Error
}

func (h *PPTHandler) AutoMigrate() error {
	return h.db.AutoMigrate(&models.PPTGeneration{}, &models.PPTSlide{}, &models.PPTRevision{}, &models.PPTImageJob{})
}

// CreatePPT 创建 PPT 任务
func (h *PPTHandler) CreatePPT(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)

	var req struct {
		Topic       string `json:"topic" binding:"required"`
		TemplateID  string `json:"template_id"`
		SlideCount  int    `json:"slide_count"`
		Language    string `json:"language"`
		Audience    string `json:"audience"`
		Purpose      string `json:"purpose"`
		ExtraContent string `json:"extra_content"`
		ReferenceURL string `json:"reference_url"`
		WithImages   string `json:"with_images"`
		WithNotes   bool   `json:"with_notes"`
		QualityMode string `json:"quality_mode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.SlideCount == 0 {
		req.SlideCount = 8
	}
	if req.TemplateID == "" {
		req.TemplateID = "modern"
	}
	if req.Language == "" {
		req.Language = "zh-CN"
	}
	if req.WithImages == "" {
		req.WithImages = "key_slides"
	}
	if req.QualityMode == "" {
		req.QualityMode = "standard"
	}

	gen := models.PPTGeneration{
		UserID:      userID,
		GuestID:     guestID,
		Title:       req.Topic,
		Topic:       req.Topic,
		TemplateID:  req.TemplateID,
		SlideCount:  req.SlideCount,
		Language:    req.Language,
		Audience:    req.Audience,
		Purpose:      req.Purpose,
		ExtraContent: req.ExtraContent,
		ReferenceURL: req.ReferenceURL,
		WithImages:   req.WithImages,
		WithNotes:   req.WithNotes,
		QualityMode: req.QualityMode,
		Status:      models.PPTStatusPending,
	}
	h.db.Create(&gen)

	c.JSON(http.StatusOK, gin.H{
		"id":     gen.ID,
		"status": gen.Status,
		"ppt":    gen,
	})
}

// ListPPTs 获取 PPT 列表
func (h *PPTHandler) ListPPTs(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)

	var ppts []models.PPTGeneration
	query := h.db.Order("created_at DESC")
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	} else if guestID != "" {
		query = query.Where("guest_id = ?", guestID)
	} else {
		c.JSON(http.StatusOK, gin.H{"ppts": []models.PPTGeneration{}})
		return
	}
	query.Find(&ppts)

	c.JSON(http.StatusOK, gin.H{"ppts": ppts})
}

// GetPPT 获取单个 PPT
func (h *PPTHandler) GetPPT(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	pptID := c.Param("id")

	var gen models.PPTGeneration
	if err := h.db.Where("id = ? AND (user_id = ? OR guest_id = ?)", pptID, userID, guestID).First(&gen).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "PPT 不存在"})
		return
	}

	var slides []services.FullSlide
	if gen.SlidesJSON != "" {
		json.Unmarshal([]byte(gen.SlidesJSON), &slides)
	}

	c.JSON(http.StatusOK, gin.H{
		"ppt":    gen,
		"slides": slides,
	})
}

// GetPPTStatus 获取生成状态
func (h *PPTHandler) GetPPTStatus(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	pptID := c.Param("id")

	var gen models.PPTGeneration
	if err := h.db.Where("id = ? AND (user_id = ? OR guest_id = ?)", pptID, userID, guestID).First(&gen).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "PPT 不存在"})
		return
	}

	var slides []services.FullSlide
	if gen.SlidesJSON != "" {
		json.Unmarshal([]byte(gen.SlidesJSON), &slides)
	}

	c.JSON(http.StatusOK, gin.H{
		"id":           gen.ID,
		"status":       gen.Status,
		"progress":     gen.Progress,
		"progress_msg": gen.ProgressMsg,
		"error_msg":    gen.ErrorMsg,
		"title":        gen.Title,
		"outline":      gen.OutlineJSON,
		"slides":       slides,
	})
}

// GetPPTOutline 获取已生成的大纲
func (h *PPTHandler) GetPPTOutline(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	pptID := c.Param("id")

	var gen models.PPTGeneration
	if err := h.db.Where("id = ? AND (user_id = ? OR guest_id = ?)", pptID, userID, guestID).First(&gen).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "PPT 不存在"})
		return
	}

	var outline services.PPTOutline
	if gen.OutlineJSON != "" {
		json.Unmarshal([]byte(gen.OutlineJSON), &outline)
	}

	c.JSON(http.StatusOK, gin.H{
		"id":      gen.ID,
		"status":  gen.Status,
		"outline": outline,
	})
}

// GenerateOutline 生成大纲
func (h *PPTHandler) GenerateOutline(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	pptID := c.Param("id")

	var gen models.PPTGeneration
	if err := h.db.Where("id = ? AND (user_id = ? OR guest_id = ?)", pptID, userID, guestID).First(&gen).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "PPT 不存在"})
		return
	}

	gen.Status = models.PPTStatusPlanning
	gen.Progress = 10
	gen.ProgressMsg = "正在策划大纲..."
	h.db.Save(&gen)

	outline, usage, err := h.pptService.GenerateOutline(c, gen.Topic, gen.SlideCount, gen.TemplateID, gen.Audience, gen.Purpose, gen.Language, gen.ExtraContent, gen.ReferenceURL, gen.QualityMode, "")
	if err != nil {
		gen.Status = models.PPTStatusFailed
		gen.ErrorMsg = err.Error()
		h.db.Save(&gen)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	outlineJSON, _ := json.Marshal(outline)
	gen.OutlineJSON = string(outlineJSON)
	gen.Title = outline.Title
	gen.Status = models.PPTStatusOutlineReady
	gen.Progress = 30
	gen.ProgressMsg = "大纲已生成"
	if usage != nil {
		gen.PromptTokens += usage.PromptTokens
		gen.CompTokens += usage.CompletionTokens
	}
	h.db.Save(&gen)

	// 记录用量
	if h.usageService != nil {
		_ = h.usageService.RecordPPTUsage(userID, h.pptService.DocGenModel(), gen.ID, usage)
	}

	c.JSON(http.StatusOK, gin.H{
		"id":      gen.ID,
		"status":  gen.Status,
		"outline": outline,
	})
}

// ConfirmOutline 确认大纲并异步生成完整 PPT
func (h *PPTHandler) ConfirmOutline(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	pptID := c.Param("id")

	var gen models.PPTGeneration
	if err := h.db.Where("id = ? AND (user_id = ? OR guest_id = ?)", pptID, userID, guestID).First(&gen).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "PPT 不存在"})
		return
	}

	var req struct {
		Outline *services.PPTOutline `json:"outline"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 如果用户上传了修改后的大纲，更新
	if req.Outline != nil {
		outlineJSON, _ := json.Marshal(req.Outline)
		gen.OutlineJSON = string(outlineJSON)
		gen.Title = req.Outline.Title
	}

	gen.Status = models.PPTStatusGeneratingSlides
	gen.Progress = 40
	gen.ProgressMsg = "正在生成幻灯片内容..."
	h.db.Save(&gen)

	// 启动后台 goroutine 异步生成
	go func(genID uint) {
		var g models.PPTGeneration
		if err := h.db.First(&g, genID).Error; err != nil {
			fmt.Printf("[ConfirmOutline] goroutine 找不到 PPT %d: %v\n", genID, err)
			return
		}

		var outline services.PPTOutline
		json.Unmarshal([]byte(g.OutlineJSON), &outline)

		slides, usage, err := h.pptService.GenerateFullPPT(context.Background(), &outline, g.TemplateID, g.Audience, g.Purpose, g.Language, g.WithImages, g.WithNotes, g.ExtraContent, g.ReferenceURL, g.QualityMode)
		if err != nil {
			g.Status = models.PPTStatusFailed
			g.ErrorMsg = err.Error()
			h.db.Save(&g)
			fmt.Printf("[ConfirmOutline] 生成 PPT %d 失败: %v\n", genID, err)
			return
		}

		if usage != nil {
			g.PromptTokens += usage.PromptTokens
			g.CompTokens += usage.CompletionTokens
		}

		// 保存 slides
		if err := h.saveSlides(&g, slides); err != nil {
			g.Status = models.PPTStatusFailed
			g.ErrorMsg = err.Error()
			h.db.Save(&g)
			fmt.Printf("[ConfirmOutline] 保存 slides %d 失败: %v\n", genID, err)
			return
		}

		// 记录用量
		if h.usageService != nil {
			_ = h.usageService.RecordPPTUsage(g.UserID, h.pptService.DocGenModel(), g.ID, usage)
		}

		// 配图策略
		needsImages := g.WithImages != "none" && g.WithImages != ""
		if needsImages {
			g.Status = models.PPTStatusGeneratingImages
			g.Progress = 70
			g.ProgressMsg = "正在生成配图..."
			h.db.Save(&g)

			var jobsSlides []services.FullSlide
			for _, s := range slides {
				if s.Image != nil && s.Image.Needed && s.Image.Prompt != "" {
					shouldGen := false
					switch g.WithImages {
					case "cover":
						shouldGen = s.Type == "cover"
					case "key_slides":
						shouldGen = s.Type == "cover" || s.Type == "section" || s.Type == "summary"
					case "all":
						shouldGen = true
					}
					if shouldGen {
						jobsSlides = append(jobsSlides, s)
					}
				}
			}

			if len(jobsSlides) > 0 {
				if err := h.pptService.CreateImageJobs(g.ID, jobsSlides); err != nil {
					fmt.Printf("[ConfirmOutline] 创建 image jobs 失败: %v\n", err)
				}
			} else {
				g.Status = models.PPTStatusCompleted
				g.Progress = 100
				g.ProgressMsg = "PPT 生成完成"
				h.db.Save(&g)
			}
		} else {
			g.Status = models.PPTStatusCompleted
			g.Progress = 100
			g.ProgressMsg = "PPT 生成完成"
			h.db.Save(&g)
		}
	}(gen.ID)

	// 立即返回，不等待生成
	c.JSON(http.StatusOK, gin.H{
		"id":     gen.ID,
		"status": gen.Status,
		"ppt":    gen,
		"slides": []services.FullSlide{},
	})
}

// UpdateSlide 更新单页
func (h *PPTHandler) UpdateSlide(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	pptID := c.Param("id")
	pageStr := c.Param("page")
	page, _ := strconv.Atoi(pageStr)

	var gen models.PPTGeneration
	if err := h.db.Where("id = ? AND (user_id = ? OR guest_id = ?)", pptID, userID, guestID).First(&gen).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "PPT 不存在"})
		return
	}

	var slide services.FullSlide
	if err := c.ShouldBindJSON(&slide); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 更新 slides
	var slides []services.FullSlide
	if gen.SlidesJSON != "" {
		json.Unmarshal([]byte(gen.SlidesJSON), &slides)
	}
	for i := range slides {
		if slides[i].Page == page {
			slides[i] = slide
			break
		}
	}

	if err := h.saveSlides(&gen, slides); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"slide": slide})
}

// RewriteSlide 重写单页
func (h *PPTHandler) RewriteSlide(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	pptID := c.Param("id")
	pageStr := c.Param("page")
	page, _ := strconv.Atoi(pageStr)

	var gen models.PPTGeneration
	if err := h.db.Where("id = ? AND (user_id = ? OR guest_id = ?)", pptID, userID, guestID).First(&gen).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "PPT 不存在"})
		return
	}

	var req struct {
		Instruction string `json:"instruction"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 找到当前 slide
	var slides []services.FullSlide
	if gen.SlidesJSON != "" {
		json.Unmarshal([]byte(gen.SlidesJSON), &slides)
	}
	var currentSlide services.FullSlide
	for _, s := range slides {
		if s.Page == page {
			currentSlide = s
			break
		}
	}
	if currentSlide.Page == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "幻灯片不存在"})
		return
	}

	newSlide, usage, err := h.pptService.RewriteSlide(c, currentSlide, req.Instruction, gen.Audience, gen.Purpose)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 更新 slides
	for i := range slides {
		if slides[i].Page == page {
			slides[i] = newSlide
			break
		}
	}
	if usage != nil {
		gen.PromptTokens += usage.PromptTokens
		gen.CompTokens += usage.CompletionTokens
	}
	if err := h.saveSlides(&gen, slides); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"slide": newSlide})
}

// RegenerateSlideImage 重新生成单页图片
func (h *PPTHandler) RegenerateSlideImage(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	pptID := c.Param("id")
	pageStr := c.Param("page")
	page, _ := strconv.Atoi(pageStr)

	var gen models.PPTGeneration
	if err := h.db.Where("id = ? AND (user_id = ? OR guest_id = ?)", pptID, userID, guestID).First(&gen).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "PPT 不存在"})
		return
	}

	var req struct {
		Instruction string `json:"instruction"`
	}
	c.ShouldBindJSON(&req)

	// 找到当前 slide
	var slides []services.FullSlide
	if gen.SlidesJSON != "" {
		json.Unmarshal([]byte(gen.SlidesJSON), &slides)
	}
	var currentSlide services.FullSlide
	for _, s := range slides {
		if s.Page == page {
			currentSlide = s
			break
		}
	}
	if currentSlide.Page == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "幻灯片不存在"})
		return
	}

	// 使用指令精修 prompt，或直接用现有 prompt
	prompt := ""
	if req.Instruction != "" && currentSlide.Image != nil {
		newPrompt, _, err := h.pptService.GenerateImagePrompt(c, currentSlide, req.Instruction)
		if err == nil && newPrompt != "" {
			prompt = newPrompt
		}
	}
	if prompt == "" && currentSlide.Image != nil {
		prompt = currentSlide.Image.Prompt
	}
	if prompt == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无图片生成 prompt"})
		return
	}

	url, _, err := h.pptService.GenerateImage(c, prompt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 更新 slides
	for i := range slides {
		if slides[i].Page == page {
			if slides[i].Image == nil {
				slides[i].Image = &services.SlideImage{}
			}
			slides[i].Image.URL = url
			break
		}
	}
	if err := h.saveSlides(&gen, slides); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"url": url})
}

// ExportPPT 导出 PPT
func (h *PPTHandler) ExportPPT(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	pptID := c.Param("id")
	format := c.Param("format")

	var gen models.PPTGeneration
	if err := h.db.Where("id = ? AND (user_id = ? OR guest_id = ?)", pptID, userID, guestID).First(&gen).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "PPT 不存在"})
		return
	}

	var slides []services.FullSlide
	if gen.SlidesJSON != "" {
		json.Unmarshal([]byte(gen.SlidesJSON), &slides)
	}

	switch format {
	case "markdown":
		md := h.pptService.ExportToMarkdown(gen.Title, slides)
		c.Header("Content-Type", "text/markdown; charset=utf-8")
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.md\"", sanitizeFilename(gen.Title)))
		c.String(http.StatusOK, md)
	case "text":
		var text strings.Builder
		text.WriteString(gen.Title + "\n\n")
		for _, slide := range slides {
			text.WriteString(fmt.Sprintf("%d. %s\n", slide.Page, slide.Title))
			for _, item := range slide.Content {
				text.WriteString("   - " + item + "\n")
			}
			text.WriteString("\n")
		}
		c.Header("Content-Type", "text/plain; charset=utf-8")
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.txt\"", sanitizeFilename(gen.Title)))
		c.String(http.StatusOK, text.String())
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的格式"})
	}
}

// GetPPTImageJobs 获取 PPT 图片生成任务状态
func (h *PPTHandler) GetPPTImageJobs(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	pptID := c.Param("id")

	var gen models.PPTGeneration
	if err := h.db.Where("id = ? AND (user_id = ? OR guest_id = ?)", pptID, userID, guestID).First(&gen).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "PPT 不存在"})
		return
	}

	var jobs []models.PPTImageJob
	if err := h.db.Where("ppt_id = ?", pptID).Order("page ASC").Find(&jobs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 统计
	var total, completed, pending, failed int64
	h.db.Model(&models.PPTImageJob{}).Where("ppt_id = ?", pptID).Count(&total)
	h.db.Model(&models.PPTImageJob{}).Where("ppt_id = ? AND status = ?", pptID, "completed").Count(&completed)
	h.db.Model(&models.PPTImageJob{}).Where("ppt_id = ? AND status = ?", pptID, "pending").Count(&pending)
	h.db.Model(&models.PPTImageJob{}).Where("ppt_id = ? AND status = ?", pptID, "failed").Count(&failed)

	c.JSON(http.StatusOK, gin.H{
		"ppt_id":   gen.ID,
		"total":    total,
		"completed": completed,
		"pending":  pending,
		"failed":   failed,
		"jobs":     jobs,
	})
}

// DeletePPT 删除 PPT
func (h *PPTHandler) DeletePPT(c *gin.Context) {
	userID := getUserID(c)
	guestID := getGuestID(c)
	pptID := c.Param("id")

	result := h.db.Where("id = ? AND (user_id = ? OR guest_id = ?)", pptID, userID, guestID).Delete(&models.PPTGeneration{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "PPT 不存在"})
		return
	}

	// 级联删除 slides
	h.db.Where("ppt_id = ?", pptID).Delete(&models.PPTSlide{})

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// GetTemplates 获取模板列表
func (h *PPTHandler) GetTemplates(c *gin.Context) {
	templates := []map[string]interface{}{
		{
			"id":           "modern",
			"name":         "现代简约",
			"description":  "清爽现代的设计风格，适合科技、互联网场景",
			"preview":      "蓝色主调 + 白色背景",
			"primaryColor": "#3B82F6",
		},
		{
			"id":           "business",
			"name":         "商务正式",
			"description":  "稳重专业的商务风格，适合汇报、提案场景",
			"preview":      "深蓝色调 + 灰色背景",
			"primaryColor": "#1E3A5F",
		},
		{
			"id":           "creative",
			"name":         "创意活力",
			"description":  "亮色渐变的创意风格，适合营销、设计场景",
			"preview":      "粉紫渐变 + 淡色背景",
			"primaryColor": "#EC4899",
		},
		{
			"id":           "minimal",
			"name":         "极简纯净",
			"description":  "极致简洁的设计，适合严肃、高端场景",
			"preview":      "黑白配色 + 纯白背景",
			"primaryColor": "#000000",
		},
	}

	c.JSON(http.StatusOK, gin.H{"templates": templates})
}

func sanitizeFilename(name string) string {
	name = strings.ReplaceAll(name, " ", "_")
	name = strings.ReplaceAll(name, "/", "_")
	name = strings.ReplaceAll(name, "\\", "_")
	if name == "" {
		name = "ppt"
	}
	return name
}
