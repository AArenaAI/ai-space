package api

import (
	"aipool-backend/internal/services"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type TemplateHandler struct {
	db *gorm.DB
}

const legacyDefaultTemplatePrefix = "你是一个专业的AI助手。确保回复清晰、准确、完整。在适当情况下使用 Markdown 格式（标题、列表、代码块等）来增强可读性。"

func nonLegacyTemplateQuery(db *gorm.DB) *gorm.DB {
	return db.Where("NOT (is_default = ? AND name = ? AND prefix = ?)", true, "默认模板", legacyDefaultTemplatePrefix)
}

func NewTemplateHandler(db *gorm.DB) *TemplateHandler {
	return &TemplateHandler{db: db}
}

// ListTemplates 获取当前用户的模板列表
func (h *TemplateHandler) ListTemplates(c *gin.Context) {
	userID := getUserID(c)

	var templates []services.Template
	nonLegacyTemplateQuery(h.db).
		Where("user_id = ?", userID).
		Order("is_default desc, created_at desc").
		Find(&templates)

	c.JSON(http.StatusOK, templates)
}

type CreateTemplateRequest struct {
	Name      string `json:"name" binding:"required"`
	Prefix    string `json:"prefix" binding:"required"`
	IsDefault bool   `json:"is_default"`
}

// CreateTemplate 创建模板
func (h *TemplateHandler) CreateTemplate(c *gin.Context) {
	userID := getUserID(c)

	var req CreateTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tpl := services.Template{
		UserID:    userID,
		Name:      req.Name,
		Prefix:    req.Prefix,
		IsDefault: req.IsDefault,
	}

	// 如果设为默认，先清除其他默认
	if req.IsDefault {
		h.db.Model(&services.Template{}).Where("user_id = ? AND is_default = ?", userID, true).Update("is_default", false)
	}

	h.db.Create(&tpl)
	c.JSON(http.StatusCreated, tpl)
}

type UpdateTemplateRequest struct {
	Name      *string `json:"name,omitempty"`
	Prefix    *string `json:"prefix,omitempty"`
	IsDefault *bool   `json:"is_default,omitempty"`
}

// UpdateTemplate 更新模板
func (h *TemplateHandler) UpdateTemplate(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的ID"})
		return
	}

	var req UpdateTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var tpl services.Template
	if err := h.db.Where("id = ? AND user_id = ?", uint(id), userID).First(&tpl).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "模板不存在"})
		return
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Prefix != nil {
		updates["prefix"] = *req.Prefix
	}
	if req.IsDefault != nil && *req.IsDefault {
		// 清除其他默认
		h.db.Model(&services.Template{}).Where("user_id = ? AND is_default = ?", userID, true).Update("is_default", false)
		updates["is_default"] = true
	} else if req.IsDefault != nil && !*req.IsDefault {
		updates["is_default"] = false
	}

	h.db.Model(&tpl).Updates(updates)
	h.db.First(&tpl, tpl.ID)
	c.JSON(http.StatusOK, tpl)
}

// DeleteTemplate 删除模板
func (h *TemplateHandler) DeleteTemplate(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的ID"})
		return
	}

	result := h.db.Where("id = ? AND user_id = ?", uint(id), userID).Delete(&services.Template{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "模板不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// AutoMigrate 自动迁移表结构
func (h *TemplateHandler) AutoMigrate() error {
	return h.db.AutoMigrate(&services.Template{})
}
