package services

import "io"

// AIStreamEventType 表示统一流事件类型。
type AIStreamEventType string

const (
	EventTextDelta       AIStreamEventType = "text_delta"
	EventReasoningDelta  AIStreamEventType = "reasoning_delta"
	EventSearchStart     AIStreamEventType = "search_start"
	EventSearchDone      AIStreamEventType = "search_done"
	EventFileSearchStart AIStreamEventType = "file_search_start"
	EventFileSearchDone  AIStreamEventType = "file_search_done"
	EventToolCallStart   AIStreamEventType = "tool_call_start"
	EventToolCallDone    AIStreamEventType = "tool_call_done"
	EventResponseCreated AIStreamEventType = "response_created"
	EventUsage           AIStreamEventType = "usage"
	EventError           AIStreamEventType = "error"
	EventDone            AIStreamEventType = "done"
)

// AIStreamEvent 是统一流事件结构，所有模型响应都解码为此格式。
type AIStreamEvent struct {
	Type             AIStreamEventType
	Delta            string      // 文本/推理/状态提示增量
	Index            int         // 工具/搜索步骤索引
	Usage            *TokenUsage // usage 信息（EventUsage 使用）
	Code             string      // 错误代码（如 rate_limit_exceeded）
	Message          string      // 错误信息
	ResponseID       string      // OpenAI Responses id（background stream 续流/webhook 映射）
	SequenceNumber   int64       // OpenAI stream cursor，用于断线续流
	Recoverable      bool        // 错误是否可恢复/可重试
	RetryAfterMs     int         // 建议等待毫秒数
	ErrorKind        string      // rate_limit / quota / upstream_error
	Provider         string      // provider 名称
	Model            string      // 模型名称
	LimitType        string      // tokens_per_minute / requests_per_minute
	LimitTokens      int         // 限额
	UsedTokens       int         // 已用预算
	RequestedTokens  int         // 本次请求预算
	SuggestedActions []string    // retry_after / switch_model / reduce_output_tokens
}

// AICompletionResponse 是 ChatCompletion 的统一返回结构。
type AICompletionResponse struct {
	Body      io.ReadCloser
	Decoder   StreamDecoder // 可选：SDK typed stream decoder；为空时由 Body + ModelType 创建 decoder。
	ModelType string        // "openai_responses" | "anthropic" | "gemini" | "deepseek" | "moonshot" | "unknown"
	Provider  string        // provider 名称，用于记录 usage
	Model     string        // 模型名称，用于记录 usage
	// Background 表示 Responses API background=true 任务。
	// 此时 Body 是任务创建响应，不是最终答案；调用方应保存 response id，等待 webhook 回调后 retrieve。
	Background bool
}
