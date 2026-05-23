package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/middleware"
	"aipool-backend/internal/models"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AuthHandler struct {
	db  *gorm.DB
	cfg *config.Config
}

func NewAuthHandler(db *gorm.DB, cfg *config.Config) *AuthHandler {
	return &AuthHandler{db: db, cfg: cfg}
}

type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
	Name     string `json:"name"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type UpdateProfileRequest struct {
	Email string `json:"email" binding:"required,email"`
	Name  string `json:"name"`
}

func normalizeAuthEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Email = normalizeAuthEmail(req.Email)
	req.Name = strings.TrimSpace(req.Name)

	// 检查邮箱是否已注册
	var existingUser models.User
	if err := h.db.Where("email = ?", req.Email).First(&existingUser).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该邮箱已被注册"})
		return
	}

	var user models.User
	var defaultWorkspace models.Workspace
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		// 创建用户（初始化 free 套餐 + 30 基础积分）
		user = models.User{
			Email:           req.Email,
			Password:        req.Password,
			Name:            req.Name,
			BasicCredits:    30,
			AdvancedCredits: 0,
			EliteCredits:    0,
			PlanTier:        "free",
		}

		if err := user.HashPassword(); err != nil {
			return err
		}

		if err := tx.Create(&user).Error; err != nil {
			return err
		}

		// 创建默认工作区
		defaultWorkspace = models.Workspace{
			UserID:    user.ID,
			Name:      "默认工作区",
			Icon:      "📁",
			Color:     "#6366f1",
			IsDefault: true,
		}
		return tx.Create(&defaultWorkspace).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建账号失败"})
		return
	}

	// 生成 token
	token, err := middleware.GenerateToken(user.ID, user.Email, h.cfg.JWTSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 token 失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"user": gin.H{
			"id":                   user.ID,
			"email":                user.Email,
			"name":                 user.Name,
			"basic_credits":        user.BasicCredits,
			"advanced_credits":     user.AdvancedCredits,
			"elite_credits":        user.EliteCredits,
			"plan_tier":            user.PlanTier,
			"default_workspace_id": defaultWorkspace.ID,
		},
		"token": token,
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Email = normalizeAuthEmail(req.Email)

	// 查找用户
	var user models.User
	if err := h.db.Where("email = ?", req.Email).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "邮箱或密码错误"})
		return
	}

	// 验证密码
	if !user.CheckPassword(req.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "邮箱或密码错误"})
		return
	}

	// 生成 token
	token, err := middleware.GenerateToken(user.ID, user.Email, h.cfg.JWTSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 token 失败"})
		return
	}

	// 查找用户的默认工作区
	var defaultWS models.Workspace
	h.db.Where("user_id = ? AND is_default = ?", user.ID, true).First(&defaultWS)

	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":                   user.ID,
			"email":                user.Email,
			"name":                 user.Name,
			"basic_credits":        user.BasicCredits,
			"advanced_credits":     user.AdvancedCredits,
			"elite_credits":        user.EliteCredits,
			"plan_tier":            user.PlanTier,
			"default_workspace_id": defaultWS.ID,
		},
		"token": token,
	})
}

func (h *AuthHandler) GetUserCount(c *gin.Context) {
	var count int64
	if err := h.db.Model(&models.User{}).Count(&count).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户数量失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"count": count})
}

func (h *AuthHandler) GetUsers(c *gin.Context) {
	var users []models.User
	if err := h.db.Select("id, email, name, created_at").Order("id ASC").Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": users, "total": len(users)})
}

func (h *AuthHandler) UpdateProfile(c *gin.Context) {
	userIDValue, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	userID, ok := userIDValue.(uint)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "认证信息无效"})
		return
	}

	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Email = normalizeAuthEmail(req.Email)
	req.Name = strings.TrimSpace(req.Name)

	var user models.User
	if err := h.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	if req.Email != user.Email {
		var count int64
		if err := h.db.Model(&models.User{}).Where("email = ? AND id <> ?", req.Email, userID).Count(&count).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "检查邮箱失败"})
			return
		}
		if count > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该邮箱已被注册"})
			return
		}
	}

	user.Email = req.Email
	user.Name = req.Name
	if err := h.db.Save(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存用户资料失败"})
		return
	}

	var defaultWS models.Workspace
	h.db.Where("user_id = ? AND is_default = ?", user.ID, true).First(&defaultWS)

	c.JSON(http.StatusOK, gin.H{"user": gin.H{
		"id":                   user.ID,
		"email":                user.Email,
		"name":                 user.Name,
		"basic_credits":        user.BasicCredits,
		"advanced_credits":     user.AdvancedCredits,
		"elite_credits":        user.EliteCredits,
		"plan_tier":            user.PlanTier,
		"default_workspace_id": defaultWS.ID,
	}})
}

func (h *AuthHandler) DeleteAccount(c *gin.Context) {
	userIDValue, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	userID, ok := userIDValue.(uint)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "认证信息无效"})
		return
	}

	if err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userID).Delete(&models.MessageFile{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.ConversationFile{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.FileEmbeddingJob{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.FileEmbedding{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.FileChunk{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.File{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.Message{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.ConversationShare{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.Conversation{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.ImageChatMessage{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.ImageChat{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.PPTRevision{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.PPTSlide{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.PPTGeneration{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.CompareRecord{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.UserSkill{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.Workspace{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.APIUsageLog{}).Error; err != nil { return err }
		if err := tx.Where("user_id = ?", userID).Delete(&models.AIBackgroundTask{}).Error; err != nil { return err }
		if err := tx.Delete(&models.User{}, userID).Error; err != nil { return err }
		return nil
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除账号失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "账号已删除"})
}
