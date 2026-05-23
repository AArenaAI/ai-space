package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ipLimiter 单个 IP 的滑动窗口限流状态。
type ipLimiter struct {
	tokens    int
	lastCheck time.Time
}

// IPRateLimiter 基于 IP 的滑动窗口限流器。
type IPRateLimiter struct {
	mu          sync.RWMutex
	clients     map[string]*ipLimiter
	window      time.Duration // 时间窗口
	maxRequests int           // 窗口内最大请求数
}

// NewIPRateLimiter 创建 IP 限流器，默认 1 分钟 60 请求。
func NewIPRateLimiter() *IPRateLimiter {
	return &IPRateLimiter{
		clients:     make(map[string]*ipLimiter),
		window:      time.Minute,
		maxRequests: 60,
	}
}

// Allow 判断指定 IP 是否允许请求。
func (rl *IPRateLimiter) Allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	client, exists := rl.clients[ip]
	if !exists {
		rl.clients[ip] = &ipLimiter{tokens: rl.maxRequests - 1, lastCheck: now}
		return true
	}

	// 滑动窗口补充 token
	elapsed := now.Sub(client.lastCheck)
	if elapsed >= rl.window {
		client.tokens = rl.maxRequests
	} else {
		// 线性补充
		addTokens := int(elapsed.Seconds()) * rl.maxRequests / int(rl.window.Seconds())
		if addTokens > 0 {
			client.tokens += addTokens
			if client.tokens > rl.maxRequests {
				client.tokens = rl.maxRequests
			}
		}
	}
	client.lastCheck = now

	if client.tokens > 0 {
		client.tokens--
		return true
	}
	return false
}

// RateLimitMiddleware gin 中间件：限制每个 IP 的请求速率。
func RateLimitMiddleware() gin.HandlerFunc {
	limiter := NewIPRateLimiter()
	return func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/images/file/") {
			c.Next()
			return
		}

		ip := c.ClientIP()
		if !limiter.Allow(ip) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "请求过于频繁，请稍后再试"})
			c.Abort()
			return
		}
		c.Next()
	}
}
