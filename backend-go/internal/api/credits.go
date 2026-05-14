package api

import (
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
	"gpt-5.4-mini":       "basic",
	"deepseek-v4-flash":  "basic",
	"gemini-2.0-flash-exp": "basic",

	// 高级等级
	"gpt-5.4":                   "advanced",
	"gpt-5.5":                   "advanced",
	"claude-3-5-sonnet-20241022": "advanced",
	"moonshot-v1-8k":            "advanced",

	// 精英等级
	"gpt-5.5-pro":      "elite",
	"deepseek-v4-pro":  "elite",
	"deepseek-reasoner": "elite",
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
		"basic_credits":     user.BasicCredits,
		"advanced_credits":  user.AdvancedCredits,
		"elite_credits":     user.EliteCredits,
		"plan_tier":         user.PlanTier,
		"credits_reset_at":  user.CreditsResetAt.Format(time.RFC3339),
		"daily_quota":       dailyQuota[user.PlanTier],
		"tier_names": map[string]string{
			"basic":    "基础",
			"advanced": "高级",
			"elite":    "精英",
		},
	})
}

// DeductRequest 扣减积分请求
type DeductRequest struct {
	ModelID string `json:"model_id" binding:"required"`
	Amount  int    `json:"amount"` // 默认扣 1 点
}

// DeductCredits 扣减积分
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
	if req.Amount <= 0 {
		req.Amount = 1
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
	_ = isUnlimited // 暂时避免未使用报错，恢复积分限制时删除此行

	// 【积分限制已临时取消】保留检查逻辑但永远通过
	// 如需恢复积分限制，取消下面注释：
	/*
	if !isUnlimited && *creditsField < req.Amount {
		tierName := GetTierName(tier)
		c.JSON(http.StatusPaymentRequired, gin.H{
			"error":         "积分不足",
			"tier":          tier,
			"tier_name":     tierName,
			"required":      req.Amount,
			"remaining":     *creditsField,
			"upgrade_tip":   "升级套餐以获取更多" + tierName + "积分",
		})
		return
	}
	*/

	// 扣减积分已临时取消 — 保留数据但不实际扣减
	// 如需恢复积分扣减，取消下面注释：
	/*
	if !isUnlimited {
		*creditsField -= req.Amount
	}
	*/
	user.UpdatedAt = now
	h.db.Save(&user)

	c.JSON(http.StatusOK, gin.H{
		"success":          true,
		"tier":             tier,
		"tier_name":        GetTierName(tier),
		"deducted":         req.Amount,
		"basic_credits":    user.BasicCredits,
		"advanced_credits": user.AdvancedCredits,
		"elite_credits":    user.EliteCredits,
		"remaining":        *creditsField,
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
