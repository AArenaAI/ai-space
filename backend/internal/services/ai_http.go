package services

import (
	"net"
	"net/http"
	"time"
)

// DefaultAIHTTPClient 是用于调用外部 AI API 的默认 HTTP 客户端。
// 它配置了合理的超时和连接池参数，避免无限制等待和资源泄漏。
var DefaultAIHTTPClient = &http.Client{
	Transport: &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     120 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	},
	// 整体请求超时由调用方通过 context.WithTimeout 控制，
	// 这里不设置全局 Client.Timeout，以支持流式长连接。
}
