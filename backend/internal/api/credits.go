package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"aipool-backend/internal/config"
	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ========== 模型等级映射 ==========

var modelTierMap = map[string]string{
	// 基础等级
	"gpt-5.4-mini":         "basic",
	"gemini-2.0-flash-exp": "basic",
	"gemini-3.5-flash":     "basic",

	// 高级等级
	"gpt-5.4":                    "advanced",
	"gpt-5.5":                    "advanced",
	"claude-3-5-sonnet-20241022": "advanced",
	"deepseek-v4-flash":          "advanced",
	"kimi-k2.5":                  "advanced",
	"kimi-k2.6":                  "advanced",

	// 精英等级
	"gpt-5.5-pro":     "elite",
	"deepseek-v4-pro": "elite",
	"chat-1":          "elite",
}

// 每日重置配额（单位：分；1 积分 = 100 分）。这是会员套餐额度，不用于内测钱包。
var dailyQuota = map[string]map[string]int{
	"free": {
		"basic":    3000,
		"advanced": 0,
		"elite":    0,
	},
	"basic": {
		"basic":    10000,
		"advanced": 2000,
		"elite":    500,
	},
	"plus": {
		"basic":    30000,
		"advanced": 8000,
		"elite":    2000,
	},
	"ultra": {
		"basic":    -1, // 无限
		"advanced": 20000,
		"elite":    6000,
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
	case "elite":
		return "精英"
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
		"chat-1":                          2200, // Chat 1: ¥22/条
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
		"gpt-5.4-mini":               1,
		"gemini-2.0-flash-exp":       1,
		"gemini-3.5-flash":           1,
		"gpt-5.4":                    50,
		"claude-3-5-sonnet-20241022": 50,
		"gemini-3.1-pro-preview":     50,
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
			user.EliteCredits = dailyQuota["free"]["elite"]
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
		"tier_names":                  map[string]string{"basic": "基础", "advanced": "高级", "elite": "精英"},
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
			user.EliteCredits = dailyQuota["free"]["elite"]
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
	case "elite":
		creditsField = &user.EliteCredits
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

// GetModelTiers 获取所有模型等级映射
// @Summary 获取模型等级映射表
// @Tags credits
// @Produce json
// @Success 200 {object} map[string]string
// @Router /api/models/tiers [get]
func (h *CreditsHandler) GetModelTiers(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"tiers": modelTierMap,
		"quota": dailyQuota,
	})
}

// GetPublicPlans 获取公开套餐信息（无需认证）
// @Summary 获取套餐配额
// @Tags credits
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Router /api/plans [get]
func (h *CreditsHandler) GetPublicPlans(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"plans": map[string]interface{}{
			"free": map[string]interface{}{
				"name":     "免费版",
				"basic":    30,
				"advanced": 0,
				"elite":    0,
				"features": []string{"每日免费重置", "基础模型", "标准速度"},
			},
			"basic": map[string]interface{}{
				"name":     "Basic",
				"basic":    100,
				"advanced": 20,
				"elite":    5,
				"features": []string{"基础+高级+精英积分", "无广告", "标准速度"},
			},
			"plus": map[string]interface{}{
				"name":     "Plus",
				"basic":    300,
				"advanced": 80,
				"elite":    20,
				"features": []string{"更多积分", "优先响应", "高级模型"},
			},
			"ultra": map[string]interface{}{
				"name":     "Ultra",
				"basic":    -1,
				"advanced": 200,
				"elite":    60,
				"features": []string{"基础无限", "最高优先级", "全部模型"},
			},
		},
	})
}
