package api

import (
	"aipool-backend/internal/services"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type PPTHandler struct {
	db         *gorm.DB
	pptService *services.PPTService
}

func NewPPTHandler(db *gorm.DB, pptService *services.PPTService) *PPTHandler {
	return &PPTHandler{
		db:         db,
		pptService: pptService,
	}
}

// 生成PPT请求
type GeneratePPTRequest struct {
	Topic      string `json:"topic" binding:"required"`
	SlideCount int    `json:"slide_count"` // 默认5-15页
	Template   string `json:"template"`    // modern, business, creative, minimal
}

// GeneratePPT 生成PPT
func (h *PPTHandler) GeneratePPT(c *gin.Context) {
	userID := getUserID(c)

	var req GeneratePPTRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 默认值
	if req.SlideCount == 0 {
		req.SlideCount = 8
	}
	if req.Template == "" {
		req.Template = "modern"
	}

	// 创建记录
	gen := &services.PPTGeneration{
		UserID:     userID,
		Topic:      req.Topic,
		Template:   req.Template,
		SlideCount: req.SlideCount,
		Status:     "pending",
	}
	h.db.Create(gen)

	// 调用服务生成PPT
	slides, err := h.pptService.GeneratePPT(c, req.Topic, req.SlideCount, req.Template)
	if err != nil {
		gen.Status = "failed"
		h.db.Save(gen)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 序列化slides
	slidesJSON, _ := json.Marshal(slides)
	gen.SlidesJSON = string(slidesJSON)
	gen.Status = "completed"
	h.db.Save(gen)

	c.JSON(http.StatusOK, gin.H{
		"id":          gen.ID,
		"topic":       gen.Topic,
		"template":    gen.Template,
		"slides":      slides,
		"slide_count": len(slides),
		"status":      gen.Status,
		"created_at":  gen.CreatedAt,
	})
}

// ListPPTs 获取PPT列表
func (h *PPTHandler) ListPPTs(c *gin.Context) {
	userID := getUserID(c)

	var ppts []services.PPTGeneration
	h.db.Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&ppts)

	c.JSON(http.StatusOK, gin.H{"ppts": ppts})
}

// GetPPT 获取单个PPT
func (h *PPTHandler) GetPPT(c *gin.Context) {
	userID := getUserID(c)
	pptID := c.Param("id")

	var ppt services.PPTGeneration
	if err := h.db.Where("id = ? AND user_id = ?", pptID, userID).First(&ppt).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "PPT不存在"})
		return
	}

	// 解析slides
	var slides []services.Slide
	json.Unmarshal([]byte(ppt.SlidesJSON), &slides)

	c.JSON(http.StatusOK, gin.H{
		"ppt":    ppt,
		"slides": slides,
	})
}

// DeletePPT 删除PPT
func (h *PPTHandler) DeletePPT(c *gin.Context) {
	userID := getUserID(c)
	pptID := c.Param("id")

	result := h.db.Where("id = ? AND user_id = ?", pptID, userID).Delete(&services.PPTGeneration{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "PPT不存在"})
		return
	}

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

// AutoMigrate 自动迁移数据库表
func (h *PPTHandler) AutoMigrate() error {
	return h.db.AutoMigrate(&services.PPTGeneration{})
}
