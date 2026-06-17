package api

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

// ModelPrice 模型定价条目
type ModelPrice struct {
	Provider                    string             `json:"provider"`
	Model                       string             `json:"model"`
	PricingUnit                 string             `json:"pricing_unit"`
	SourceCurrency              string             `json:"source_currency"`
	SourceUnit                  string             `json:"source_unit"`
	SourceInputPrice            float64            `json:"source_input_price,omitempty"`
	SourceOutputPrice           float64            `json:"source_output_price,omitempty"`
	SourceInputCacheHitPrice    float64            `json:"source_input_cache_hit_price,omitempty"`
	SourceInputCacheMissPrice   float64            `json:"source_input_cache_miss_price,omitempty"`
	SourceImageInputPrice       float64            `json:"source_image_input_price,omitempty"`
	SourceImageInputCacheHitPrice float64          `json:"source_image_input_cache_hit_price,omitempty"`
	VideoPricingRules           []VideoPricingRule `json:"video_pricing_rules,omitempty"`
	ContextWindowTokens         int                `json:"context_window_tokens,omitempty"`
	PricingBasis                string             `json:"pricing_basis"`
	SourceURL                   string             `json:"source_url"`
}

// VideoPricingRule 视频定价规则
type VideoPricingRule struct {
	Resolution         string  `json:"resolution"`
	InputContainsVideo bool    `json:"input_contains_video"`
	SourceOutputPrice  float64 `json:"source_output_price"`
	PricingBasis       string  `json:"pricing_basis"`
}

// ModelPriceHandler 模型定价处理器
type ModelPriceHandler struct {
	configPath string
}

// NewModelPriceHandler 创建 ModelPriceHandler
func NewModelPriceHandler(configPath string) *ModelPriceHandler {
	return &ModelPriceHandler{configPath: configPath}
}

// ListModelPrices 获取模型定价列表
func (h *ModelPriceHandler) ListModelPrices(c *gin.Context) {
	// 尝试多个路径
	paths := []string{
		h.configPath,
		"./config/model-prices.json",
		"../config/model-prices.json",
		"../../config/model-prices.json",
		"/home/ubuntu/workspace/ai-space/backend/config/model-prices.json",
	}
	
	var data []byte
	var err error
	for _, p := range paths {
		data, err = os.ReadFile(p)
		if err == nil {
			break
		}
	}
	
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取定价配置失败: " + err.Error()})
		return
	}

	var prices []ModelPrice
	if err := json.Unmarshal(data, &prices); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "解析定价配置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"prices": prices})
}
