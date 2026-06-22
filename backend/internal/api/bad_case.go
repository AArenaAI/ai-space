package api

import (
	"encoding/json"
	"net/http"
	"time"

	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// BadCaseHandler 处理 Bad Case 提交与审核
type BadCaseHandler struct {
	db *gorm.DB
}

// NewBadCaseHandler 创建 BadCaseHandler
func NewBadCaseHandler(db *gorm.DB) *BadCaseHandler {
	return &BadCaseHandler{db: db}
}

// CreateBadCaseRequest 创建 Bad Case 请求
type CreateBadCaseRequest struct {
	ModelID            string `json:"model_id" binding:"required"`
	ModelName          string `json:"model_name"`
	BadCaseDescription string `json:"bad_case_description" binding:"required"`
	ExpectedAnswer     string `json:"expected_answer" binding:"required"`
	ConversationID     *uint  `json:"conversation_id,omitempty"`
	MessageID          *uint  `json:"message_id,omitempty"`
}

// CreateBadCase 用户提交 Bad Case
// @Summary 提交 Bad Case
// @Tags bad-cases
// @Accept json
// @Produce json
// @Param body body CreateBadCaseRequest true "Bad Case 内容"
// @Success 201 {object} map[string]interface{}
// @Router /api/bad-cases [post]
func (h *BadCaseHandler) CreateBadCase(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}

	var req CreateBadCaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	badCase := models.BadCase{
		UserID:             userID.(uint),
		ModelID:            req.ModelID,
		ModelName:          req.ModelName,
		BadCaseDescription: req.BadCaseDescription,
		ExpectedAnswer:     req.ExpectedAnswer,
		ConversationID:     req.ConversationID,
		MessageID:          req.MessageID,
		Status:             "pending",
	}

	if err := h.db.Create(&badCase).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "提交失败"})
		return
	}

	// 记录 Bad Case 提交事件（埋点）
	metadata, _ := json.Marshal(map[string]interface{}{
		"model_id":         req.ModelID,
		"has_conversation": req.ConversationID != nil,
	})
	h.db.Create(&models.AnalyticsEvent{
		UserID:    userID.(uint),
		EventType: "bad_case_submit",
		EventName: "bad_case_submit",
		PagePath:  c.Request.URL.Path,
		ModelID:   req.ModelID,
		Metadata:  string(metadata),
	})

	c.JSON(http.StatusCreated, gin.H{
		"id":      badCase.ID,
		"status":  badCase.Status,
		"message": "提交成功，后端团队将在 24-48 小时内审核",
	})
}

// ListBadCases 获取 Bad Case 列表（管理员）
// @Summary 获取 Bad Case 列表
// @Tags admin
// @Produce json
// @Param status query string false "状态筛选"
// @Param page query int false "页码"
// @Param page_size query int false "每页数量"
// @Success 200 {object} map[string]interface{}
// @Router /api/admin/bad-cases [get]
func (h *BadCaseHandler) ListBadCases(c *gin.Context) {
	status := c.Query("status")
	page := parseIntQuery(c, "page", 1)
	pageSize := parseIntQuery(c, "page_size", 20)
	if pageSize > 100 {
		pageSize = 100
	}

	var total int64
	query := h.db.Model(&models.BadCase{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	query.Count(&total)

	var cases []models.BadCase
	if err := query.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&cases).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	// 加载用户信息
	var enriched []gin.H
	for _, bc := range cases {
		var user models.User
		h.db.Select("id", "name", "email").First(&user, bc.UserID)
		enriched = append(enriched, gin.H{
			"id":                   bc.ID,
			"user_id":              bc.UserID,
			"user_name":            user.Name,
			"user_email":           user.Email,
			"model_id":             bc.ModelID,
			"model_name":           bc.ModelName,
			"bad_case_description": bc.BadCaseDescription,
			"expected_answer":      bc.ExpectedAnswer,
			"status":               bc.Status,
			"status_message":       bc.StatusMessage,
			"conversation_id":      bc.ConversationID,
			"message_id":           bc.MessageID,
			"created_at":           bc.CreatedAt,
			"updated_at":           bc.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"items":       enriched,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": (int(total) + pageSize - 1) / pageSize,
	})
}

// ReviewBadCaseRequest 审核请求
type ReviewBadCaseRequest struct {
	Status        string `json:"status" binding:"required,oneof=approved rejected fixed"`
	StatusMessage string `json:"status_message"`
	GrantCredits  *struct {
		Beta     int `json:"beta,omitempty"`
		Basic    int `json:"basic,omitempty"`    // legacy override compatibility
		Advanced int `json:"advanced,omitempty"` // legacy override compatibility
		Elite    int `json:"elite,omitempty"`    // legacy override compatibility
	} `json:"grant_credits,omitempty"`
}

// ReviewBadCase 审核 Bad Case
// @Summary 审核 Bad Case
// @Tags admin
// @Accept json
// @Produce json
// @Param id path int true "Bad Case ID"
// @Param body body ReviewBadCaseRequest true "审核内容"
// @Success 200 {object} map[string]interface{}
// @Router /api/admin/bad-cases/:id/review [patch]
func (h *BadCaseHandler) ReviewBadCase(c *gin.Context) {
	id := parseUintParam(c, "id")
	if id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	var req ReviewBadCaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	adminID, _ := c.Get("userID")

	var badCase models.BadCase
	if err := h.db.First(&badCase, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bad Case 不存在"})
		return
	}

	now := time.Now()
	updates := map[string]interface{}{
		"status":         req.Status,
		"status_message": req.StatusMessage,
		"admin_id":       adminID,
		"reviewed_at":    &now,
	}

	if err := h.db.Model(&badCase).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "审核失败"})
		return
	}

	// 审核通过后推进内测阶段，并按后台阶段配置默认发放下一阶段内测 Credit；管理员显式填写 grant_credits 时覆盖默认值。
	// 内测到期后不再发放新额度、不再推进阶段，只标记 Bad Case 审核结果。
	if req.Status == "approved" {
		betaExpired := NewBetaConfigHandler(h.db).IsBetaExpired()
		var user models.User
		if err := h.db.First(&user, badCase.UserID).Error; err == nil {
			if betaExpired {
				// 到期：只保存审核状态，不发额度、不推进阶段
				c.JSON(http.StatusOK, gin.H{
					"id":               badCase.ID,
					"status":           req.Status,
					"message":          "审核完成（内测已结束，不再发放新额度）",
					"phase_transition": false,
				})
				return
			}
			grantBeta := 0
			if req.GrantCredits != nil {
				grantBeta = req.GrantCredits.Beta
				// 兼容旧前端/接口：如果只传 basic，则视为 beta grant。
				if grantBeta == 0 {
					grantBeta = req.GrantCredits.Basic
				}
			} else {
				cfg := NewBetaConfigHandler(h.db)
				switch user.BetaPhase {
				case "phase_1":
					grantBeta = cfg.GetConfigInt(models.BetaConfigPhase2Credits, 15000)
				case "phase_2":
					grantBeta = cfg.GetConfigInt(models.BetaConfigPhase3Credits, 10000)
				}
			}
			if grantBeta > 0 {
				user.BetaCreditBalance += grantBeta
				user.BetaCreditGrantedTotal += grantBeta
			}
			// 推进内测阶段
			switch user.BetaPhase {
			case "phase_1":
				user.BetaPhase = "phase_2"
				user.BetaPhase1Used = true
			case "phase_2":
				user.BetaPhase = "phase_3"
				user.BetaPhase2Used = true
			case "phase_3", "completed":
				user.BetaPhase = "completed"
				user.BetaPhase3Used = true
			}
			h.db.Save(&user)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"id":               badCase.ID,
		"status":           req.Status,
		"message":          "审核完成",
		"phase_transition": req.Status == "approved",
	})
}

// GetMyBadCases 获取当前用户的 Bad Case 列表
// @Summary 获取我的 Bad Cases
// @Tags bad-cases
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Router /api/bad-cases [get]
func (h *BadCaseHandler) GetMyBadCases(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}

	var cases []models.BadCase
	if err := h.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&cases).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": cases})
}
