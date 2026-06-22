package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// BetaConfigHandler 内测运营配置管理
type BetaConfigHandler struct {
	db *gorm.DB
}

// NewBetaConfigHandler 创建 BetaConfigHandler
func NewBetaConfigHandler(db *gorm.DB) *BetaConfigHandler {
	return &BetaConfigHandler{db: db}
}

// InitDefaultConfigs 初始化默认配置
func (h *BetaConfigHandler) InitDefaultConfigs() {
	defaults := []models.BetaConfig{
		{Key: models.BetaConfigPhase1Credits, Value: "5000", Desc: "试探期额度（单位：分，1积分=100分）"},
		{Key: models.BetaConfigPhase2Credits, Value: "15000", Desc: "深水区额度（单位：分）"},
		{Key: models.BetaConfigPhase3Credits, Value: "10000", Desc: "枯竭期额度（单位：分）"},
		{Key: models.BetaConfigModelCosts, Value: `{"chat-1":2200,"gpt-5.5-pro":2200,"gpt-5.5":50,"kimi-k2.6":50,"kimi-k2.5":50,"deepseek-v4-pro":50,"deepseek-v4-flash":1,"gemini-3.1-flash-lite":1,"gpt-image-2":100,"gemini-2.5-pro":20,"doubao-seedance-2-0-260128":150,"doubao-seedance-2-0-fast-260128":50,"gpt-5.4-mini":1,"gemini-2.0-flash-exp":1,"gemini-3.5-flash":1,"gpt-5.4":50,"claude-3-5-sonnet-20241022":50,"gemini-3.1-pro-preview":50,"google-cloud-translate-v3:general/translation-llm":1,"gemini-3.5-live-translate-preview":1}`, Desc: "内测模型成本（单位：分；1 Credit=1元=100分；视频模型为每秒成本）"},
		{Key: models.BetaConfigEndDate, Value: "", Desc: "内测截止时间（RFC3339，空=不过期；到期后停止新申请/激活/发额度）"},
	}

	for _, cfg := range defaults {
		var existing models.BetaConfig
		if err := h.db.Where("key = ?", cfg.Key).First(&existing).Error; err != nil {
			// 配置不存在，创建新配置
			h.db.Create(&cfg)
		} else {
			// 配置已存在，更新值（保留描述）
			h.db.Model(&existing).Update("value", cfg.Value)
		}
	}
}

// GetConfig 获取单个配置
func (h *BetaConfigHandler) GetConfig(key string) (string, error) {
	var cfg models.BetaConfig
	if err := h.db.Where("key = ?", key).First(&cfg).Error; err != nil {
		return "", err
	}
	return cfg.Value, nil
}

// GetConfigInt 获取配置值为整数（分）
func (h *BetaConfigHandler) GetConfigInt(key string, defaultVal int) int {
	val, err := h.GetConfig(key)
	if err != nil {
		return defaultVal
	}
	parsed, err := strconv.Atoi(val)
	if err != nil {
		return defaultVal
	}
	return parsed
}

// GetModelCosts 获取模型成本配置
func (h *BetaConfigHandler) GetModelCosts() map[string]int {
	val, err := h.GetConfig(models.BetaConfigModelCosts)
	if err != nil {
		return h.getDefaultModelCosts()
	}
	var costs map[string]int
	if err := json.Unmarshal([]byte(val), &costs); err != nil {
		return h.getDefaultModelCosts()
	}
	return costs
}

// GetModelCost 获取单个模型成本
func (h *BetaConfigHandler) GetModelCost(modelID string) int {
	costs := h.GetModelCosts()
	if cost, ok := costs[modelID]; ok {
		return cost
	}
	return 100 // 默认 1.00 积分
}

// getDefaultModelCosts 默认模型成本
func (h *BetaConfigHandler) getDefaultModelCosts() map[string]int {
	return map[string]int{
		"chat-1":                          2200,
		"gpt-5.5-pro":                     2200,
		"gpt-5.5":                         50,
		"kimi-k2.6":                       50,
		"kimi-k2.5":                       50,
		"deepseek-v4-pro":                 50,
		"deepseek-v4-flash":               1,
		"gemini-3.1-flash-lite":           1,
		"gpt-image-2":                     100,
		"gemini-2.5-pro":                  20,
		"doubao-seedance-2.0-mini":        50,
		"doubao-seedance-1.5-pro":         150,
		"doubao-seedance-1.0-pro":         150,
		"doubao-seedance-1.0-pro-fast":    50,
		"doubao-seedance-2-0-260128":      150,
		"doubao-seedance-2-0-pro-260128":  150,
		"doubao-seedance-2-0-fast-260128": 50,
		"gpt-5.4-mini":                    1,
		"gemini-2.0-flash-exp":            1,
		"gemini-3.5-flash":                1,
		"gpt-5.4":                         50,
		"claude-3-5-sonnet-20241022":      50,
		"gemini-3.1-pro-preview":          50,
		"google-cloud-translate-v3:general/translation-llm": 1,
		"gemini-3.5-live-translate-preview":                 1,
	}
}

// GetPhaseCredits 获取三阶段额度（单位：分）
func (h *BetaConfigHandler) GetPhaseCredits() (phase1, phase2, phase3 int) {
	return h.GetConfigInt(models.BetaConfigPhase1Credits, 5000),
		h.GetConfigInt(models.BetaConfigPhase2Credits, 15000),
		h.GetConfigInt(models.BetaConfigPhase3Credits, 10000)
}

// GetEndDate 获取内测截止时间，空串返回零值
func (h *BetaConfigHandler) GetEndDate() time.Time {
	val, err := h.GetConfig(models.BetaConfigEndDate)
	if err != nil || val == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, val)
	if err != nil {
		return time.Time{}
	}
	return t
}

// IsBetaExpired 判断内测是否已过期（空配置=不过期）
func (h *BetaConfigHandler) IsBetaExpired() bool {
	end := h.GetEndDate()
	if end.IsZero() {
		return false
	}
	return time.Now().After(end)
}

// ========== HTTP API ==========

// ListConfigs 获取所有配置（管理员）
func (h *BetaConfigHandler) ListConfigs(c *gin.Context) {
	var configs []models.BetaConfig
	if err := h.db.Order("key ASC").Find(&configs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	// 对模型成本配置做格式化
	var result []gin.H
	for _, cfg := range configs {
		item := gin.H{
			"id":         cfg.ID,
			"key":        cfg.Key,
			"value":      cfg.Value,
			"desc":       cfg.Desc,
			"updated_at": cfg.UpdatedAt,
		}
		if cfg.Key == models.BetaConfigModelCosts {
			var costs map[string]int
			if err := json.Unmarshal([]byte(cfg.Value), &costs); err == nil {
				item["parsed_value"] = costs
			}
		} else if cfg.Key == models.BetaConfigPhase1Credits ||
			cfg.Key == models.BetaConfigPhase2Credits ||
			cfg.Key == models.BetaConfigPhase3Credits {
			if v, err := strconv.Atoi(cfg.Value); err == nil {
				item["parsed_value"] = map[string]interface{}{
					"fen":     v,
					"credits": float64(v) / 100.0,
				}
			}
		}
		result = append(result, item)
	}

	c.JSON(http.StatusOK, gin.H{"items": result})
}

// UpdateConfigRequest 更新配置请求（Value 为空表示清空 end_date）
type UpdateConfigRequest struct {
	Value string `json:"value"`
	Desc  string `json:"desc"`
}

// UpdateConfig 更新配置（管理员）
func (h *BetaConfigHandler) UpdateConfig(c *gin.Context) {
	key := c.Param("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "配置键不能为空"})
		return
	}

	var req UpdateConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	adminID, _ := c.Get("userID")

	// 验证配置值格式
	switch key {
	case models.BetaConfigPhase1Credits, models.BetaConfigPhase2Credits, models.BetaConfigPhase3Credits:
		if _, err := strconv.Atoi(req.Value); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "额度必须是整数（单位：分）"})
			return
		}
	case models.BetaConfigModelCosts:
		var costs map[string]int
		if err := json.Unmarshal([]byte(req.Value), &costs); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "模型成本必须是有效的 JSON 对象，格式：{\"model-id\": 分}"})
			return
		}
	case models.BetaConfigEndDate:
		// 空字符串=不过期；非空必须可解析为 RFC3339
		if req.Value != "" {
			if _, err := time.Parse(time.RFC3339, req.Value); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "截止时间必须是 RFC3339 格式，例如 2026-08-31T23:59:59+08:00"})
				return
			}
		}
	}

	var cfg models.BetaConfig
	if err := h.db.Where("key = ?", key).First(&cfg).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "配置不存在"})
		return
	}

	updates := map[string]interface{}{
		"value":      req.Value,
		"updated_by": adminID,
	}
	if req.Desc != "" {
		updates["desc"] = req.Desc
	}

	if err := h.db.Model(&cfg).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"key":     key,
		"value":   req.Value,
		"message": "配置已更新",
	})
}

// GetPublicConfig 获取公开配置（用户可见）
func (h *BetaConfigHandler) GetPublicConfig(c *gin.Context) {
	phase1, phase2, phase3 := h.GetPhaseCredits()
	costs := h.GetModelCosts()

	// 转换为显示单位（积分）
	costsDisplay := make(map[string]float64)
	for k, v := range costs {
		costsDisplay[k] = float64(v) / 100.0
	}

	c.JSON(http.StatusOK, gin.H{
		"phases": map[string]interface{}{
			"phase_1": map[string]interface{}{"fen": phase1, "credits": float64(phase1) / 100.0},
			"phase_2": map[string]interface{}{"fen": phase2, "credits": float64(phase2) / 100.0},
			"phase_3": map[string]interface{}{"fen": phase3, "credits": float64(phase3) / 100.0},
		},
		"model_costs":     costsDisplay,
		"model_costs_fen": costs,
		"batch_model_rules": map[string]interface{}{
			"batch-1": map[string]interface{}{"blocked_models": []string{"gpt-image-2", "doubao-seedance-2.0-mini", "doubao-seedance-1.5-pro", "doubao-seedance-1.0-pro", "doubao-seedance-1.0-pro-fast", "doubao-seedance-2-0-260128", "doubao-seedance-2-0-pro-260128", "doubao-seedance-2-0-fast-260128"}, "message": "第一批文本逻辑专场：关闭 Image 1 与 Seedance 视频模型"},
			"batch-2": map[string]interface{}{"blocked_models": []string{"chat-1", "gpt-5.5-pro"}, "message": "第二批图像与多模态专场：锁死 Chat 1"},
			"batch-3": map[string]interface{}{"blocked_models": []string{}, "message": "第三批综合极限抗压：模型全开"},
		},
		"unit": "1 Credit = 1 元人民币 = 100 分",
		"beta_end_date": func() string {
			t := h.GetEndDate()
			if t.IsZero() {
				return ""
			}
			return t.Format(time.RFC3339)
		}(),
		"beta_expired": h.IsBetaExpired(),
	})
}
