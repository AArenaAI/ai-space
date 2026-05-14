package api

import (
	"net/http"

	"aipool-backend/internal/models"
	"aipool-backend/internal/skills"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// SkillHandler 技能 API 处理器
type SkillHandler struct {
	db     *gorm.DB
	loader *skills.Loader
}

// NewSkillHandler 创建技能处理器
func NewSkillHandler(db *gorm.DB, loader *skills.Loader) *SkillHandler {
	return &SkillHandler{db: db, loader: loader}
}

// ListSkills 获取所有技能列表（包含系统内置 + 用户自定义）
func (h *SkillHandler) ListSkills(c *gin.Context) {
	// 获取系统技能
	systemSkills := h.loader.GetAllSkills()

	// 获取当前用户的自定义技能
	userID, _ := c.Get("userID")
	var userSkills []models.UserSkill
	if userID != nil {
		h.db.Where("user_id = ? AND enabled = ?", userID, true).Find(&userSkills)
	}

	// 转换用户技能为 SkillMeta 格式
	customSkills := make([]skills.SkillMeta, 0, len(userSkills))
	for _, us := range userSkills {
		customSkills = append(customSkills, skills.SkillMeta{
			Key:         us.Key,
			DisplayName: us.DisplayName,
			Version:     "1.0.0",
			Description: us.Description,
			Category:    us.Category,
			Icon:        us.Icon,
			Color:       us.Color,
			Enabled:     us.Enabled,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"system_skills": systemSkills,
		"custom_skills": customSkills,
	})
}

// GetSkill 获取单个技能详情
func (h *SkillHandler) GetSkill(c *gin.Context) {
	key := c.Param("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "skill key is required"})
		return
	}

	// 先查系统技能
	skill := h.loader.GetSkill(key)
	if skill != nil {
		c.JSON(http.StatusOK, gin.H{
			"key":               skill.Key,
			"display_name":      skill.DisplayName,
			"version":           skill.Version,
			"description":       skill.Description,
			"category":          skill.Category,
			"icon":              skill.Icon,
			"color":             skill.Color,
			"recommended_model": skill.RecommendedModel,
			"triggers":          skill.Triggers,
			"enabled":           skill.Enabled,
			"content":           skill.Content,
		})
		return
	}

	// 再查用户自定义技能
	userID, _ := c.Get("userID")
	if userID != nil {
		var userSkill models.UserSkill
		if err := h.db.Where("user_id = ? AND key = ? AND enabled = ?", userID, key, true).First(&userSkill).Error; err == nil {
			c.JSON(http.StatusOK, gin.H{
				"key":          userSkill.Key,
				"display_name": userSkill.DisplayName,
				"description":  userSkill.Description,
				"category":     userSkill.Category,
				"icon":         userSkill.Icon,
				"color":        userSkill.Color,
				"enabled":      userSkill.Enabled,
				"content":      userSkill.Content,
			})
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "skill not found"})
}

// CreateUserSkill 创建用户自定义技能
func (h *SkillHandler) CreateUserSkill(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req struct {
		Key         string `json:"key" binding:"required"`
		DisplayName string `json:"display_name" binding:"required"`
		Description string `json:"description"`
		Category    string `json:"category"`
		Content     string `json:"content" binding:"required"`
		Icon        string `json:"icon"`
		Color       string `json:"color"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查是否重复
	var count int64
	h.db.Model(&models.UserSkill{}).Where("user_id = ? AND key = ?", userID, req.Key).Count(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "skill key already exists"})
		return
	}

	skill := models.UserSkill{
		UserID:      userID.(uint),
		Key:         req.Key,
		DisplayName: req.DisplayName,
		Description: req.Description,
		Category:    req.Category,
		Content:     req.Content,
		Icon:        req.Icon,
		Color:       req.Color,
		Enabled:     true,
	}

	if err := h.db.Create(&skill).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, skill)
}

// UpdateUserSkill 更新用户自定义技能
func (h *SkillHandler) UpdateUserSkill(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	key := c.Param("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "skill key is required"})
		return
	}

	var req struct {
		DisplayName string `json:"display_name"`
		Description string `json:"description"`
		Category    string `json:"category"`
		Content     string `json:"content"`
		Icon        string `json:"icon"`
		Color       string `json:"color"`
		Enabled     *bool  `json:"enabled"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var skill models.UserSkill
	if err := h.db.Where("user_id = ? AND key = ?", userID, key).First(&skill).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "skill not found"})
		return
	}

	updates := make(map[string]interface{})
	if req.DisplayName != "" {
		updates["display_name"] = req.DisplayName
	}
	if req.Description != "" {
		updates["description"] = req.Description
	}
	if req.Category != "" {
		updates["category"] = req.Category
	}
	if req.Content != "" {
		updates["content"] = req.Content
	}
	if req.Icon != "" {
		updates["icon"] = req.Icon
	}
	if req.Color != "" {
		updates["color"] = req.Color
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}

	if err := h.db.Model(&skill).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, skill)
}

// DeleteUserSkill 删除用户自定义技能
func (h *SkillHandler) DeleteUserSkill(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	key := c.Param("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "skill key is required"})
		return
	}

	if err := h.db.Where("user_id = ? AND key = ?", userID, key).Delete(&models.UserSkill{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "skill deleted"})
}

// DetectSkill 检测用户消息是否匹配技能
func (h *SkillHandler) DetectSkill(c *gin.Context) {
	var req struct {
		Message string `json:"message" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	matcher := skills.NewMatcher(h.loader)
	result := matcher.Match(req.Message)

	if result.Matched {
		c.JSON(http.StatusOK, gin.H{
			"matched":  true,
			"skill":    result.Skill,
			"keyword":  result.Keyword,
			"suggest":  true,
			"message":  "检测到关联技能: " + result.Skill.DisplayName,
		})
	} else {
		c.JSON(http.StatusOK, gin.H{
			"matched": false,
			"suggest": false,
		})
	}
}
