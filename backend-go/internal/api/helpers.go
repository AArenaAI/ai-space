package api

import "github.com/gin-gonic/gin"

// getUserID 安全从 gin.Context 获取 userID，兼容 uint 和 float64 类型
func getUserID(c *gin.Context) uint {
	val, exists := c.Get("userID")
	if !exists {
		return 0
	}
	switch v := val.(type) {
	case uint:
		return v
	case float64:
		return uint(v)
	case int:
		return uint(v)
	case int64:
		return uint(v)
	default:
		return 0
	}
}
