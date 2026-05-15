package services

import "io"

// StreamDecoder 是统一流解码器接口，将各模型的 SSE 流解码为 AIStreamEvent。
type StreamDecoder interface {
	Next() (*AIStreamEvent, error)
}

// NewDecoder 根据模型类型创建对应的流解码器。
func NewDecoder(modelType string, body io.ReadCloser) StreamDecoder {
	switch modelType {
	case "openai_responses":
		return NewOpenAIResponsesDecoder(body)
	case "anthropic", "deepseek", "moonshot":
		// Claude / DeepSeek / Moonshot 都是标准 OpenAI 兼容 SSE 格式
		return NewChatSSEDecoder(body)
	default:
		// 未知模型也尝试用标准 SSE 解码
		return NewChatSSEDecoder(body)
	}
}
