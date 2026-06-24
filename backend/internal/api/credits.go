package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"aipool-backend/internal/config"
	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ========== 模型等级映射 ==========

var modelTierMap = map[string]string{
	// 基础等级
	"gpt-5.4-mini": "basic",

	"gemini-3.5-flash":      "basic",
	"gemini-3.1-flash-lite": "basic",
	"deepseek-v4-flash":     "basic",

	// 高级等级
	"gpt-5.4":                "advanced",
	"gpt-5.5":                "advanced",
	"gpt-5.5-pro":            "advanced",
	"gemini-3.1-pro-preview": "advanced",
	"gemini-2.5-pro":         "advanced",
	"gemini-2.5-pro-preview": "advanced",
	"deepseek-v4-pro":        "advanced",
	"kimi-k2.5":              "advanced",
	"kimi-k2.6":              "advanced",
	"kimi-k2.7-code":         "advanced",
}

// 每日重置配额（单位：分；1 积分 = 100 分）。这是会员套餐额度，不用于内测钱包。
var dailyQuota = map[string]map[string]int{
	"free": {
		"basic":    3000,
		"advanced": 0,
	},
	"basic": {
		"basic":    10000,
		"advanced": 2500,
	},
	"plus": {
		"basic":    30000,
		"advanced": 10000,
	},
	"ultra": {
		"basic":    -1, // 无限
		"advanced": 26000,
	},
}

// GetModelTier 获取模型等级
func GetModelTier(modelID string) string {
	tier, ok := modelTierMap[modelID]
	if !ok {
		return "basic" // 未知模型默认基础等级
	}
	return tier
}

// GetTierName 获取等级中文名
func GetTierName(tier string) string {
	switch tier {
	case "basic":
		return "基础"
	case "advanced":
		return "高级"
	default:
		return "基础"
	}
}

// getModelCostFen 获取模型成本（单位：分；1 Credit = ¥1 = 100 分）
func getModelCostFen(db *gorm.DB, modelID string) int {
	var cfg models.BetaConfig
	if err := db.Where("key = ?", models.BetaConfigModelCosts).First(&cfg).Error; err != nil {
		return getDefaultModelCostFen(modelID)
	}
	var costs map[string]int
	if err := json.Unmarshal([]byte(cfg.Value), &costs); err != nil {
		return getDefaultModelCostFen(modelID)
	}
	if cost, ok := costs[modelID]; ok {
		return cost
	}
	return getDefaultModelCostFen(modelID)
}

// getBetaPhaseName 获取阶段中文名
func getBetaPhaseName(phase string) string {
	switch phase {
	case "phase_1":
		return "试探期"
	case "phase_2":
		return "深水区"
	case "phase_3":
		return "枯竭期"
	case "completed":
		return "已完成"
	default:
		return ""
	}
}

func getDefaultModelCostFen(modelID string) int {
	defaults := map[string]int{
		// 用户给定内测成本：1 Credit = ¥1 = 100 分
		"gpt-5.5-pro":                     2200,
		"gpt-5.5":                         50, // Chat 2: ¥0.5/条
		"kimi-k2.6":                       50,
		"kimi-k2.5":                       50,
		"deepseek-v4-pro":                 50,
		"deepseek-v4-flash":               1, // Chat 3: ¥0.006/条，当前最小粒度取 1 分
		"gemini-3.1-flash-lite":           1,
		"gpt-image-2":                     100, // Image 1: ¥1/条
		"gemini-2.5-pro":                  20,  // Image 2: ¥0.2/条（暂映射到低价图像/文档模型）
		"doubao-seedance-2.0-mini":        50,
		"doubao-seedance-1.5-pro":         150,
		"doubao-seedance-1.0-pro":         150,
		"doubao-seedance-1.0-pro-fast":    50,
		"doubao-seedance-2-0-260128":      150, // Legacy Video 1
		"doubao-seedance-2-0-pro-260128":  150, // Legacy typo/alias seen in old Seedream Beta constants
		"doubao-seedance-2-0-fast-260128": 50,  // Legacy Video 2

		// 兼容旧模型默认值
		"gpt-5.4-mini":           1,
		"gemini-3.5-flash":       1,
		"gpt-5.4":                50,
		"gemini-3.1-pro-preview": 50,
		"google-cloud-translate-v3:general/translation-llm": 1,
		"gemini-3.5-live-translate-preview":                 1,
	}
	if cost, ok := defaults[modelID]; ok {
		return cost
	}
	return 100 // 默认 1 Credit
}

func isActiveBetaUser(user models.User) bool {
	return user.BetaPhase != "" && user.BetaPhase != "completed"
}

func isModelAllowedForBetaBatch(batch, modelID string) bool {
	if batch == "" {
		return true
	}
	switch batch {
	case "batch-1":
		// 文本逻辑专场：关闭 Image 1 与所有 Seedance 视频模型；允许 Chat 1/2/3。
		return modelID != "gpt-image-2" && !strings.Contains(normalizeSeedanceModelKey(modelID), "seedance")
	case "batch-2":
		// 图像与多模态专场：锁死 Chat 1。
		return modelID != "chat-1" && modelID != "gpt-5.5-pro"
	case "batch-3":
		return true
	default:
		return true
	}
}

func betaBatchBlockedMessage(batch string) string {
	switch batch {
	case "batch-1":
		return "当前为第一批文本逻辑专场，Image 1 / Video 1 / Video 2 已锁定。"
	case "batch-2":
		return "当前为第二批图像与多模态专场，Chat 1 深度推理已锁定。"
	default:
		return "当前内测批次暂不允许调用该模型。"
	}
}

// ========== CreditsHandler ==========

type CreditsHandler struct {
	db  *gorm.DB
	cfg *config.Config
}

func NewCreditsHandler(db *gorm.DB, cfg *config.Config) *CreditsHandler {
	return &CreditsHandler{db: db, cfg: cfg}
}

// GetCreditsResponse 积分响应
// @Summary 获取当前用户积分
// @Tags credits
// @Accept json
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Router /api/user/credits [get]
func (h *CreditsHandler) GetCredits(c *gin.Context) {
	userID, _ := c.Get("userID")
	var user models.User
	if err := h.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	now := time.Now()
	if !isActiveBetaUser(user) && user.PlanTier == "free" {
		needsReset := user.CreditsResetAt.IsZero() ||
			user.CreditsResetAt.Year() != now.Year() ||
			user.CreditsResetAt.YearDay() != now.YearDay()
		if needsReset {
			user.BasicCredits = dailyQuota["free"]["basic"]
			user.AdvancedCredits = dailyQuota["free"]["advanced"]
			user.EliteCredits = 0
			user.CreditsResetAt = now
			h.db.Save(&user)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"basic_credits":               user.BasicCredits,
		"advanced_credits":            user.AdvancedCredits,
		"elite_credits":               user.EliteCredits,
		"basic_credits_display":       float64(user.BasicCredits) / 100.0,
		"advanced_credits_display":    float64(user.AdvancedCredits) / 100.0,
		"elite_credits_display":       float64(user.EliteCredits) / 100.0,
		"plan_tier":                   user.PlanTier,
		"credits_reset_at":            user.CreditsResetAt.Format(time.RFC3339),
		"daily_quota":                 dailyQuota[user.PlanTier],
		"tier_names":                  map[string]string{"basic": "基础", "advanced": "高级"},
		"beta_batch":                  user.BetaBatch,
		"beta_phase":                  user.BetaPhase,
		"beta_phase_name":             getBetaPhaseName(user.BetaPhase),
		"beta_credit_balance":         user.BetaCreditBalance,
		"beta_credit_balance_display": float64(user.BetaCreditBalance) / 100.0,
		"beta_credit_granted_total":   user.BetaCreditGrantedTotal,
		"beta_credit_granted_display": float64(user.BetaCreditGrantedTotal) / 100.0,
		"beta_credit_used_total":      user.BetaCreditUsedTotal,
		"beta_credit_used_display":    float64(user.BetaCreditUsedTotal) / 100.0,
		"beta_phase_1_used":           user.BetaPhase1Used,
		"beta_phase_2_used":           user.BetaPhase2Used,
		"beta_phase_3_used":           user.BetaPhase3Used,
	})
}

// DeductRequest 扣减积分请求
// Amount 是分。视频模型应由调用方传 秒数*每秒分值；不传则按单次/1秒默认成本。
type DeductRequest struct {
	ModelID string `json:"model_id" binding:"required"`
	Amount  int    `json:"amount"`
}

// DeductCredits 扣减积分（支持差异化模型成本，单位：分）
// @Summary 扣减模型使用积分
// @Tags credits
// @Accept json
// @Produce json
// @Param body body DeductRequest true "扣减参数"
// @Success 200 {object} map[string]interface{}
// @Failure 402 {object} map[string]interface{}
// @Router /api/user/credits/deduct [post]
func (h *CreditsHandler) DeductCredits(c *gin.Context) {
	userID, _ := c.Get("userID")
	var req DeductRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	creditCheck := checkAndDeductCredits(h.db, userID.(uint), req.ModelID, req.Amount)
	if !creditCheck.OK {
		c.JSON(creditCheck.HTTPStatus, creditCheck.ErrorResp)
		return
	}

	var user models.User
	if err := h.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":                     true,
		"tier":                        creditCheck.Tier,
		"tier_name":                   GetTierName(creditCheck.Tier),
		"deducted":                    creditCheck.DeductedFen,
		"deducted_display":            float64(creditCheck.DeductedFen) / 100.0,
		"basic_credits":               user.BasicCredits,
		"advanced_credits":            user.AdvancedCredits,
		"elite_credits":               user.EliteCredits,
		"basic_credits_display":       float64(user.BasicCredits) / 100.0,
		"advanced_credits_display":    float64(user.AdvancedCredits) / 100.0,
		"elite_credits_display":       float64(user.EliteCredits) / 100.0,
		"beta_credit_balance":         user.BetaCreditBalance,
		"beta_credit_balance_display": float64(user.BetaCreditBalance) / 100.0,
		"beta_credit_granted_total":   user.BetaCreditGrantedTotal,
		"beta_credit_granted_display": float64(user.BetaCreditGrantedTotal) / 100.0,
		"beta_credit_used_total":      user.BetaCreditUsedTotal,
		"beta_credit_used_display":    float64(user.BetaCreditUsedTotal) / 100.0,
		"remaining":                   creditCheck.Remaining,
		"remaining_display":           float64(creditCheck.Remaining) / 100.0,
		"beta_batch":                  user.BetaBatch,
		"beta_phase":                  user.BetaPhase,
		"is_beta_phase":               creditCheck.IsBetaPhase,
	})
	return
}

func (h *CreditsHandler) deductCreditsLegacy(c *gin.Context) {
	userID, _ := c.Get("userID")
	var user models.User
	if err := h.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	var req DeductRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	now := time.Now()
	isInBetaPhase := isActiveBetaUser(user)
	if !isInBetaPhase && user.PlanTier == "free" {
		needsReset := user.CreditsResetAt.IsZero() ||
			user.CreditsResetAt.Year() != now.Year() ||
			user.CreditsResetAt.YearDay() != now.YearDay()
		if needsReset {
			user.BasicCredits = dailyQuota["free"]["basic"]
			user.AdvancedCredits = dailyQuota["free"]["advanced"]
			user.EliteCredits = 0
			user.CreditsResetAt = now
		}
	}

	if isInBetaPhase && !isModelAllowedForBetaBatch(user.BetaBatch, req.ModelID) {
		c.JSON(http.StatusForbidden, gin.H{
			"error":         "当前内测批次暂未开放该模型",
			"model_id":      req.ModelID,
			"beta_batch":    user.BetaBatch,
			"beta_phase":    user.BetaPhase,
			"message":       betaBatchBlockedMessage(user.BetaBatch),
			"is_beta_phase": true,
		})
		return
	}

	tier := GetModelTier(req.ModelID)
	costFen := getModelCostFen(h.db, req.ModelID)
	if req.Amount > 0 {
		costFen = req.Amount
	}

	var creditsField *int
	switch tier {
	case "basic":
		creditsField = &user.BasicCredits
	case "advanced":
		creditsField = &user.AdvancedCredits
	default:
		creditsField = &user.BasicCredits
	}

	quota := dailyQuota[user.PlanTier][tier]
	isUnlimited := quota < 0 && !isInBetaPhase

	remainingCredits := *creditsField
	if isInBetaPhase {
		remainingCredits = user.BetaCreditBalance
	}
	if !isUnlimited && remainingCredits < costFen {
		tierName := GetTierName(tier)
		if isInBetaPhase {
			tierName = "内测 Credit"
		}
		c.JSON(http.StatusPaymentRequired, gin.H{
			"error":             "积分不足",
			"tier":              tier,
			"tier_name":         tierName,
			"required":          costFen,
			"required_display":  float64(costFen) / 100.0,
			"remaining":         remainingCredits,
			"remaining_display": float64(remainingCredits) / 100.0,
			"is_beta_phase":     isInBetaPhase,
			"beta_batch":        user.BetaBatch,
			"beta_phase":        user.BetaPhase,
			"upgrade_tip":       "额度耗尽后请提交有效 Bad Case 解锁下一阶段。",
		})
		return
	}

	if isInBetaPhase {
		user.BetaCreditBalance -= costFen
		user.BetaCreditUsedTotal += costFen
	} else if !isUnlimited {
		*creditsField -= costFen
	}
	user.UpdatedAt = now
	h.db.Save(&user)

	remainingAfter := *creditsField
	if isInBetaPhase {
		remainingAfter = user.BetaCreditBalance
	}

	metadata, _ := json.Marshal(map[string]interface{}{
		"amount":         costFen,
		"amount_display": float64(costFen) / 100.0,
		"tier":           tier,
		"is_beta":        isInBetaPhase,
		"beta_batch":     user.BetaBatch,
		"remaining":      remainingAfter,
	})
	h.db.Create(&models.AnalyticsEvent{
		UserID:    user.ID,
		EventType: "credit_use",
		EventName: "credit_use",
		PagePath:  c.Request.URL.Path,
		ModelID:   req.ModelID,
		Metadata:  string(metadata),
	})

	c.JSON(http.StatusOK, gin.H{
		"success":                     true,
		"tier":                        tier,
		"tier_name":                   GetTierName(tier),
		"deducted":                    costFen,
		"deducted_display":            float64(costFen) / 100.0,
		"basic_credits":               user.BasicCredits,
		"advanced_credits":            user.AdvancedCredits,
		"elite_credits":               user.EliteCredits,
		"basic_credits_display":       float64(user.BasicCredits) / 100.0,
		"advanced_credits_display":    float64(user.AdvancedCredits) / 100.0,
		"elite_credits_display":       float64(user.EliteCredits) / 100.0,
		"beta_credit_balance":         user.BetaCreditBalance,
		"beta_credit_balance_display": float64(user.BetaCreditBalance) / 100.0,
		"beta_credit_granted_total":   user.BetaCreditGrantedTotal,
		"beta_credit_granted_display": float64(user.BetaCreditGrantedTotal) / 100.0,
		"beta_credit_used_total":      user.BetaCreditUsedTotal,
		"beta_credit_used_display":    float64(user.BetaCreditUsedTotal) / 100.0,
		"remaining":                   remainingAfter,
		"remaining_display":           float64(remainingAfter) / 100.0,
		"beta_batch":                  user.BetaBatch,
		"beta_phase":                  user.BetaPhase,
		"is_beta_phase":               isInBetaPhase,
	})
}

type publicTierModel struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
	Tier     string `json:"tier"`
}

func getConfiguredModelTiers() map[string]string {
	tiers := make(map[string]string, len(modelTierMap))
	for modelID, tier := range modelTierMap {
		tiers[modelID] = normalizeModelTier(tier, modelID)
	}
	if modelConfigDB == nil {
		return tiers
	}

	var configs []models.ModelConfig
	if err := modelConfigDB.Find(&configs).Error; err != nil {
		return tiers
	}
	for _, cfg := range configs {
		if cfg.Tier == "basic" || cfg.Tier == "advanced" {
			tiers[cfg.ModelID] = cfg.Tier
		}
	}
	return tiers
}

func normalizeModelTier(tier string, modelID string) string {
	if tier == "basic" || tier == "advanced" {
		return tier
	}
	if tier == "elite" {
		return "advanced"
	}
	defaultTier := GetModelTier(modelID)
	if defaultTier == "elite" {
		return "advanced"
	}
	if defaultTier == "basic" || defaultTier == "advanced" {
		return defaultTier
	}
	return "basic"
}

// GetModelTiers 获取所有模型等级映射与公开展示分组。
// @Summary 获取模型等级映射表
// @Tags credits
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Router /api/models/tiers [get]
func (h *CreditsHandler) GetModelTiers(c *gin.Context) {
	tierModels := map[string][]publicTierModel{
		"basic":    {},
		"advanced": {},
	}

	configuredTiers := getConfiguredModelTiers()
	for _, m := range mergeModelConfigs(modelmeta.ChatModels()) {
		tier := configuredTiers[m.ID]
		if tier != "basic" && tier != "advanced" {
			tier = GetModelTier(m.ID)
		}
		tierModels[tier] = append(tierModels[tier], publicTierModel{
			ID:       m.ID,
			Name:     m.Name,
			Provider: m.Provider,
			Tier:     tier,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"tiers":       configuredTiers,
		"tier_models": tierModels,
		"quota":       dailyQuota,
		"tier_names":  map[string]string{"basic": "基础", "advanced": "高级"},
	})
}

// GetPublicPlans 获取公开套餐信息（无需认证）
// @Summary 获取套餐配额
// @Tags credits
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Router /api/plans [get]
func (h *CreditsHandler) GetPublicPlans(c *gin.Context) {
	var billingPlans []models.BillingPlan
	if h != nil && h.db != nil {
		h.db.Where("enabled = ? AND public_visible = ?", true, true).Order("sort_order ASC, price_cents ASC, id ASC").Find(&billingPlans)
	}
	if len(billingPlans) > 0 {
		plans := map[string]interface{}{}
		for _, plan := range billingPlans {
			plans[plan.Code] = map[string]interface{}{
				"id":               plan.ID,
				"code":             plan.Code,
				"name":             plan.Name,
				"description":      plan.Description,
				"price_cents":      plan.PriceCents,
				"price":            float64(plan.PriceCents) / 100.0,
				"currency":         plan.Currency,
				"interval":         plan.Interval,
				"basic":            plan.BasicCredits,
				"advanced":         plan.AdvancedCredits,
				"elite":            plan.EliteCredits,
				"basic_credits":    plan.BasicCredits,
				"advanced_credits": plan.AdvancedCredits,
				"elite_credits":    plan.EliteCredits,
			}
		}
		c.JSON(http.StatusOK, gin.H{"plans": plans})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"plans": map[string]interface{}{
			"basic": map[string]interface{}{
				"name":             "基础版",
				"price_cents":      14900,
				"price":            149,
				"currency":         "CNY",
				"interval":         "monthly",
				"basic":            3600,
				"advanced":         200,
				"basic_credits":    3600,
				"advanced_credits": 200,
			},
		},
	})
}

// ========== 服务端强制积分校验与扣减（聊天调用链内嵌） ==========

// CreditCheckResult 积分校验结果
type CreditCheckResult struct {
	OK         bool
	HTTPStatus int
	ErrorResp  gin.H
	// 扣减成功后的信息（OK=true 时有效）
	DeductedFen      int
	Tier             string
	IsBetaPhase      bool
	BetaBatch        string
	BetaPhase        string
	Remaining        int
	RemainingDisplay float64
}

// checkAndDeductCredits 是 DeductCredits HTTP handler 的核心逻辑提取，
// 供 Chat / CompareChat / ForkChat 在调用模型前直接调用，确保服务端强制校验。
//
// userID=0 表示匿名用户，直接放行（匿名用户有独立的 guest 限额检查）。
// 返回 CreditCheckResult：OK=true 表示已成功扣减，可继续调用模型；
// OK=false 表示校验失败，调用方应直接返回 result.ErrorResp。
func checkAndDeductCredits(db *gorm.DB, userID uint, modelID string, amount int) CreditCheckResult {
	if userID == 0 {
		// 匿名用户已有独立的 guest 限额检查（requireGuestOrUser → checkGuestLimit），这里放行
		return CreditCheckResult{OK: true}
	}

	var user models.User
	if err := db.First(&user, userID).Error; err != nil {
		return CreditCheckResult{
			OK:         false,
			HTTPStatus: http.StatusNotFound,
			ErrorResp:  gin.H{"error": "用户不存在"},
		}
	}

	now := time.Now()
	isInBetaPhase := isActiveBetaUser(user)

	// ========== 未激活用户拦截 ==========
	// 注册开放，但未绑定邀请码的 free 用户无法使用任何模型。
	// 判定条件：非管理员 + 非 active beta（从未激活或已完成内测后回归会员体系都不是这里拦的）+ free 套餐 + BetaPhase 为空（从未激活过邀请码）。
	// 已完成内测的用户 BetaPhase="completed"，走下方会员体系正常扣减。
	if user.Role != "admin" && !isInBetaPhase && user.BetaPhase == "" && user.PlanTier == "free" {
		return CreditCheckResult{
			OK:         false,
			HTTPStatus: http.StatusForbidden,
			ErrorResp: gin.H{
				"error":       "not_activated",
				"message":     "请先使用邀请码激活内测账号后再使用模型功能。",
				"need_invite": true,
			},
		}
	}
	// ========== 未激活用户拦截结束 ==========

	// 非内测 free 用户：每日重置
	if !isInBetaPhase && user.PlanTier == "free" {
		needsReset := user.CreditsResetAt.IsZero() ||
			user.CreditsResetAt.Year() != now.Year() ||
			user.CreditsResetAt.YearDay() != now.YearDay()
		if needsReset {
			user.BasicCredits = dailyQuota["free"]["basic"]
			user.AdvancedCredits = dailyQuota["free"]["advanced"]
			user.EliteCredits = 0
			user.CreditsResetAt = now
		}
	}

	// 内测批次模型限制
	if isInBetaPhase && !isModelAllowedForBetaBatch(user.BetaBatch, modelID) {
		return CreditCheckResult{
			OK:         false,
			HTTPStatus: http.StatusForbidden,
			ErrorResp: gin.H{
				"error":         "当前内测批次暂未开放该模型",
				"model_id":      modelID,
				"beta_batch":    user.BetaBatch,
				"beta_phase":    user.BetaPhase,
				"message":       betaBatchBlockedMessage(user.BetaBatch),
				"is_beta_phase": true,
			},
		}
	}

	tier := GetModelTier(modelID)
	costFen := getModelCostFen(db, modelID)
	if amount > 0 {
		costFen = amount
	}

	var creditsField *int
	switch tier {
	case "basic":
		creditsField = &user.BasicCredits
	case "advanced":
		creditsField = &user.AdvancedCredits
	default:
		creditsField = &user.BasicCredits
	}

	quota := dailyQuota[user.PlanTier][tier]
	isUnlimited := quota < 0 && !isInBetaPhase

	remainingCredits := *creditsField
	if isInBetaPhase {
		remainingCredits = user.BetaCreditBalance
	}

	if !isUnlimited && remainingCredits < costFen {
		tierName := GetTierName(tier)
		if isInBetaPhase {
			tierName = "内测 Credit"
		}
		return CreditCheckResult{
			OK:         false,
			HTTPStatus: http.StatusPaymentRequired,
			ErrorResp: gin.H{
				"error":             "积分不足",
				"tier":              tier,
				"tier_name":         tierName,
				"required":          costFen,
				"required_display":  float64(costFen) / 100.0,
				"remaining":         remainingCredits,
				"remaining_display": float64(remainingCredits) / 100.0,
				"is_beta_phase":     isInBetaPhase,
				"beta_batch":        user.BetaBatch,
				"beta_phase":        user.BetaPhase,
				"upgrade_tip":       "额度耗尽后请提交有效 Bad Case 解锁下一阶段。",
			},
		}
	}

	// 扣减
	if isInBetaPhase {
		user.BetaCreditBalance -= costFen
		user.BetaCreditUsedTotal += costFen
	} else if !isUnlimited {
		*creditsField -= costFen
	}
	user.UpdatedAt = now
	if err := db.Save(&user).Error; err != nil {
		return CreditCheckResult{
			OK:         false,
			HTTPStatus: http.StatusInternalServerError,
			ErrorResp:  gin.H{"error": "积分扣减失败"},
		}
	}

	remainingAfter := *creditsField
	if isInBetaPhase {
		remainingAfter = user.BetaCreditBalance
	}

	// 记录埋点
	metadata, _ := json.Marshal(map[string]interface{}{
		"amount":         costFen,
		"amount_display": float64(costFen) / 100.0,
		"tier":           tier,
		"is_beta":        isInBetaPhase,
		"beta_batch":     user.BetaBatch,
		"remaining":      remainingAfter,
	})
	db.Create(&models.AnalyticsEvent{
		UserID:    user.ID,
		EventType: "credit_use",
		EventName: "credit_use",
		ModelID:   modelID,
		Metadata:  string(metadata),
	})

	return CreditCheckResult{
		OK:               true,
		DeductedFen:      costFen,
		Tier:             tier,
		IsBetaPhase:      isInBetaPhase,
		BetaBatch:        user.BetaBatch,
		BetaPhase:        user.BetaPhase,
		Remaining:        remainingAfter,
		RemainingDisplay: float64(remainingAfter) / 100.0,
	}
}

func ensureModelAccess(c *gin.Context, db *gorm.DB, userID uint, modelID string, amount int) bool {
	if db == nil {
		return true
	}
	creditCheck := checkAndDeductCredits(db, userID, modelID, amount)
	if !creditCheck.OK {
		c.JSON(creditCheck.HTTPStatus, creditCheck.ErrorResp)
		return false
	}
	return true
}
