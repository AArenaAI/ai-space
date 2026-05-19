package services

import (
	"fmt"
	"io"
)

// StreamDecoder 是统一流解码器接口，将各模型的 SSE 流解码为 AIStreamEvent。
type StreamDecoder interface {
	Next() (*AIStreamEvent, error)
}

// NewDecoder 根据模型类型创建对应的流解码器。
func NewDecoder(modelType string, body io.ReadCloser) StreamDecoder {
	switch modelType {
	case "openai_responses":
		return errorStreamDecoder{err: fmt.Errorf("OpenAI Responses 流必须使用官方 SDK typed decoder，禁止回退到原生 HTTP SSE decoder")}
	case "anthropic", "deepseek", "moonshot":
		// Claude / DeepSeek / Moonshot 都是标准 OpenAI 兼容 SSE 格式
		return NewChatSSEDecoder(body)
	case "gemini":
		return NewGeminiDecoder(body)
	default:
		// 未知模型也尝试用标准 SSE 解码
		return NewChatSSEDecoder(body)
	}
}

type errorStreamDecoder struct {
	err error
}

func (d errorStreamDecoder) Next() (*AIStreamEvent, error) {
	return nil, d.err
}
