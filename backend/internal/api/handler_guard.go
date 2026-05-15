package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

// HandlerGuard 是全局 panic 恢复与统一错误处理中间件。
// 在任何 handler 发生 panic 时抓住错误，返回 500 并打印日志，避免服务器崩溃。
func HandlerGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("[PANIC] %s %s: %v\n", c.Request.Method, c.Request.URL.Path, r)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器内部错误"})
				c.Abort()
			}
		}()
		c.Next()
	}
}
