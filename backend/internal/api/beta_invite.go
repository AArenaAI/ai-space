package api

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// BetaInviteHandler 处理内测邀请与申请
type BetaInviteHandler struct {
	db           *gorm.DB
	cfg          *config.Config
	emailService *services.EmailService
}

// NewBetaInviteHandler 创建 BetaInviteHandler
func NewBetaInviteHandler(db *gorm.DB, cfg *config.Config, emailService *services.EmailService) *BetaInviteHandler {
	return &BetaInviteHandler{db: db, cfg: cfg, emailService: emailService}
}

// ========== 邀请码生成 ==========

func generateInviteCode() string {
	b := make([]byte, 6)
	rand.Read(b)
	return strings.ToUpper(hex.EncodeToString(b))
}

// GenerateInvitesRequest 批量生成邀请码请求
type GenerateInvitesRequest struct {
	Count    int    `json:"count" binding:"required,min=1,max=100"`
	Batch    string `json:"batch" binding:"required"` // batch-1, batch-2, batch-3
	Industry string `json:"industry,omitempty"`
	Basic    int    `json:"credits_basic,omitempty"`
	Advanced int    `json:"credits_advanced,omitempty"`
	Elite    int    `json:"credits_elite,omitempty"`
}

// GenerateInvites 批量生成邀请码（管理员）
func (h *BetaInviteHandler) GenerateInvites(c *gin.Context) {
	var req GenerateInvitesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	basic := req.Basic
	if basic == 0 {
		basic = NewBetaConfigHandler(h.db).GetConfigInt(models.BetaConfigPhase1Credits, 5000)
	}

	var codes []string
	for i := 0; i < req.Count; i++ {
		code := generateInviteCode()
		for {
			var count int64
			h.db.Model(&models.BetaInvite{}).Where("code = ?", code).Count(&count)
			if count == 0 {
				break
			}
			code = generateInviteCode()
		}
		codes = append(codes, code)
		invite := models.BetaInvite{
			Code:            code,
			Batch:           req.Batch,
			Industry:        req.Industry,
			CreditsBasic:    basic,
			CreditsAdvanced: req.Advanced,
			CreditsElite:    req.Elite,
			Status:          "unused",
		}
		h.db.Create(&invite)
	}

	c.JSON(http.StatusCreated, gin.H{
		"codes": codes,
		"count": len(codes),
		"batch": req.Batch,
	})
}

// ListInvites 获取邀请码列表（管理员）
func (h *BetaInviteHandler) ListInvites(c *gin.Context) {
	batch := c.Query("batch")
	status := c.Query("status")
	page := parseIntQuery(c, "page", 1)
	pageSize := parseIntQuery(c, "page_size", 20)
	if pageSize > 100 {
		pageSize = 100
	}

	var total int64
	query := h.db.Model(&models.BetaInvite{})
	if batch != "" {
		query = query.Where("batch = ?", batch)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	query.Count(&total)

	var invites []models.BetaInvite
	if err := query.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&invites).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":       invites,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": (int(total) + pageSize - 1) / pageSize,
	})
}

// ========== 用户申请 ==========

// SubmitApplicationRequest 提交内测申请
type SubmitApplicationRequest struct {
	Email           string `json:"email" binding:"required,email"`
	Name            string `json:"name" binding:"required"`
	Industry        string `json:"industry" binding:"required"`
	JobTitle        string `json:"job_title"`
	UseCase         string `json:"use_case" binding:"required"`
	BadCaseSample   string `json:"bad_case_sample"`
	ExperienceLevel string `json:"experience_level"`
}

// SubmitApplication 提交内测申请（公开）
func (h *BetaInviteHandler) SubmitApplication(c *gin.Context) {
	var req SubmitApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var existing models.BetaApplication
	if err := h.db.Where("email = ?", req.Email).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "该邮箱已提交申请，请勿重复提交"})
		return
	}

	app := models.BetaApplication{
		Email:           req.Email,
		Name:            req.Name,
		Industry:        req.Industry,
		JobTitle:        req.JobTitle,
		UseCase:         req.UseCase,
		BadCaseSample:   req.BadCaseSample,
		ExperienceLevel: req.ExperienceLevel,
		Status:          "pending",
	}

	if err := h.db.Create(&app).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "提交失败"})
		return
	}

	// 记录内测申请事件（埋点）
	h.db.Create(&models.AnalyticsEvent{
		EventType: "beta_apply",
		EventName: "beta_apply",
		PagePath:  c.Request.URL.Path,
		Metadata:  fmt.Sprintf(`{"email":"%s","industry":"%s"}`, req.Email, req.Industry),
	})

	c.JSON(http.StatusCreated, gin.H{
		"id":      app.ID,
		"status":  app.Status,
		"message": "申请已提交，我们将尽快审核",
	})
}

// ListApplications 获取申请列表（管理员）
func (h *BetaInviteHandler) ListApplications(c *gin.Context) {
	status := c.Query("status")
	industry := c.Query("industry")
	page := parseIntQuery(c, "page", 1)
	pageSize := parseIntQuery(c, "page_size", 20)
	if pageSize > 100 {
		pageSize = 100
	}

	var total int64
	query := h.db.Model(&models.BetaApplication{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if industry != "" {
		query = query.Where("industry = ?", industry)
	}
	query.Count(&total)

	var apps []models.BetaApplication
	if err := query.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&apps).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":       apps,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": (int(total) + pageSize - 1) / pageSize,
	})
}

// ReviewApplicationRequest 审核申请请求
type ReviewApplicationRequest struct {
	Status     string `json:"status" binding:"required,oneof=approved rejected"`
	ReviewNote string `json:"review_note"`
	InviteCode string `json:"invite_code,omitempty"`
}

// ReviewApplication 审核内测申请（管理员）
func (h *BetaInviteHandler) ReviewApplication(c *gin.Context) {
	id := parseUintParam(c, "id")
	if id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	var req ReviewApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	adminID, _ := c.Get("userID")

	var app models.BetaApplication
	if err := h.db.First(&app, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "申请不存在"})
		return
	}

	if app.Status != "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": "该申请已审核过"})
		return
	}

	now := time.Now()
	updates := map[string]interface{}{
		"status":      req.Status,
		"review_note": req.ReviewNote,
		"admin_id":    adminID,
		"reviewed_at": &now,
	}

	if req.Status == "approved" && req.InviteCode != "" {
		var invite models.BetaInvite
		if err := h.db.Where("code = ? AND status = ?", req.InviteCode, "unused").First(&invite).Error; err == nil {
			// 发送激活码邮件（如果邮件服务已配置）
			if h.emailService != nil && h.emailService.IsEnabled() && app.Email != "" {
				frontendURL := "https://testnet.ai-space.xyz"
				go func() {
					if err := h.emailService.SendBetaInviteEmail(
						app.Email,
						app.Name,
						req.InviteCode,
						frontendURL,
					); err != nil {
						fmt.Printf("[Email] 发送激活码邮件失败: %v\n", err)
					}
				}()
			}
		}
	}

	if err := h.db.Model(&app).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "审核失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":      app.ID,
		"status":  req.Status,
		"message": "审核完成",
	})
}

// ========== 邀请码验证与使用 ==========

// VerifyInviteRequest 验证邀请码请求
type VerifyInviteRequest struct {
	Code string `json:"code" binding:"required"`
}

// VerifyInvite 验证邀请码
func (h *BetaInviteHandler) VerifyInvite(c *gin.Context) {
	var req VerifyInviteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	code := strings.ToUpper(strings.TrimSpace(req.Code))
	var invite models.BetaInvite
	if err := h.db.Where("code = ?", code).First(&invite).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "邀请码无效"})
		return
	}

	if invite.Status == "revoked" {
		c.JSON(http.StatusGone, gin.H{"error": "邀请码已被撤销"})
		return
	}
	if invite.Status == "used" {
		c.JSON(http.StatusConflict, gin.H{"error": "邀请码已被使用"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"valid":    true,
		"batch":    invite.Batch,
		"industry": invite.Industry,
		"credits": map[string]int{
			"basic":    invite.CreditsBasic,
			"advanced": invite.CreditsAdvanced,
			"elite":    invite.CreditsElite,
		},
	})
}

// UseInviteRequest 使用邀请码请求
type UseInviteRequest struct {
	Code string `json:"code" binding:"required"`
}

// UseInvite 使用邀请码激活账户
func (h *BetaInviteHandler) UseInvite(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}

	var req UseInviteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	code := strings.ToUpper(strings.TrimSpace(req.Code))
	var invite models.BetaInvite
	if err := h.db.Where("code = ?", code).First(&invite).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "邀请码无效"})
		return
	}

	if invite.Status != "unused" {
		c.JSON(http.StatusConflict, gin.H{"error": "邀请码已被使用或撤销"})
		return
	}

	uid := userID.(uint)
	now := time.Now()

	if err := h.db.Model(&invite).Updates(map[string]interface{}{
		"status":  "used",
		"user_id": uid,
		"used_at": &now,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "激活失败"})
		return
	}

	var user models.User
	if err := h.db.First(&user, uid).Error; err == nil {
		// 内测 Credit 使用独立钱包，不混入会员 basic/advanced/elite，也不修改 PlanTier。
		user.BetaBatch = invite.Batch
		user.BetaPhase = "phase_1" // 初始阶段：试探期
		user.BetaCreditBalance += invite.CreditsBasic
		user.BetaCreditGrantedTotal += invite.CreditsBasic
		user.BetaPhase1Used = false
		user.BetaPhase2Used = false
		user.BetaPhase3Used = false
		h.db.Save(&user)
	}

	// 记录邀请码使用事件（埋点）
	h.db.Create(&models.AnalyticsEvent{
		UserID:    uid,
		EventType: "invite_use",
		EventName: "invite_use",
		PagePath:  c.Request.URL.Path,
		Metadata:  fmt.Sprintf(`{"code":"%s","batch":"%s","credits_basic":%d}`, invite.Code, invite.Batch, invite.CreditsBasic),
	})

	phase2Credits := NewBetaConfigHandler(h.db).GetConfigInt(models.BetaConfigPhase2Credits, 15000)

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"message":    "激活成功",
		"phase":      "phase_1",
		"phase_name": "试探期",
		"credits_granted": map[string]int{
			"beta":     invite.CreditsBasic,
			"basic":    0,
			"advanced": 0,
			"elite":    0,
		},
		"beta_batch":                  invite.Batch,
		"beta_credit_balance":         invite.CreditsBasic,
		"beta_credit_balance_display": float64(invite.CreditsBasic) / 100.0,
		"next_phase": map[string]interface{}{
			"phase":            "phase_2",
			"phase_name":       "深水区",
			"unlock_condition": "提交 1 个有效 Bad Case 并通过审核",
			"credits":          float64(phase2Credits) / 100.0,
			"fen":              phase2Credits,
		},
	})
}

// GetApplicationStatus 查询申请状态（公开）
func (h *BetaInviteHandler) GetApplicationStatus(c *gin.Context) {
	email := strings.TrimSpace(c.Query("email"))
	if email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供邮箱"})
		return
	}

	var app models.BetaApplication
	if err := h.db.Where("email = ?", email).First(&app).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "未找到申请记录"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":          app.ID,
		"status":      app.Status,
		"invite_code": app.InviteCode,
		"review_note": app.ReviewNote,
		"created_at":  app.CreatedAt,
		"reviewed_at": app.ReviewedAt,
	})
}
