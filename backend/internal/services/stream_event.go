package services

import "io"

// AIStreamEventType 表示统一流事件类型。
type AIStreamEventType string

const (
	EventTextDelta      AIStreamEventType = "text_delta"
	EventReasoningDelta AIStreamEventType = "reasoning_delta"
	EventSearchStart    AIStreamEventType = "search_start"
	EventSearchDone     AIStreamEventType = "search_done"
	EventError          AIStreamEventType = "error"
	EventDone           AIStreamEventType = "done"
)

// AIStreamEvent 是统一流事件结构，所有模型响应都解码为此格式。
type AIStreamEvent struct {
	Type  AIStreamEventType
	Delta string // 文本/推理/搜索提示增量
	Index int    // 搜索步骤索引（EventSearchStart 使用）
	// Error 专用字段
	Code    string // 错误代码（如 rate_limit_exceeded）
	Message string // 错误信息
}

// AICompletionResponse 是 ChatCompletion 的统一返回结构。
type AICompletionResponse struct {
	Body      io.ReadCloser
	ModelType string // "openai_responses" | "anthropic" | "gemini" | "deepseek" | "moonshot" | "unknown"
}
