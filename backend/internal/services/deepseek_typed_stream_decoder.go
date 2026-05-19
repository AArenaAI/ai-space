package services

import (
	"encoding/json"
	"fmt"
	"io"

	openai "github.com/openai/openai-go"
	"github.com/openai/openai-go/packages/ssestream"
)

type deepSeekSDKStreamBody struct {
	stream *ssestream.Stream[openai.ChatCompletionChunk]
}

func (b deepSeekSDKStreamBody) Read(_ []byte) (int, error) { return 0, io.EOF }
func (b deepSeekSDKStreamBody) Close() error {
	if b.stream == nil {
		return nil
	}
	return b.stream.Close()
}

// DeepSeekTypedStreamDecoder 基于 openai-go 的 typed chat completion stream。
// DeepSeek 的 reasoning_content 是兼容接口扩展字段，不在 OpenAI typed struct 内，
// 这里从 Delta.JSON.ExtraFields 读取，避免整包手写 raw body。
type DeepSeekTypedStreamDecoder struct {
	stream         *ssestream.Stream[openai.ChatCompletionChunk]
	eventCount     int
	textEvents     int
	textChars      int
	reasoningChars int
	doneEmitted    bool
}

func NewDeepSeekTypedStreamDecoder(stream *ssestream.Stream[openai.ChatCompletionChunk]) *DeepSeekTypedStreamDecoder {
	return &DeepSeekTypedStreamDecoder{stream: stream}
}

func (d *DeepSeekTypedStreamDecoder) Next() (*AIStreamEvent, error) {
	if d.stream == nil {
		return nil, fmt.Errorf("DeepSeek typed stream 为空")
	}
	if d.doneEmitted {
		return nil, io.EOF
	}

	for d.stream.Next() {
		chunk := d.stream.Current()
		d.eventCount++

		if chunk.Usage.PromptTokens > 0 || chunk.Usage.CompletionTokens > 0 || chunk.Usage.TotalTokens > 0 {
			usage := &TokenUsage{
				PromptTokens:     int(chunk.Usage.PromptTokens),
				CompletionTokens: int(chunk.Usage.CompletionTokens),
				TotalTokens:      int(chunk.Usage.TotalTokens),
			}
			fmt.Printf("[DeepSeek SDK Stream] usage input=%d output=%d total=%d events=%d text_events=%d text_chars=%d reasoning_chars=%d\n",
				usage.PromptTokens,
				usage.CompletionTokens,
				usage.TotalTokens,
				d.eventCount,
				d.textEvents,
				d.textChars,
				d.reasoningChars,
			)
			return &AIStreamEvent{Type: EventUsage, Usage: usage}, nil
		}

		for _, choice := range chunk.Choices {
			if reasoning := deepSeekReasoningContent(choice.Delta); reasoning != "" {
				d.reasoningChars += len([]rune(reasoning))
				return &AIStreamEvent{Type: EventReasoningDelta, Delta: reasoning}, nil
			}
			if choice.Delta.Content != "" {
				d.textEvents++
				d.textChars += len([]rune(choice.Delta.Content))
				return &AIStreamEvent{Type: EventTextDelta, Delta: choice.Delta.Content}, nil
			}
		}
	}

	if err := d.stream.Err(); err != nil {
		return nil, err
	}
	fmt.Printf("[DeepSeek SDK Stream] eof events=%d text_events=%d text_chars=%d reasoning_chars=%d\n", d.eventCount, d.textEvents, d.textChars, d.reasoningChars)
	d.doneEmitted = true
	return &AIStreamEvent{Type: EventDone}, nil
}

func deepSeekReasoningContent(delta openai.ChatCompletionChunkChoiceDelta) string {
	if delta.JSON.ExtraFields == nil {
		return ""
	}
	field, ok := delta.JSON.ExtraFields["reasoning_content"]
	if !ok || !field.Valid() {
		return ""
	}
	var reasoning string
	if err := json.Unmarshal([]byte(field.Raw()), &reasoning); err != nil {
		return ""
	}
	return reasoning
}
