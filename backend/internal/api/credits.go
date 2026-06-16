package api

import (
	"encoding/json"
	"net/http"
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
}

// 每日重置配额
var dailyQuota = map[string]map[string]int{
	"free": {
		"basic":    30,
		"advanced": 0,
		"elite":    0,
	},
	"basic": {
		"basic":    100,
		"advanced": 20,
		"elite":    5,
	},
	"plus": {
		"basic":    300,
		"advanced": 80,
		"elite":    20,
	},
	"ultra": {
		"basic":    -1, // 无限
		"advanced": 200,
		"elite":    60,
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

// getModelCostFen 获取模型成本（单位：分）
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
		"gpt-5.4-mini": 10,
		"gemini-2.0-flash-exp": 10,
		"gemini-3.5-flash": 20,
		"gpt-5.4": 100,
		"gpt-5.5": 200,
		"claude-3-5-sonnet-20241022": 300,
		"deepseek-v4-flash": 100,
		"kimi-k2.5": 100,
		"kimi-k2.6": 100,
		"gpt-5.5-pro":          2200,
		"deepseek-v4-pro":      1500,
		"chat-1":               2200,
		"gpt-image-2":          500,
		"gemini-2.5-pro":       500,
		"gemini-3.1-pro-preview": 500,
		"gemini-3.1-flash-lite": 50,
		"doubao-seedance-2-0-fast-260128": 1000,
		"doubao-seedance-2-0-260128":      2000,
	}
	if cost, ok := defaults[modelID]; ok {
		return cost
	}
	return 100 // 默认 1.00 积分
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

	// 检查是否需要重置每日配额（跨天且是 free 套餐）
	now := time.Now()
	if user.PlanTier == "free" {
		// 简单判断：如果 CreditsResetAt 是空或者不是今天
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
		"basic_credits":    user.BasicCredits,
		"advanced_credits": user.AdvancedCredits,
		"elite_credits":    user.EliteCredits,
		"basic_credits_display":    float64(user.BasicCredits) / 100.0,
		"advanced_credits_display": float64(user.AdvancedCredits) / 100.0,
		"elite_credits_display":    float64(user.EliteCredits) / 100.0,
		"plan_tier":        user.PlanTier,
		"credits_reset_at": user.CreditsResetAt.Format(time.RFC3339),
		"daily_quota":      dailyQuota[user.PlanTier],
		"tier_names": map[string]string{
			"basic":    "基础",
			"advanced": "高级",
			"elite":    "精英",
		},
		"beta_phase":       user.BetaPhase,
		"beta_phase_name":  getBetaPhaseName(user.BetaPhase),
		"beta_phase_1_used": user.BetaPhase1Used,
		"beta_phase_2_used": user.BetaPhase2Used,
		"beta_phase_3_used": user.BetaPhase3Used,
	})
}

// DeductRequest 扣减积分请求
type DeductRequest struct {
	ModelID string `json:"model_id" binding:"required"`
	Amount  int    `json:"amount"` // 默认自动计算
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

	// 先检查 free 是否需要重置
	now := time.Now()
	if user.PlanTier == "free" {
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

	tier := GetModelTier(req.ModelID)

	// 获取模型成本（单位：分）
	costFen := getModelCostFen(h.db, req.ModelID)
	if req.Amount > 0 {
		costFen = req.Amount // 允许前端指定自定义扣减量
	}

	var creditsField *int
	switch tier {
	case "basic":
		creditsField = &user.BasicCredits
	case "advanced":
		creditsField = &user.AdvancedCredits
	case "elite":
		creditsField = &user.EliteCredits
	}

	quota := dailyQuota[user.PlanTier][tier]
	isUnlimited := quota < 0

	// 内测阶段：如果用户处于内测阶段（beta_phase 非空），只扣内测积分，不扣会员积分
	isInBetaPhase := user.BetaPhase != "" && user.BetaPhase != "completed"

	// 积分限制检查：余额不足时返回 402
	if !isUnlimited && !isInBetaPhase && *creditsField < costFen {
		tierName := GetTierName(tier)
		c.JSON(http.StatusPaymentRequired, gin.H{
			"error":         "积分不足",
			"tier":          tier,
			"tier_name":     tierName,
			"required":      costFen,
			"required_display": float64(costFen) / 100.0,
			"remaining":     *creditsField,
			"remaining_display": float64(*creditsField) / 100.0,
			"upgrade_tip":   "升级套餐以获取更多" + tierName + "积分",
		})
		return
	}

	// 实际扣减积分（单位：分）
	if !isUnlimited && !isInBetaPhase {
		*creditsField -= costFen
	}
	// 内测阶段：也扣内测积分（从 basic_credits 扣，因为内测只有 basic 档位）
	if isInBetaPhase {
		user.BasicCredits -= costFen
		if user.BasicCredits < 0 {
			user.BasicCredits = 0
		}
	}
	user.UpdatedAt = now
	h.db.Save(&user)

	c.JSON(http.StatusOK, gin.H{
		"success":          true,
		"tier":             tier,
		"tier_name":        GetTierName(tier),
		"deducted":         costFen,
		"deducted_display": float64(costFen) / 100.0,
		"basic_credits":    user.BasicCredits,
		"advanced_credits": user.AdvancedCredits,
		"elite_credits":    user.EliteCredits,
		"basic_credits_display":    float64(user.BasicCredits) / 100.0,
		"advanced_credits_display": float64(user.AdvancedCredits) / 100.0,
		"elite_credits_display":    float64(user.EliteCredits) / 100.0,
		"remaining":        *creditsField,
		"remaining_display": float64(*creditsField) / 100.0,
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
				"features": []string{"更多高级空间", "无广告", "优先速度"},
			},
			"ultra": map[string]interface{}{
				"name":     "Ultra",
				"basic":    -1,
				"advanced": 200,
				"elite":    60,
				"features": []string{"无限基础积分", "更多精英空间", "最快速度"},
			},
		},
		"tier_names": map[string]string{
			"basic":    "基础",
			"advanced": "高级",
			"elite":    "精英",
		},
	})
}
