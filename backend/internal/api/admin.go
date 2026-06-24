package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"aipool-backend/internal/config"
	"aipool-backend/internal/modelconfigseed"
	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AdminHandler struct {
	db  *gorm.DB
	cfg *config.Config
}

func NewAdminHandler(db *gorm.DB, cfg ...*config.Config) *AdminHandler {
	var activeCfg *config.Config
	if len(cfg) > 0 {
		activeCfg = cfg[0]
	}
	h := &AdminHandler{db: db, cfg: activeCfg}
	h.ensureDefaultBillingPlans()
	return h
}

type adminUserUsageSummary struct {
	Requests       int64      `json:"requests"`
	Failures       int64      `json:"failures"`
	CostRMB        float64    `json:"cost_rmb"`
	TotalTokens    int64      `json:"total_tokens"`
	ImageCount     int64      `json:"image_count"`
	CharacterCount int64      `json:"character_count"`
	VideoSeconds   int64      `json:"video_seconds"`
	LastUsedAt     *time.Time `json:"last_used_at,omitempty"`
}

type adminUserCreditUsageSummary struct {
	BasicUsedFen    int        `json:"basic_used"`
	AdvancedUsedFen int        `json:"advanced_used"`
	BetaUsedFen     int        `json:"beta_used"`
	TotalUsedFen    int        `json:"total_used"`
	BasicUsed       float64    `json:"basic_used_display"`
	AdvancedUsed    float64    `json:"advanced_used_display"`
	BetaUsed        float64    `json:"beta_used_display"`
	TotalUsed       float64    `json:"total_used_display"`
	LastUsedAt      *time.Time `json:"last_used_at,omitempty"`
}

type adminUserResponse struct {
	ID                       uint                        `json:"id"`
	Email                    string                      `json:"email"`
	Name                     string                      `json:"name"`
	Role                     string                      `json:"role"`
	PlanTier                 string                      `json:"plan_tier"`
	BasicCredits             int                         `json:"basic_credits"`
	AdvancedCredits          int                         `json:"advanced_credits"`
	EliteCredits             int                         `json:"elite_credits"`
	BetaBatch                string                      `json:"beta_batch,omitempty"`
	BetaPhase                string                      `json:"beta_phase,omitempty"`
	BetaPhaseName            string                      `json:"beta_phase_name,omitempty"`
	BetaCreditBalance        int                         `json:"beta_credit_balance"`
	BetaCreditBalanceDisplay float64                     `json:"beta_credit_balance_display"`
	BetaCreditGrantedTotal   int                         `json:"beta_credit_granted_total"`
	BetaCreditGrantedDisplay float64                     `json:"beta_credit_granted_display"`
	BetaCreditUsedTotal      int                         `json:"beta_credit_used_total"`
	BetaCreditUsedDisplay    float64                     `json:"beta_credit_used_display"`
	CreatedAt                time.Time                   `json:"created_at"`
	UpdatedAt                time.Time                   `json:"updated_at"`
	Usage30D                 adminUserUsageSummary       `json:"usage_30d"`
	CreditUsage30D           adminUserCreditUsageSummary `json:"credit_usage_30d"`
}

type adminUsageSummaryResponse struct {
	Requests          int64              `json:"requests"`
	Failures          int64              `json:"failures"`
	Successes         int64              `json:"successes"`
	CostRMB           float64            `json:"cost_rmb"`
	PromptTokens      int64              `json:"prompt_tokens"`
	CompletionTokens  int64              `json:"completion_tokens"`
	TotalTokens       int64              `json:"total_tokens"`
	ImageCount        int64              `json:"image_count"`
	RangeStart        time.Time          `json:"range_start"`
	Daily             []adminUsageBucket `json:"daily"`
	TopModels         []gin.H            `json:"top_models"`
	ProviderBreakdown []gin.H            `json:"provider_breakdown"`
	ServiceBreakdown  []gin.H            `json:"service_breakdown"`
}

type adminUsageBucket struct {
	Date     string  `json:"date"`
	Requests int64   `json:"requests"`
	Failures int64   `json:"failures"`
	CostRMB  float64 `json:"cost_rmb"`
}

type adminModelResponse struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Provider     string   `json:"provider"`
	Description  string   `json:"description"`
	Color        string   `json:"color"`
	Category     string   `json:"category"`
	Tier         string   `json:"tier"`
	Modalities   []string `json:"modalities"`
	Capabilities []string `json:"capabilities"`
}

type adminTaskUsageSummary struct {
	Requests         int64      `json:"requests"`
	Failures         int64      `json:"failures"`
	CostRMB          float64    `json:"cost_rmb"`
	PromptTokens     int64      `json:"prompt_tokens"`
	CompletionTokens int64      `json:"completion_tokens"`
	TotalTokens      int64      `json:"total_tokens"`
	ImageCount       int64      `json:"image_count"`
	CharacterCount   int64      `json:"character_count"`
	VideoSeconds     int64      `json:"video_seconds"`
	AudioSeconds     int64      `json:"audio_seconds"`
	LastUsageAt      *time.Time `json:"last_usage_at,omitempty"`
}

type adminTaskResponse struct {
	ID                 uint                  `json:"id"`
	ResponseID         string                `json:"response_id"`
	UserID             uint                  `json:"user_id"`
	GuestID            string                `json:"guest_id"`
	ConversationID     uint                  `json:"conversation_id"`
	AssistantMessageID uint                  `json:"assistant_message_id"`
	Model              string                `json:"model"`
	Provider           string                `json:"provider"`
	Status             string                `json:"status"`
	ErrorMessage       string                `json:"error_message,omitempty"`
	Usage              adminTaskUsageSummary `json:"usage"`
	CostEstimate       adminTaskCostEstimate `json:"cost_estimate"`
	RecentUsageLogs    []models.APIUsageLog  `json:"recent_usage_logs,omitempty"`
	CreatedAt          time.Time             `json:"created_at"`
	UpdatedAt          time.Time             `json:"updated_at"`
	CompletedAt        *time.Time            `json:"completed_at,omitempty"`
}

type adminTaskCostEstimate struct {
	Available                 bool    `json:"available"`
	EstimatedPromptTokens     int     `json:"estimated_prompt_tokens"`
	EstimatedCompletionTokens int     `json:"estimated_completion_tokens"`
	EstimatedTotalTokens      int     `json:"estimated_total_tokens"`
	EstimatedInputCostRMB     float64 `json:"estimated_input_cost_rmb"`
	EstimatedOutputCostRMB    float64 `json:"estimated_output_cost_rmb"`
	EstimatedTotalCostRMB     float64 `json:"estimated_total_cost_rmb"`
	ActualTotalCostRMB        float64 `json:"actual_total_cost_rmb"`
	DeltaCostRMB              float64 `json:"delta_cost_rmb"`
	DeltaRate                 float64 `json:"delta_rate"`
	PricingUnit               string  `json:"pricing_unit"`
	InputUnitPriceRMB         float64 `json:"input_unit_price_rmb"`
	OutputUnitPriceRMB        float64 `json:"output_unit_price_rmb"`
	Method                    string  `json:"method"`
	Note                      string  `json:"note"`
}

type adminBillingPlanRequest struct {
	Code            string `json:"code" binding:"required"`
	Name            string `json:"name" binding:"required"`
	Description     string `json:"description"`
	PriceCents      int64  `json:"price_cents"`
	Currency        string `json:"currency"`
	Interval        string `json:"interval"`
	BasicCredits    int    `json:"basic_credits"`
	AdvancedCredits int    `json:"advanced_credits"`
	EliteCredits    int    `json:"elite_credits"`
	Enabled         *bool  `json:"enabled"`
	PublicVisible   *bool  `json:"public_visible"`
	SortOrder       int    `json:"sort_order"`
	Provider        string `json:"provider"`
	ProviderPriceID string `json:"provider_price_id"`
}

func toAdminUserResponse(user models.User) adminUserResponse {
	role := user.Role
	if role == "" {
		role = "user"
	}
	phaseName := ""
	switch user.BetaPhase {
	case "phase_1":
		phaseName = "试探期"
	case "phase_2":
		phaseName = "深水区"
	case "phase_3":
		phaseName = "枯竭期"
	case "completed":
		phaseName = "已完成"
	}
	return adminUserResponse{
		ID:                       user.ID,
		Email:                    user.Email,
		Name:                     user.Name,
		Role:                     role,
		PlanTier:                 user.PlanTier,
		BasicCredits:             user.BasicCredits,
		AdvancedCredits:          user.AdvancedCredits,
		EliteCredits:             user.EliteCredits,
		BetaBatch:                user.BetaBatch,
		BetaPhase:                user.BetaPhase,
		BetaPhaseName:            phaseName,
		BetaCreditBalance:        user.BetaCreditBalance,
		BetaCreditBalanceDisplay: float64(user.BetaCreditBalance) / 100,
		BetaCreditGrantedTotal:   user.BetaCreditGrantedTotal,
		BetaCreditGrantedDisplay: float64(user.BetaCreditGrantedTotal) / 100,
		BetaCreditUsedTotal:      user.BetaCreditUsedTotal,
		BetaCreditUsedDisplay:    float64(user.BetaCreditUsedTotal) / 100,
		CreatedAt:                user.CreatedAt,
		UpdatedAt:                user.UpdatedAt,
	}
}

func (h *AdminHandler) userUsageSummary(userID uint, start time.Time) adminUserUsageSummary {
	var out adminUserUsageSummary
	var lastUsed time.Time
	if err := h.db.Model(&models.APIUsageLog{}).Where("user_id = ? AND created_at >= ?", userID, start).Select("COUNT(*) AS requests, COALESCE(SUM(CASE WHEN status <> 'success' THEN 1 ELSE 0 END), 0) AS failures, COALESCE(SUM(total_cost_rmb), 0) AS cost_rmb, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(image_count), 0) AS image_count, COALESCE(SUM(character_count), 0) AS character_count, COALESCE(SUM(video_seconds), 0) AS video_seconds, MAX(created_at) AS last_used_at").Scan(&struct {
		Requests       *int64
		Failures       *int64
		CostRMB        *float64
		TotalTokens    *int64
		ImageCount     *int64
		CharacterCount *int64
		VideoSeconds   *int64
		LastUsedAt     *time.Time
	}{Requests: &out.Requests, Failures: &out.Failures, CostRMB: &out.CostRMB, TotalTokens: &out.TotalTokens, ImageCount: &out.ImageCount, CharacterCount: &out.CharacterCount, VideoSeconds: &out.VideoSeconds, LastUsedAt: &lastUsed}).Error; err == nil && !lastUsed.IsZero() {
		out.LastUsedAt = &lastUsed
	}

	return out
}

func (h *AdminHandler) userCreditUsageSummary(userID uint, start time.Time) adminUserCreditUsageSummary {
	var out adminUserCreditUsageSummary
	if h == nil || h.db == nil || userID == 0 {
		return out
	}
	var rows []struct {
		Tier string
		Used int
	}
	if err := h.db.Model(&models.CreditTransaction{}).
		Select("tier, COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS used").
		Where("user_id = ? AND type = ? AND created_at >= ?", userID, "deduct", start).
		Group("tier").Scan(&rows).Error; err == nil {
		for _, row := range rows {
			switch row.Tier {
			case "basic":
				out.BasicUsedFen = row.Used
			case "advanced":
				out.AdvancedUsedFen = row.Used
			case "beta":
				out.BetaUsedFen = row.Used
			}
		}
	}
	var lastUsed time.Time
	if err := h.db.Model(&models.CreditTransaction{}).
		Where("user_id = ? AND type = ? AND amount < 0 AND created_at >= ?", userID, "deduct", start).
		Select("MAX(created_at)").Scan(&lastUsed).Error; err == nil && !lastUsed.IsZero() {
		out.LastUsedAt = &lastUsed
	}
	out.TotalUsedFen = out.BasicUsedFen + out.AdvancedUsedFen + out.BetaUsedFen
	out.BasicUsed = float64(out.BasicUsedFen) / 100.0
	out.AdvancedUsed = float64(out.AdvancedUsedFen) / 100.0
	out.BetaUsed = float64(out.BetaUsedFen) / 100.0
	out.TotalUsed = float64(out.TotalUsedFen) / 100.0
	return out
}

func (h *AdminHandler) ListBillingPlans(c *gin.Context) {
	h.ensureDefaultBillingPlans()
	var plans []models.BillingPlan
	if err := h.db.Order("sort_order ASC, price_cents ASC, id ASC").Find(&plans).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询套餐失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"plans": plans})
}

func (h *AdminHandler) CreateBillingPlan(c *gin.Context) {
	var req adminBillingPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}
	plan := billingPlanFromRequest(req, nil)
	if plan.Currency == "" {
		plan.Currency = "CNY"
	}
	if plan.Interval == "" {
		plan.Interval = "monthly"
	}
	if err := h.db.Create(&plan).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建套餐失败"})
		return
	}
	h.audit(c, "admin.billing_plan.create", "billing_plan", strconv.FormatUint(uint64(plan.ID), 10), nil, plan)
	c.JSON(http.StatusOK, gin.H{"plan": plan})
}

func (h *AdminHandler) UpdateBillingPlan(c *gin.Context) {
	id := parsePositiveInt(c.Param("id"), 0)
	if id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "套餐 ID 无效"})
		return
	}
	var plan models.BillingPlan
	if err := h.db.First(&plan, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "套餐不存在"})
		return
	}
	before := plan
	var req adminBillingPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}
	updated := billingPlanFromRequest(req, &plan)
	if err := h.db.Model(&plan).Updates(map[string]any{
		"code":              updated.Code,
		"name":              updated.Name,
		"description":       updated.Description,
		"price_cents":       updated.PriceCents,
		"currency":          updated.Currency,
		"interval":          updated.Interval,
		"basic_credits":     updated.BasicCredits,
		"advanced_credits":  updated.AdvancedCredits,
		"elite_credits":     updated.EliteCredits,
		"enabled":           updated.Enabled,
		"public_visible":    updated.PublicVisible,
		"sort_order":        updated.SortOrder,
		"provider":          updated.Provider,
		"provider_price_id": updated.ProviderPriceID,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新套餐失败"})
		return
	}
	h.db.First(&plan, id)
	h.audit(c, "admin.billing_plan.update", "billing_plan", strconv.FormatUint(uint64(plan.ID), 10), before, plan)
	c.JSON(http.StatusOK, gin.H{"plan": plan})
}

func (h *AdminHandler) Me(c *gin.Context) {
	userIDValue, _ := c.Get("userID")
	userID, _ := userIDValue.(uint)
	var user models.User
	if err := h.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": toAdminUserResponse(user)})
}

func defaultBasicBillingPlan() models.BillingPlan {
	return models.BillingPlan{
		Code:            "basic",
		Name:            "基础版",
		Description:     "适合日常聊天、轻量办公与少量高级模型调用。",
		PriceCents:      14900,
		Currency:        "CNY",
		Interval:        "monthly",
		BasicCredits:    3600,
		AdvancedCredits: 200,
		EliteCredits:    0,
		Enabled:         true,
		PublicVisible:   true,
		SortOrder:       10,
		Provider:        "manual",
	}
}

func (h *AdminHandler) ensureDefaultBillingPlans() {
	if h == nil || h.db == nil {
		return
	}
	var existing models.BillingPlan
	if err := h.db.Where("code = ?", "basic").First(&existing).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			plan := defaultBasicBillingPlan()
			_ = h.db.Create(&plan).Error
		}
	}
}

func billingPlanFromRequest(req adminBillingPlanRequest, existing *models.BillingPlan) models.BillingPlan {
	plan := defaultBasicBillingPlan()
	if existing != nil {
		plan = *existing
	}
	plan.Code = strings.TrimSpace(req.Code)
	plan.Name = strings.TrimSpace(req.Name)
	plan.Description = strings.TrimSpace(req.Description)
	plan.PriceCents = req.PriceCents
	if strings.TrimSpace(req.Currency) != "" {
		plan.Currency = strings.ToUpper(strings.TrimSpace(req.Currency))
	}
	if strings.TrimSpace(req.Interval) != "" {
		plan.Interval = strings.TrimSpace(req.Interval)
	}
	plan.BasicCredits = req.BasicCredits
	plan.AdvancedCredits = req.AdvancedCredits
	plan.EliteCredits = req.EliteCredits
	if req.Enabled != nil {
		plan.Enabled = *req.Enabled
	}
	if req.PublicVisible != nil {
		plan.PublicVisible = *req.PublicVisible
	}
	plan.SortOrder = req.SortOrder
	plan.Provider = strings.TrimSpace(req.Provider)
	plan.ProviderPriceID = strings.TrimSpace(req.ProviderPriceID)
	return plan
}

func (h *AdminHandler) Overview(c *gin.Context) {
	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	var totalUsers int64
	var todayNewUsers int64
	var todayRequests int64
	var todayFailures int64
	var runningTasks int64
	var failedTasksToday int64
	var todayCost float64

	h.db.Model(&models.User{}).Count(&totalUsers)
	h.db.Model(&models.User{}).Where("created_at >= ?", startOfDay).Count(&todayNewUsers)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ?", startOfDay).Count(&todayRequests)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ? AND status <> ?", startOfDay, "success").Count(&todayFailures)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ?", startOfDay).Select("COALESCE(SUM(total_cost_rmb), 0)").Scan(&todayCost)
	h.db.Model(&models.AIBackgroundTask{}).Where("status IN ?", []string{"running", "pending", "streaming", "retrying"}).Count(&runningTasks)
	h.db.Model(&models.AIBackgroundTask{}).Where("created_at >= ? AND status = ?", startOfDay, "failed").Count(&failedTasksToday)

	topModels := h.topUsageModels(startOfDay, 5)

	// 内测运营数据
	var pendingApplications int64
	var todayApplications int64
	var activeInvites int64
	var totalInvites int64
	var pendingBadCases int64
	h.db.Model(&models.BetaApplication{}).Where("status = ?", "pending").Count(&pendingApplications)
	h.db.Model(&models.BetaApplication{}).Where("created_at >= ?", startOfDay).Count(&todayApplications)
	h.db.Model(&models.BetaInvite{}).Where("status = ?", "active").Count(&activeInvites)
	h.db.Model(&models.BetaInvite{}).Count(&totalInvites)
	h.db.Model(&models.BadCase{}).Where("status = ?", "pending").Count(&pendingBadCases)

	c.JSON(http.StatusOK, gin.H{
		"users":  gin.H{"total": totalUsers, "today_new": todayNewUsers},
		"usage":  gin.H{"today_requests": todayRequests, "today_cost_rmb": todayCost, "today_failures": todayFailures},
		"tasks":  gin.H{"running": runningTasks, "failed_today": failedTasksToday},
		"models": gin.H{"top_by_cost": topModels},
		"beta": gin.H{
			"pending_applications": pendingApplications,
			"today_applications":   todayApplications,
			"active_invites":       activeInvites,
			"total_invites":        totalInvites,
			"pending_bad_cases":    pendingBadCases,
		},
	})
}

func (h *AdminHandler) ListUsers(c *gin.Context) {
	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	q := strings.TrimSpace(c.Query("q"))

	query := h.db.Model(&models.User{})
	if q != "" {
		if id, err := strconv.Atoi(q); err == nil && id > 0 {
			query = query.Where("id = ? OR email ILIKE ? OR name ILIKE ?", id, "%"+q+"%", "%"+q+"%")
		} else {
			query = query.Where("email ILIKE ? OR name ILIKE ?", "%"+q+"%", "%"+q+"%")
		}
	}
	if role := strings.TrimSpace(c.Query("role")); role != "" {
		query = query.Where("role = ?", role)
	}
	if plan := strings.TrimSpace(c.Query("plan_tier")); plan != "" {
		query = query.Where("plan_tier = ?", plan)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户数量失败"})
		return
	}

	var users []models.User
	if err := query.Order("id ASC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户列表失败"})
		return
	}

	items := make([]adminUserResponse, 0, len(users))
	usageStart := time.Now().AddDate(0, 0, -30)
	for _, user := range users {
		item := toAdminUserResponse(user)
		item.Usage30D = h.userUsageSummary(user.ID, usageStart)
		item.CreditUsage30D = h.userCreditUsageSummary(user.ID, usageStart)
		items = append(items, item)
	}

	c.JSON(http.StatusOK, gin.H{"users": items, "total": total, "page": page, "page_size": pageSize})
}

func (h *AdminHandler) GetUser(c *gin.Context) {
	user, ok := h.findUserByParam(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": toAdminUserResponse(user)})
}

type adminUpdateUserRequest struct {
	Name            *string `json:"name"`
	Role            *string `json:"role"`
	PlanTier        *string `json:"plan_tier"`
	BasicCredits    *int    `json:"basic_credits"`
	AdvancedCredits *int    `json:"advanced_credits"`
	EliteCredits    *int    `json:"elite_credits"`
}

func (h *AdminHandler) UpdateUser(c *gin.Context) {
	user, ok := h.findUserByParam(c)
	if !ok {
		return
	}
	before := toAdminUserResponse(user)
	var req adminUpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}
	updates := map[string]any{}
	if req.Name != nil {
		updates["name"] = strings.TrimSpace(*req.Name)
	}
	if req.Role != nil {
		role := strings.TrimSpace(*req.Role)
		if role != "user" && role != "admin" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "角色只能是 user 或 admin"})
			return
		}
		updates["role"] = role
	}
	if req.PlanTier != nil {
		plan := strings.TrimSpace(*req.PlanTier)
		if plan == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "套餐不能为空"})
			return
		}
		updates["plan_tier"] = plan
	}
	if req.BasicCredits != nil {
		updates["basic_credits"] = *req.BasicCredits
	}
	if req.AdvancedCredits != nil {
		updates["advanced_credits"] = *req.AdvancedCredits
	}
	if req.EliteCredits != nil {
		updates["elite_credits"] = *req.EliteCredits
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "没有可更新的字段"})
		return
	}
	if err := h.db.Model(&user).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新用户失败"})
		return
	}
	h.db.First(&user, user.ID)
	after := toAdminUserResponse(user)
	h.audit(c, "admin.user.update", "user", strconv.FormatUint(uint64(user.ID), 10), before, after)
	c.JSON(http.StatusOK, gin.H{"user": after})
}

type adminAdjustCreditsRequest struct {
	Tier   string `json:"tier" binding:"required"`
	Amount int    `json:"amount" binding:"required"`
	Mode   string `json:"mode"`
	Reason string `json:"reason"`
}

func (h *AdminHandler) AdjustCredits(c *gin.Context) {
	user, ok := h.findUserByParam(c)
	if !ok {
		return
	}
	before := toAdminUserResponse(user)
	var req adminAdjustCreditsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}
	mode := req.Mode
	if mode == "" {
		mode = "add"
	}
	field := ""
	switch req.Tier {
	case "basic":
		field = "basic_credits"
	case "advanced":
		field = "advanced_credits"
	case "beta":
		field = "beta_credit_balance"
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "积分类型只能是 basic / advanced / beta"})
		return
	}

	current := map[string]int{"basic_credits": user.BasicCredits, "advanced_credits": user.AdvancedCredits, "beta_credit_balance": user.BetaCreditBalance}[field]
	newValue := current
	switch mode {
	case "add":
		newValue = current + req.Amount
	case "set":
		newValue = req.Amount
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "调整模式只能是 add 或 set"})
		return
	}
	if newValue < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "积分不能小于 0"})
		return
	}

	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		reason = "admin_adjust"
	}
	operatorID := currentAdminID(c)
	err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&user).Update(field, newValue).Error; err != nil {
			return err
		}
		return tx.Create(&models.CreditTransaction{
			UserID:       user.ID,
			Type:         "adjust",
			Tier:         req.Tier,
			Amount:       newValue - current,
			BalanceAfter: newValue,
			Reason:       reason,
			SourceType:   "admin",
			SourceID:     strconv.FormatUint(uint64(operatorID), 10),
			OperatorID:   operatorID,
		}).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "调整积分失败"})
		return
	}
	h.db.First(&user, user.ID)
	after := toAdminUserResponse(user)
	h.audit(c, "admin.user.credits.adjust", "user", strconv.FormatUint(uint64(user.ID), 10), before, after)
	c.JSON(http.StatusOK, gin.H{"user": after})
}

func (h *AdminHandler) UsageSummary(c *gin.Context) {
	start := parseRangeStart(c.Query("range"))
	var summary adminUsageSummaryResponse
	summary.RangeStart = start
	summary.Daily = []adminUsageBucket{}
	summary.TopModels = []gin.H{}
	summary.ProviderBreakdown = []gin.H{}
	summary.ServiceBreakdown = []gin.H{}

	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ?", start).Count(&summary.Requests)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ? AND status <> ?", start, "success").Count(&summary.Failures)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ? AND status = ?", start, "success").Count(&summary.Successes)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ?", start).Select("COALESCE(SUM(total_cost_rmb), 0)").Scan(&summary.CostRMB)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ?", start).Select("COALESCE(SUM(prompt_tokens), 0)").Scan(&summary.PromptTokens)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ?", start).Select("COALESCE(SUM(completion_tokens), 0)").Scan(&summary.CompletionTokens)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ?", start).Select("COALESCE(SUM(total_tokens), 0)").Scan(&summary.TotalTokens)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ?", start).Select("COALESCE(SUM(image_count), 0)").Scan(&summary.ImageCount)

	summary.Daily = h.dailyUsage(start)
	summary.TopModels = h.topUsageModels(start, 10)
	summary.ProviderBreakdown = h.usageBreakdown(start, "provider", 12)
	summary.ServiceBreakdown = h.usageBreakdown(start, "service", 12)
	c.JSON(http.StatusOK, summary)
}

func (h *AdminHandler) UsageLogs(c *gin.Context) {
	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), 50)
	if pageSize > 200 {
		pageSize = 200
	}
	var total int64
	if err := h.usageQuery(c).Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "统计用量日志失败"})
		return
	}
	summary := h.usageAggregate(h.usageQuery(c))
	var logs []models.APIUsageLog
	sortColumn := usageSortColumn(c.Query("sort"))
	order := "DESC"
	if strings.EqualFold(strings.TrimSpace(c.Query("order")), "asc") {
		order = "ASC"
	}
	if err := h.usageQuery(c).Order(sortColumn + " " + order).Limit(pageSize).Offset((page - 1) * pageSize).Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用量日志失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"logs": logs, "total": total, "page": page, "page_size": pageSize, "summary": summary})
}

func (h *AdminHandler) UsageUsers(c *gin.Context) {
	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	query := h.usageQuery(c)
	items := []gin.H{}
	rows, err := query.
		Select("api_usage_logs.user_id, COALESCE(users.email, '') AS email, COALESCE(users.name, '') AS name, COUNT(*) AS requests, COALESCE(SUM(api_usage_logs.total_cost_rmb), 0) AS cost_rmb, COALESCE(SUM(api_usage_logs.total_tokens), 0) AS total_tokens, COALESCE(SUM(api_usage_logs.image_count), 0) AS image_count, MAX(api_usage_logs.created_at) AS last_used_at").
		Joins("LEFT JOIN users ON users.id = api_usage_logs.user_id").
		Group("api_usage_logs.user_id, users.email, users.name").
		Order("cost_rmb DESC").
		Limit(pageSize).Offset((page - 1) * pageSize).Rows()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户用量失败"})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var userID uint
		var email, name string
		var requests, tokens, images int64
		var cost float64
		var lastUsed time.Time
		if err := rows.Scan(&userID, &email, &name, &requests, &cost, &tokens, &images, &lastUsed); err == nil {
			services := h.usageGrouped(c, "service", 8, "user_id = ?", userID)
			items = append(items, gin.H{"user_id": userID, "email": email, "name": name, "requests": requests, "cost_rmb": cost, "total_tokens": tokens, "image_count": images, "last_used_at": lastUsed, "services": services})
		}
	}
	c.JSON(http.StatusOK, gin.H{"users": items, "page": page, "page_size": pageSize})
}

func (h *AdminHandler) UsageUserDetail(c *gin.Context) {
	userID := parsePositiveInt(c.Param("id"), 0)
	if userID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "用户 ID 无效"})
		return
	}
	var user models.User
	if err := h.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}
	base := h.usageQuery(c).Where("user_id = ?", userID)
	c.JSON(http.StatusOK, gin.H{
		"user":          toAdminUserResponse(user),
		"summary":       h.usageAggregate(base),
		"services":      h.usageGrouped(c, "service", 20, "user_id = ?", userID),
		"models":        h.usageModelRows(c, 50, "user_id = ?", userID),
		"conversations": h.usageConversationRows(c, 20, "api_usage_logs.user_id = ?", userID),
	})
}

func (h *AdminHandler) UsageModels(c *gin.Context) {
	limit := parsePositiveInt(c.Query("limit"), 100)
	if limit > 300 {
		limit = 300
	}
	c.JSON(http.StatusOK, gin.H{"models": h.usageModelRows(c, limit)})
}

func (h *AdminHandler) UsageModules(c *gin.Context) {
	limit := parsePositiveInt(c.Query("limit"), 120)
	if limit > 300 {
		limit = 300
	}
	items := []gin.H{}
	rows, err := h.usageQuery(c).
		Select("COALESCE(module, '') AS module, COALESCE(feature, '') AS feature, COALESCE(operation, '') AS operation, COALESCE(service, '') AS service, COUNT(*) AS requests, COALESCE(SUM(CASE WHEN status <> 'success' THEN 1 ELSE 0 END), 0) AS failures, COALESCE(SUM(total_cost_rmb), 0) AS cost_rmb, COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(image_count), 0) AS image_count, COALESCE(SUM(character_count), 0) AS character_count, COALESCE(SUM(video_seconds), 0) AS video_seconds, MAX(created_at) AS last_used_at").
		Group("module, feature, operation, service").
		Order("cost_rmb DESC").
		Limit(limit).
		Rows()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询产品模块用量失败"})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var module, feature, operation, service string
		var requests, failures, prompt, completion, tokens, images, characters, videoSeconds int64
		var cost float64
		var lastUsed time.Time
		if err := rows.Scan(&module, &feature, &operation, &service, &requests, &failures, &cost, &prompt, &completion, &tokens, &images, &characters, &videoSeconds, &lastUsed); err == nil {
			items = append(items, gin.H{"module": module, "feature": feature, "operation": operation, "service": service, "requests": requests, "failures": failures, "cost_rmb": cost, "prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": tokens, "image_count": images, "character_count": characters, "video_seconds": videoSeconds, "last_used_at": lastUsed})
		}
	}
	c.JSON(http.StatusOK, gin.H{"modules": items})
}

func (h *AdminHandler) UsageConversations(c *gin.Context) {
	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	items := h.usageConversationRows(c, pageSize, "", nil, (page-1)*pageSize)
	c.JSON(http.StatusOK, gin.H{"conversations": items, "page": page, "page_size": pageSize})
}

func (h *AdminHandler) UsageConversationDetail(c *gin.Context) {
	conversationID := parsePositiveInt(c.Param("id"), 0)
	if conversationID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "对话 ID 无效"})
		return
	}
	var conversation models.Conversation
	if err := h.db.First(&conversation, conversationID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "对话不存在"})
		return
	}
	base := h.usageQuery(c).Where("conversation_id = ?", conversationID)
	var logs []models.APIUsageLog
	base.Order("created_at DESC").Limit(100).Find(&logs)
	c.JSON(http.StatusOK, gin.H{
		"conversation": conversation,
		"summary":      h.usageAggregate(base),
		"models":       h.usageModelRows(c, 50, "conversation_id = ?", conversationID),
		"logs":         logs,
	})
}

func (h *AdminHandler) Models(c *gin.Context) {
	items := make([]adminModelResponse, 0)
	for _, model := range modelmeta.AllModels() {
		modalities := []string{}
		caps := []string{}
		for _, cap := range model.Capabilities {
			if cap == "search" {
				caps = append(caps, "native_search")
			} else {
				caps = append(caps, cap)
			}
			if cap == "chat" || cap == "image" || cap == "video" || cap == "document" {
				modalities = appendIfMissing(modalities, cap)
			}
		}
		if len(modalities) == 0 {
			modalities = []string{"chat"}
		}
		if len(model.SupportedFileExtensions) > 0 || containsString(model.SupportedInputs, "pdf") || containsString(model.SupportedInputs, "word") {
			caps = appendIfMissing(caps, "file")
		}
		items = append(items, adminModelResponse{
			ID:           model.ID,
			Name:         model.Name,
			Provider:     model.Provider,
			Description:  model.Description,
			Color:        model.Color,
			Category:     firstCapability(model.Capabilities),
			Tier:         GetModelTier(model.ID),
			Modalities:   modalities,
			Capabilities: caps,
		})
	}
	c.JSON(http.StatusOK, gin.H{"models": items, "total": len(items)})
}

// ========== Model Config Management ==========

type adminModelConfigResponse struct {
	ID                     uint     `json:"id"`
	ModelID                string   `json:"model_id"`
	Name                   string   `json:"name"`
	Provider               string   `json:"provider"`
	Description            string   `json:"description"`
	Color                  string   `json:"color"`
	Category               string   `json:"category"`
	Capabilities           []string `json:"capabilities"`
	Enabled                bool     `json:"enabled"`
	Tier                   string   `json:"tier"`
	ReasoningLevel         string   `json:"reasoning_level"`
	ReasoningLevelName     string   `json:"reasoning_level_name"`
	ReasoningEffort        string   `json:"reasoning_effort"`
	ReasoningParameter     string   `json:"reasoning_parameter"`
	ReasoningFastValue     string   `json:"reasoning_fast_value"`
	ReasoningThinkingValue string   `json:"reasoning_thinking_value"`
	ReasoningExpertValue   string   `json:"reasoning_expert_value"`
	Status                 string   `json:"status"`
	StatusMessage          string   `json:"status_message"`
	CreatedAt              string   `json:"created_at"`
	UpdatedAt              string   `json:"updated_at"`
}

func defaultModelReasoningLevel(model modelmeta.ModelInfo) string {
	if !modelmeta.ModelHasCapability(model, "reasoning") {
		return ""
	}
	return services.ReasoningLevelThinking
}

func reasoningLevelForAdmin(model modelmeta.ModelInfo, cfg models.ModelConfig) (string, string, string, string, string, string, string) {
	if !modelmeta.ModelHasCapability(model, "reasoning") {
		return "", "", "", "", "", "", ""
	}
	publicLevel := services.NormalizeReasoningLevel(cfg.ReasoningLevel)
	overrides := services.ReasoningEffortOverrides{
		Fast:     cfg.ReasoningFastValue,
		Thinking: cfg.ReasoningThinkingValue,
		Expert:   cfg.ReasoningExpertValue,
	}
	effort := services.ReasoningEffortForPublicLevelWithOverrides(publicLevel, overrides)
	fastValue, thinkingValue, expertValue := services.EffectiveReasoningOverrideValuesForModel(model.ID, overrides)
	return publicLevel, services.ReasoningLevelName(publicLevel), effort.String(), services.ReasoningParameterName(model.ID), fastValue, thinkingValue, expertValue
}

func ensureModelConfigRows(db *gorm.DB, codeModels []modelmeta.ModelInfo) error {
	return modelconfigseed.EnsureRows(db, codeModels)
}

func (h *AdminHandler) ListModelConfigs(c *gin.Context) {
	// 加载所有代码模型
	codeModels := modelmeta.AllModels()
	if err := ensureModelConfigRows(h.db, codeModels); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "初始化模型配置失败"})
		return
	}

	// 加载数据库配置
	var configs []models.ModelConfig
	h.db.Find(&configs)
	configMap := make(map[string]*models.ModelConfig, len(configs))
	for i := range configs {
		configMap[configs[i].ModelID] = &configs[i]
	}

	items := make([]adminModelConfigResponse, 0, len(codeModels))
	for _, model := range codeModels {
		cfg, ok := configMap[model.ID]
		if !ok {
			// 未配置时，使用代码默认值
			reasoningLevel, reasoningLevelName, reasoningEffort, reasoningParameter, reasoningFastValue, reasoningThinkingValue, reasoningExpertValue := reasoningLevelForAdmin(model, models.ModelConfig{ReasoningLevel: defaultModelReasoningLevel(model)})
			items = append(items, adminModelConfigResponse{
				ID:                     0,
				ModelID:                model.ID,
				Name:                   model.Name,
				Provider:               model.Provider,
				Description:            model.Description,
				Color:                  model.Color,
				Category:               firstCapability(model.Capabilities),
				Capabilities:           model.Capabilities,
				Enabled:                true,
				Tier:                   GetModelTier(model.ID),
				ReasoningLevel:         reasoningLevel,
				ReasoningLevelName:     reasoningLevelName,
				ReasoningEffort:        reasoningEffort,
				ReasoningParameter:     reasoningParameter,
				ReasoningFastValue:     reasoningFastValue,
				ReasoningThinkingValue: reasoningThinkingValue,
				ReasoningExpertValue:   reasoningExpertValue,
				Status:                 "available",
				StatusMessage:          "",
			})
			continue
		}

		// 有配置时，合并数据库覆盖
		status := cfg.Status
		if status == "" {
			status = "available"
		}
		reasoningLevel, reasoningLevelName, reasoningEffort, reasoningParameter, reasoningFastValue, reasoningThinkingValue, reasoningExpertValue := reasoningLevelForAdmin(model, *cfg)
		items = append(items, adminModelConfigResponse{
			ID:                     cfg.ID,
			ModelID:                model.ID,
			Name:                   model.Name,
			Provider:               model.Provider,
			Description:            model.Description,
			Color:                  model.Color,
			Category:               firstCapability(model.Capabilities),
			Capabilities:           model.Capabilities,
			Enabled:                cfg.Enabled,
			Tier:                   normalizeModelTier(cfg.Tier, model.ID),
			ReasoningLevel:         reasoningLevel,
			ReasoningLevelName:     reasoningLevelName,
			ReasoningEffort:        reasoningEffort,
			ReasoningParameter:     reasoningParameter,
			ReasoningFastValue:     reasoningFastValue,
			ReasoningThinkingValue: reasoningThinkingValue,
			ReasoningExpertValue:   reasoningExpertValue,
			Status:                 status,
			StatusMessage:          cfg.StatusMsg,
			CreatedAt:              cfg.CreatedAt.Format(time.RFC3339),
			UpdatedAt:              cfg.UpdatedAt.Format(time.RFC3339),
		})
	}

	c.JSON(http.StatusOK, gin.H{"models": items, "total": len(items)})
}

type adminUpdateModelConfigRequest struct {
	Enabled                *bool   `json:"enabled,omitempty"`
	Tier                   *string `json:"tier,omitempty"`
	ReasoningLevel         *string `json:"reasoning_level,omitempty"`
	ReasoningFastValue     *string `json:"reasoning_fast_value,omitempty"`
	ReasoningThinkingValue *string `json:"reasoning_thinking_value,omitempty"`
	ReasoningExpertValue   *string `json:"reasoning_expert_value,omitempty"`
	Status                 *string `json:"status,omitempty"`
	StatusMessage          *string `json:"status_message,omitempty"`
}

func (h *AdminHandler) UpdateModelConfig(c *gin.Context) {
	modelID := strings.TrimSpace(c.Param("id"))
	if modelID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "模型 ID 不能为空"})
		return
	}

	// 验证模型存在于代码中
	found := false
	for _, m := range modelmeta.AllModels() {
		if m.ID == modelID {
			found = true
			break
		}
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "模型不存在"})
		return
	}

	var req adminUpdateModelConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	updates := map[string]any{}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if req.Tier != nil {
		tier := strings.TrimSpace(*req.Tier)
		if tier != "" && tier != "basic" && tier != "advanced" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tier 只能是 basic / advanced"})
			return
		}
		updates["tier"] = tier
	}
	if req.ReasoningLevel != nil {
		level := services.NormalizeReasoningLevel(*req.ReasoningLevel)
		updates["reasoning_level"] = level
	}
	if req.ReasoningFastValue != nil {
		updates["reasoning_fast_value"] = strings.TrimSpace(*req.ReasoningFastValue)
	}
	if req.ReasoningThinkingValue != nil {
		updates["reasoning_thinking_value"] = strings.TrimSpace(*req.ReasoningThinkingValue)
	}
	if req.ReasoningExpertValue != nil {
		updates["reasoning_expert_value"] = strings.TrimSpace(*req.ReasoningExpertValue)
	}
	if req.Status != nil {
		status := strings.TrimSpace(*req.Status)
		if status != "" && status != "available" && status != "disabled" && status != "maintenance" && status != "quota_exhausted" && status != "rate_limited" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "status 无效"})
			return
		}
		updates["status"] = status
	}
	if req.StatusMessage != nil {
		updates["status_msg"] = strings.TrimSpace(*req.StatusMessage)
	}

	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "没有可更新的字段"})
		return
	}

	// upsert
	var cfg models.ModelConfig
	if err := h.db.Where("model_id = ?", modelID).First(&cfg).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			cfg = models.ModelConfig{ModelID: modelID, Enabled: true}
			if v, ok := updates["enabled"]; ok {
				cfg.Enabled = v.(bool)
			}
			if v, ok := updates["tier"]; ok {
				cfg.Tier = v.(string)
			}
			if v, ok := updates["reasoning_level"]; ok {
				cfg.ReasoningLevel = v.(string)
			} else {
				cfg.ReasoningLevel = services.ReasoningLevelThinking
			}
			if v, ok := updates["reasoning_fast_value"]; ok {
				cfg.ReasoningFastValue = v.(string)
			}
			if v, ok := updates["reasoning_thinking_value"]; ok {
				cfg.ReasoningThinkingValue = v.(string)
			}
			if v, ok := updates["reasoning_expert_value"]; ok {
				cfg.ReasoningExpertValue = v.(string)
			}
			if v, ok := updates["status"]; ok {
				cfg.Status = v.(string)
			}
			if v, ok := updates["status_msg"]; ok {
				cfg.StatusMsg = v.(string)
			}
			if err := h.db.Create(&cfg).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "创建模型配置失败"})
				return
			}
			if err := modelconfigseed.SyncDBToFile(h.db, modelmeta.AllModels()); err != nil {
				c.JSON(http.StatusOK, gin.H{"config": cfg, "config_file_warning": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"config": cfg})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询模型配置失败"})
		return
	}

	if err := h.db.Model(&cfg).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新模型配置失败"})
		return
	}
	if err := h.db.Where("model_id = ?", modelID).First(&cfg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取更新后的模型配置失败"})
		return
	}
	if err := modelconfigseed.SyncDBToFile(h.db, modelmeta.AllModels()); err != nil {
		c.JSON(http.StatusOK, gin.H{"config": cfg, "config_file_warning": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"config": cfg})
}

type adminBatchModelConfigItem struct {
	ModelID                string  `json:"model_id" binding:"required"`
	Enabled                *bool   `json:"enabled,omitempty"`
	Tier                   *string `json:"tier,omitempty"`
	ReasoningLevel         *string `json:"reasoning_level,omitempty"`
	ReasoningFastValue     *string `json:"reasoning_fast_value,omitempty"`
	ReasoningThinkingValue *string `json:"reasoning_thinking_value,omitempty"`
	ReasoningExpertValue   *string `json:"reasoning_expert_value,omitempty"`
	Status                 *string `json:"status,omitempty"`
	StatusMessage          *string `json:"status_message,omitempty"`
}

func (h *AdminHandler) BatchUpdateModelConfigs(c *gin.Context) {
	var req []adminBatchModelConfigItem
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if len(req) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "更新列表不能为空"})
		return
	}

	if err := h.db.Transaction(func(tx *gorm.DB) error {
		for _, item := range req {
			updates := map[string]any{}
			if item.Enabled != nil {
				updates["enabled"] = *item.Enabled
			}
			if item.Tier != nil {
				tier := strings.TrimSpace(*item.Tier)
				if tier != "" && tier != "basic" && tier != "advanced" {
					continue
				}
				updates["tier"] = tier
			}
			if item.ReasoningLevel != nil {
				updates["reasoning_level"] = services.NormalizeReasoningLevel(*item.ReasoningLevel)
			}
			if item.ReasoningFastValue != nil {
				updates["reasoning_fast_value"] = strings.TrimSpace(*item.ReasoningFastValue)
			}
			if item.ReasoningThinkingValue != nil {
				updates["reasoning_thinking_value"] = strings.TrimSpace(*item.ReasoningThinkingValue)
			}
			if item.ReasoningExpertValue != nil {
				updates["reasoning_expert_value"] = strings.TrimSpace(*item.ReasoningExpertValue)
			}
			if item.Status != nil {
				status := strings.TrimSpace(*item.Status)
				if status != "" && status != "available" && status != "disabled" && status != "maintenance" && status != "quota_exhausted" && status != "rate_limited" {
					continue
				}
				updates["status"] = status
			}
			if item.StatusMessage != nil {
				updates["status_msg"] = strings.TrimSpace(*item.StatusMessage)
			}
			if len(updates) == 0 {
				continue
			}

			var cfg models.ModelConfig
			if err := tx.Where("model_id = ?", item.ModelID).First(&cfg).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					cfg = models.ModelConfig{ModelID: item.ModelID, Enabled: true}
					if v, ok := updates["enabled"]; ok {
						cfg.Enabled = v.(bool)
					}
					if v, ok := updates["tier"]; ok {
						cfg.Tier = v.(string)
					}
					if v, ok := updates["reasoning_level"]; ok {
						cfg.ReasoningLevel = v.(string)
					} else {
						cfg.ReasoningLevel = services.ReasoningLevelThinking
					}
					if v, ok := updates["reasoning_fast_value"]; ok {
						cfg.ReasoningFastValue = v.(string)
					}
					if v, ok := updates["reasoning_thinking_value"]; ok {
						cfg.ReasoningThinkingValue = v.(string)
					}
					if v, ok := updates["reasoning_expert_value"]; ok {
						cfg.ReasoningExpertValue = v.(string)
					}
					if v, ok := updates["status"]; ok {
						cfg.Status = v.(string)
					}
					if v, ok := updates["status_msg"]; ok {
						cfg.StatusMsg = v.(string)
					}
					if err := tx.Create(&cfg).Error; err != nil {
						return err
					}
					continue
				}
				return err
			}
			if err := tx.Model(&cfg).Updates(updates).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "批量更新模型配置失败"})
		return
	}

	if err := modelconfigseed.SyncDBToFile(h.db, modelmeta.AllModels()); err != nil {
		c.JSON(http.StatusOK, gin.H{"updated": len(req), "config_file_warning": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"updated": len(req)})
}

func (h *AdminHandler) Tasks(c *gin.Context) {
	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	query := h.db.Model(&models.AIBackgroundTask{})
	if status := strings.TrimSpace(c.Query("status")); status != "" && !strings.EqualFold(status, "all") {
		query = query.Where("status = ?", status)
	}
	if provider := strings.TrimSpace(c.Query("provider")); provider != "" {
		query = query.Where("provider = ?", provider)
	}
	if model := strings.TrimSpace(c.Query("model")); model != "" {
		query = query.Where("model = ?", model)
	}
	if uid := parsePositiveInt(c.Query("user_id"), 0); uid > 0 {
		query = query.Where("user_id = ?", uid)
	}
	if requestID := strings.TrimSpace(c.Query("request_id")); requestID != "" {
		query = query.Where("response_id = ?", requestID)
	}
	var total int64
	query.Count(&total)
	var tasks []models.AIBackgroundTask
	if err := query.Order("created_at DESC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&tasks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询任务失败"})
		return
	}
	usageByTask, recentLogsByTask := h.taskUsageBatch(tasks)
	items := make([]adminTaskResponse, 0, len(tasks))
	for _, task := range tasks {
		usage := usageByTask[task.ID]
		items = append(items, adminTaskResponse{
			ID:                 task.ID,
			ResponseID:         task.ResponseID,
			UserID:             task.UserID,
			GuestID:            task.GuestID,
			ConversationID:     task.ConversationID,
			AssistantMessageID: task.AssistantMessageID,
			Model:              task.Model,
			Provider:           task.Provider,
			Status:             task.Status,
			ErrorMessage:       task.ErrorMessage,
			Usage:              usage,
			CostEstimate:       h.estimateTaskCost(task, usage),
			RecentUsageLogs:    recentLogsByTask[task.ID],
			CreatedAt:          task.CreatedAt,
			UpdatedAt:          task.UpdatedAt,
			CompletedAt:        task.CompletedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"tasks":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
		"summary":   h.taskSummary(),
	})
}

func (h *AdminHandler) taskUsageBatch(tasks []models.AIBackgroundTask) (map[uint]adminTaskUsageSummary, map[uint][]models.APIUsageLog) {
	usageByTask := make(map[uint]adminTaskUsageSummary, len(tasks))
	recentLogsByTask := make(map[uint][]models.APIUsageLog, len(tasks))
	if len(tasks) == 0 {
		return usageByTask, recentLogsByTask
	}

	taskIDs := make([]uint, 0, len(tasks))
	responseIDs := make([]string, 0, len(tasks))
	messageIDs := make([]uint, 0, len(tasks))
	byResponseID := map[string][]uint{}
	byMessageID := map[uint][]uint{}
	for _, task := range tasks {
		taskIDs = append(taskIDs, task.ID)
		if task.ResponseID != "" {
			responseIDs = append(responseIDs, task.ResponseID)
			byResponseID[task.ResponseID] = append(byResponseID[task.ResponseID], task.ID)
		}
		if task.AssistantMessageID > 0 {
			messageIDs = append(messageIDs, task.AssistantMessageID)
			byMessageID[task.AssistantMessageID] = append(byMessageID[task.AssistantMessageID], task.ID)
		}
	}

	query := h.db.Model(&models.APIUsageLog{})
	clauses := []string{"task_id IN ?"}
	args := []any{taskIDs}
	if len(responseIDs) > 0 {
		clauses = append(clauses, "request_id IN ?")
		args = append(args, responseIDs)
	}
	if len(messageIDs) > 0 {
		clauses = append(clauses, "message_id IN ?")
		args = append(args, messageIDs)
	}
	var logs []models.APIUsageLog
	if err := query.Where("("+strings.Join(clauses, " OR ")+")", args...).Order("created_at DESC").Find(&logs).Error; err != nil {
		return usageByTask, recentLogsByTask
	}

	seenByTask := make(map[uint]map[uint]bool, len(tasks))
	for _, log := range logs {
		matchedTaskIDs := make([]uint, 0, 3)
		if log.TaskID > 0 {
			matchedTaskIDs = append(matchedTaskIDs, log.TaskID)
		}
		if log.RequestID != "" {
			matchedTaskIDs = append(matchedTaskIDs, byResponseID[log.RequestID]...)
		}
		if log.MessageID > 0 {
			matchedTaskIDs = append(matchedTaskIDs, byMessageID[log.MessageID]...)
		}
		for _, taskID := range matchedTaskIDs {
			if seenByTask[taskID] == nil {
				seenByTask[taskID] = map[uint]bool{}
			}
			if seenByTask[taskID][log.ID] {
				continue
			}
			seenByTask[taskID][log.ID] = true
			summary := usageByTask[taskID]
			summary.Requests++
			if log.Status != "success" {
				summary.Failures++
			}
			summary.CostRMB += log.TotalCostRMB
			summary.PromptTokens += int64(log.PromptTokens)
			summary.CompletionTokens += int64(log.CompletionTokens)
			summary.TotalTokens += int64(log.TotalTokens)
			summary.ImageCount += int64(log.ImageCount)
			summary.CharacterCount += int64(log.CharacterCount)
			summary.VideoSeconds += int64(log.VideoSeconds)
			summary.AudioSeconds += int64(log.AudioSeconds)
			createdAt := log.CreatedAt
			if summary.LastUsageAt == nil || createdAt.After(*summary.LastUsageAt) {
				summary.LastUsageAt = &createdAt
			}
			usageByTask[taskID] = summary
			if len(recentLogsByTask[taskID]) < 5 {
				recentLogsByTask[taskID] = append(recentLogsByTask[taskID], log)
			}
		}
	}
	return usageByTask, recentLogsByTask
}

func (h *AdminHandler) findUserByParam(c *gin.Context) (models.User, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "用户 ID 无效"})
		return models.User{}, false
	}
	var user models.User
	if err := h.db.First(&user, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户失败"})
		}
		return models.User{}, false
	}
	return user, true
}

func (h *AdminHandler) audit(c *gin.Context, action, targetType, targetID string, before, after any) {
	operatorID := currentAdminID(c)
	beforeJSON := mustAdminJSON(before)
	afterJSON := mustAdminJSON(after)
	_ = h.db.Create(&models.AdminAuditLog{
		OperatorID: operatorID,
		Action:     action,
		TargetType: targetType,
		TargetID:   targetID,
		BeforeJSON: beforeJSON,
		AfterJSON:  afterJSON,
		IP:         c.ClientIP(),
		UserAgent:  c.GetHeader("User-Agent"),
	}).Error
}

func currentAdminID(c *gin.Context) uint {
	value, _ := c.Get("userID")
	id, _ := value.(uint)
	return id
}

func mustAdminJSON(value any) string {
	if value == nil {
		return ""
	}
	data, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(data)
}

func (h *AdminHandler) usageQuery(c *gin.Context) *gorm.DB {
	query := h.db.Model(&models.APIUsageLog{})
	if rangeRaw := strings.TrimSpace(c.Query("range")); rangeRaw != "" && !strings.EqualFold(rangeRaw, "all") {
		query = query.Where("api_usage_logs.created_at >= ?", parseRangeStart(rangeRaw))
	}
	if startRaw := strings.TrimSpace(c.Query("start_date")); startRaw != "" {
		if t, err := time.Parse("2006-01-02", startRaw); err == nil {
			query = query.Where("api_usage_logs.created_at >= ?", t)
		}
	}
	if endRaw := strings.TrimSpace(c.Query("end_date")); endRaw != "" {
		if t, err := time.Parse("2006-01-02", endRaw); err == nil {
			query = query.Where("api_usage_logs.created_at < ?", t.Add(24*time.Hour))
		}
	}
	if module := strings.TrimSpace(c.Query("module")); module != "" {
		query = query.Where("api_usage_logs.module = ?", module)
	}
	if feature := strings.TrimSpace(c.Query("feature")); feature != "" {
		query = query.Where("api_usage_logs.feature = ?", feature)
	}
	if operation := strings.TrimSpace(c.Query("operation")); operation != "" {
		query = query.Where("api_usage_logs.operation = ?", operation)
	}
	if service := strings.TrimSpace(c.Query("service")); service != "" {
		query = query.Where("api_usage_logs.service = ?", service)
	}
	if provider := strings.TrimSpace(c.Query("provider")); provider != "" {
		query = query.Where("api_usage_logs.provider = ?", provider)
	}
	if model := strings.TrimSpace(c.Query("model")); model != "" {
		query = query.Where("api_usage_logs.model = ?", model)
	}
	if status := strings.TrimSpace(c.Query("status")); status != "" {
		query = query.Where("api_usage_logs.status = ?", status)
	}
	if uid := parsePositiveInt(c.Query("user_id"), 0); uid > 0 {
		query = query.Where("api_usage_logs.user_id = ?", uid)
	}
	if guestID := strings.TrimSpace(c.Query("guest_id")); guestID != "" {
		query = query.Where("api_usage_logs.guest_id = ?", guestID)
	}
	if conversationID := parsePositiveInt(c.Query("conversation_id"), 0); conversationID > 0 {
		query = query.Where("api_usage_logs.conversation_id = ?", conversationID)
	}
	if messageID := parsePositiveInt(c.Query("message_id"), 0); messageID > 0 {
		query = query.Where("api_usage_logs.message_id = ?", messageID)
	}
	if taskID := parsePositiveInt(c.Query("task_id"), 0); taskID > 0 {
		query = query.Where("api_usage_logs.task_id = ?", taskID)
	}
	if workspaceID := parsePositiveInt(c.Query("workspace_id"), 0); workspaceID > 0 {
		query = query.Where("api_usage_logs.workspace_id = ?", workspaceID)
	}
	if notebookID := parsePositiveInt(c.Query("notebook_id"), 0); notebookID > 0 {
		query = query.Where("api_usage_logs.notebook_id = ?", notebookID)
	}
	if resourceType := strings.TrimSpace(c.Query("resource_type")); resourceType != "" {
		query = query.Where("api_usage_logs.resource_type = ?", resourceType)
	}
	if resourceID := parsePositiveInt(c.Query("resource_id"), 0); resourceID > 0 {
		query = query.Where("api_usage_logs.resource_id = ?", resourceID)
	}
	if requestID := strings.TrimSpace(c.Query("request_id")); requestID != "" {
		query = query.Where("api_usage_logs.request_id = ?", requestID)
	}
	if estimated := strings.TrimSpace(c.Query("estimated")); estimated != "" {
		query = query.Where("api_usage_logs.estimated = ?", strings.EqualFold(estimated, "true") || estimated == "1")
	}
	if minCost := parseFloatQuery(c.Query("min_cost")); minCost != nil {
		query = query.Where("api_usage_logs.total_cost_rmb >= ?", *minCost)
	}
	if maxCost := parseFloatQuery(c.Query("max_cost")); maxCost != nil {
		query = query.Where("api_usage_logs.total_cost_rmb <= ?", *maxCost)
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		like := "%" + q + "%"
		query = query.Where("api_usage_logs.model LIKE ? OR api_usage_logs.request_id LIKE ? OR api_usage_logs.raw_usage_json LIKE ? OR api_usage_logs.error_message LIKE ?", like, like, like, like)
	}
	return query
}

func (h *AdminHandler) usageAggregate(query *gorm.DB) gin.H {
	var out struct {
		Requests       int64
		Failures       int64
		CostRMB        float64
		TotalTokens    int64
		PromptTokens   int64
		OutputTokens   int64
		ImageCount     int64
		CharacterCount int64
		VideoSeconds   int64
		AudioSeconds   int64
	}
	query.Select("COUNT(*) AS requests, COALESCE(SUM(CASE WHEN status <> 'success' THEN 1 ELSE 0 END), 0) AS failures, COALESCE(SUM(total_cost_rmb), 0) AS cost_rmb, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS output_tokens, COALESCE(SUM(image_count), 0) AS image_count, COALESCE(SUM(character_count), 0) AS character_count, COALESCE(SUM(video_seconds), 0) AS video_seconds, COALESCE(SUM(audio_seconds), 0) AS audio_seconds").Scan(&out)
	return gin.H{"requests": out.Requests, "failures": out.Failures, "cost_rmb": out.CostRMB, "total_tokens": out.TotalTokens, "prompt_tokens": out.PromptTokens, "completion_tokens": out.OutputTokens, "image_count": out.ImageCount, "character_count": out.CharacterCount, "video_seconds": out.VideoSeconds, "audio_seconds": out.AudioSeconds}
}

func (h *AdminHandler) usageGrouped(c *gin.Context, column string, limit int, extraWhere string, args ...any) []gin.H {
	if column != "service" && column != "provider" && column != "status" {
		return []gin.H{}
	}
	query := h.usageQuery(c)
	if extraWhere != "" {
		query = query.Where(extraWhere, args...)
	}
	items := []gin.H{}
	rows, err := query.Select("COALESCE(" + column + ", '') AS name, COUNT(*) AS requests, COALESCE(SUM(total_cost_rmb), 0) AS cost_rmb, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(image_count), 0) AS image_count").Group(column).Order("cost_rmb DESC").Limit(limit).Rows()
	if err != nil {
		return items
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var requests, tokens, images int64
		var cost float64
		if err := rows.Scan(&name, &requests, &cost, &tokens, &images); err == nil {
			items = append(items, gin.H{"name": name, "requests": requests, "cost_rmb": cost, "tokens": tokens, "image_count": images})
		}
	}
	return items
}

func (h *AdminHandler) usageModelRows(c *gin.Context, limit int, extraWhereAndArgs ...any) []gin.H {
	query := h.usageQuery(c)
	if len(extraWhereAndArgs) > 0 {
		where, _ := extraWhereAndArgs[0].(string)
		if where != "" {
			query = query.Where(where, extraWhereAndArgs[1:]...)
		}
	}
	items := []gin.H{}
	rows, err := query.Select("COALESCE(service, '') AS service, COALESCE(provider, '') AS provider, COALESCE(model, '') AS model, COUNT(*) AS requests, COALESCE(SUM(total_cost_rmb), 0) AS cost_rmb, COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(image_count), 0) AS image_count").Group("service, provider, model").Order("cost_rmb DESC").Limit(limit).Rows()
	if err != nil {
		return items
	}
	defer rows.Close()
	for rows.Next() {
		var service, provider, model string
		var requests, prompt, completion, tokens, images int64
		var cost float64
		if err := rows.Scan(&service, &provider, &model, &requests, &cost, &prompt, &completion, &tokens, &images); err == nil {
			items = append(items, gin.H{"service": service, "provider": provider, "model": model, "requests": requests, "cost_rmb": cost, "prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": tokens, "image_count": images})
		}
	}
	return items
}

func (h *AdminHandler) usageConversationRows(c *gin.Context, limit int, extraWhere string, argsAndOffset ...any) []gin.H {
	offset := 0
	args := argsAndOffset
	if len(argsAndOffset) > 0 {
		if last, ok := argsAndOffset[len(argsAndOffset)-1].(int); ok && extraWhere == "" {
			offset = last
			args = argsAndOffset[:len(argsAndOffset)-1]
		}
	}
	query := h.usageQuery(c).Where("conversation_id > 0")
	if extraWhere != "" {
		query = query.Where(extraWhere, args...)
	}
	items := []gin.H{}
	rows, err := query.Select("api_usage_logs.conversation_id, COALESCE(conversations.title, '') AS title, api_usage_logs.user_id, COALESCE(users.email, '') AS email, COUNT(*) AS requests, COALESCE(SUM(api_usage_logs.total_cost_rmb), 0) AS cost_rmb, COALESCE(SUM(api_usage_logs.total_tokens), 0) AS total_tokens, MAX(api_usage_logs.created_at) AS last_used_at").Joins("LEFT JOIN conversations ON conversations.id = api_usage_logs.conversation_id").Joins("LEFT JOIN users ON users.id = api_usage_logs.user_id").Group("api_usage_logs.conversation_id, conversations.title, api_usage_logs.user_id, users.email").Order("cost_rmb DESC").Limit(limit).Offset(offset).Rows()
	if err != nil {
		return items
	}
	defer rows.Close()
	for rows.Next() {
		var conversationID, userID uint
		var title, email string
		var requests, tokens int64
		var cost float64
		var lastUsed time.Time
		if err := rows.Scan(&conversationID, &title, &userID, &email, &requests, &cost, &tokens, &lastUsed); err == nil {
			items = append(items, gin.H{"conversation_id": conversationID, "title": title, "user_id": userID, "email": email, "requests": requests, "cost_rmb": cost, "total_tokens": tokens, "last_used_at": lastUsed, "models": h.usageModelRows(c, 8, "conversation_id = ?", conversationID)})
		}
	}
	return items
}

func (h *AdminHandler) topUsageModels(start time.Time, limit int) []gin.H {
	items := []gin.H{}
	rows, err := h.db.Model(&models.APIUsageLog{}).
		Select("COALESCE(model, '') AS model, COALESCE(provider, '') AS provider, COALESCE(SUM(total_cost_rmb), 0) AS cost_rmb, COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS tokens").
		Where("created_at >= ?", start).
		Group("model, provider").
		Order("cost_rmb DESC").
		Limit(limit).Rows()
	if err != nil {
		return items
	}
	defer rows.Close()
	for rows.Next() {
		var model, provider string
		var cost float64
		var requests int64
		var tokens int64
		if err := rows.Scan(&model, &provider, &cost, &requests, &tokens); err == nil {
			items = append(items, gin.H{"model": model, "provider": provider, "cost_rmb": cost, "requests": requests, "tokens": tokens})
		}
	}
	return items
}

func (h *AdminHandler) usageBreakdown(start time.Time, column string, limit int) []gin.H {
	if column != "provider" && column != "service" && column != "status" {
		return []gin.H{}
	}
	items := []gin.H{}
	rows, err := h.db.Model(&models.APIUsageLog{}).
		Select("COALESCE("+column+", '') AS name, COUNT(*) AS requests, COALESCE(SUM(total_cost_rmb), 0) AS cost_rmb, COALESCE(SUM(CASE WHEN status <> 'success' THEN 1 ELSE 0 END), 0) AS failures").
		Where("created_at >= ?", start).
		Group(column).
		Order("requests DESC").
		Limit(limit).Rows()
	if err != nil {
		return items
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var requests int64
		var cost float64
		var failures int64
		if err := rows.Scan(&name, &requests, &cost, &failures); err == nil {
			items = append(items, gin.H{"name": name, "requests": requests, "cost_rmb": cost, "failures": failures})
		}
	}
	return items
}

func (h *AdminHandler) dailyUsage(start time.Time) []adminUsageBucket {
	items := []adminUsageBucket{}
	rows, err := h.db.Model(&models.APIUsageLog{}).
		Select("DATE(created_at) AS day, COUNT(*) AS requests, COALESCE(SUM(CASE WHEN status <> 'success' THEN 1 ELSE 0 END), 0) AS failures, COALESCE(SUM(total_cost_rmb), 0) AS cost_rmb").
		Where("created_at >= ?", start).
		Group("DATE(created_at)").
		Order("day ASC").Rows()
	if err != nil {
		return items
	}
	defer rows.Close()
	for rows.Next() {
		var day time.Time
		var requests int64
		var failures int64
		var cost float64
		if err := rows.Scan(&day, &requests, &failures, &cost); err == nil {
			items = append(items, adminUsageBucket{Date: day.Format("2006-01-02"), Requests: requests, Failures: failures, CostRMB: cost})
		}
	}
	return items
}

func (h *AdminHandler) estimateTaskCost(task models.AIBackgroundTask, usage adminTaskUsageSummary) adminTaskCostEstimate {
	est := adminTaskCostEstimate{
		EstimatedPromptTokens:     4000,
		EstimatedCompletionTokens: 2000,
		EstimatedTotalTokens:      6000,
		Method:                    "model_price_4k_input_2k_output_baseline",
		Note:                      "后台预估：按 4K 输入 / 2K 输出基线估算；实际成本以 usage ledger 为准。",
	}
	if strings.TrimSpace(task.Model) == "" {
		est.Note = "任务缺少模型信息，无法预估。"
		return est
	}
	price := services.NewUsageService(h.cfg).GetTokenPriceSnapshot(task.Provider, task.Model)
	if price.InputPriceRMB <= 0 && price.OutputPriceRMB <= 0 {
		est.Note = "未找到该模型价格配置，无法预估。"
		return est
	}
	est.Available = true
	est.PricingUnit = price.PricingUnit
	est.InputUnitPriceRMB = price.InputPriceRMB
	est.OutputUnitPriceRMB = price.OutputPriceRMB
	est.EstimatedInputCostRMB = float64(est.EstimatedPromptTokens) * price.InputPriceRMB / 1000.0
	est.EstimatedOutputCostRMB = float64(est.EstimatedCompletionTokens) * price.OutputPriceRMB / 1000.0
	est.EstimatedTotalCostRMB = est.EstimatedInputCostRMB + est.EstimatedOutputCostRMB
	est.ActualTotalCostRMB = usage.CostRMB
	if usage.Requests > 0 {
		est.DeltaCostRMB = usage.CostRMB - est.EstimatedTotalCostRMB
		if est.EstimatedTotalCostRMB > 0 {
			est.DeltaRate = est.DeltaCostRMB / est.EstimatedTotalCostRMB
		}
	}
	return est
}

func (h *AdminHandler) taskSummary() []gin.H {
	items := []gin.H{}
	rows, err := h.db.Model(&models.AIBackgroundTask{}).
		Select("COALESCE(status, '') AS status, COUNT(*) AS count").
		Group("status").
		Order("count DESC").Rows()
	if err != nil {
		return items
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		var count int64
		if err := rows.Scan(&status, &count); err == nil {
			items = append(items, gin.H{"status": status, "count": count})
		}
	}
	return items
}

func appendIfMissing(items []string, value string) []string {
	for _, item := range items {
		if item == value {
			return items
		}
	}
	return append(items, value)
}

func containsString(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}

func firstCapability(items []string) string {
	if len(items) == 0 {
		return "chat"
	}
	return items[0]
}

func parsePositiveInt(raw string, fallback int) int {
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func parseFloatQuery(raw string) *float64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return nil
	}
	return &value
}

func usageSortColumn(raw string) string {
	switch strings.TrimSpace(raw) {
	case "cost":
		return "total_cost_rmb"
	case "tokens":
		return "total_tokens"
	case "characters":
		return "character_count"
	case "images":
		return "image_count"
	case "created_at", "":
		return "created_at"
	default:
		return "created_at"
	}
}

func parseRangeStart(raw string) time.Time {
	now := time.Now()
	switch raw {
	case "30d":
		return now.AddDate(0, 0, -30)
	case "7d":
		return now.AddDate(0, 0, -7)
	default:
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	}
}
