package api

import (
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ExchangeRateHandler 汇率处理器
type ExchangeRateHandler struct{}

// NewExchangeRateHandler 创建 ExchangeRateHandler
func NewExchangeRateHandler() *ExchangeRateHandler {
	return &ExchangeRateHandler{}
}

// GetExchangeRate 获取 USD 到 CNY 的汇率
func (h *ExchangeRateHandler) GetExchangeRate(c *gin.Context) {
	rate := fetchUSDCNYRate()
	c.JSON(http.StatusOK, gin.H{
		"usd_to_cny": rate,
		"updated_at": time.Now().Format(time.RFC3339),
	})
}

func fetchUSDCNYRate() float64 {
	// 优先使用环境变量覆盖
	if override := strings.TrimSpace(os.Getenv("USD_CNY_RATE")); override != "" {
		if rate, err := strconv.ParseFloat(override, 64); err == nil && rate > 0 {
			return rate
		}
	}
	// 默认回退汇率
	if fallback := strings.TrimSpace(os.Getenv("USD_CNY_FALLBACK")); fallback != "" {
		if rate, err := strconv.ParseFloat(fallback, 64); err == nil && rate > 0 {
			return rate
		}
	}
	return 7.2 // 默认汇率
}
