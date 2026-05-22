package services

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type deepSeekSSEChunk struct {
	ID      string                   `json:"id"`
	Choices []deepSeekSSEChunkChoice `json:"choices"`
	Usage   *deepSeekSSEChunkUsage   `json:"usage"`
	Created int64                    `json:"created"`
	Model   string                   `json:"model"`
	Object  string                   `json:"object"`
}

type deepSeekSSEChunkChoice struct {
	Delta struct {
		Content          string `json:"content"`
		ReasoningContent string `json:"reasoning_content"`
		Role             string `json:"role"`
	} `json:"delta"`
	FinishReason string      `json:"finish_reason"`
	Index        int         `json:"index"`
	Logprobs     interface{} `json:"logprobs"`
}

type deepSeekSSEChunkUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// DeepSeekTypedStreamDecoder 手动解析 DeepSeek SSE 流，跳过空 data 事件，
// 避免 openai-go SDK 的 ssestream 在遇到空 data 行时 fatal error 终止整流。
type DeepSeekTypedStreamDecoder struct {
	scanner        *bufio.Scanner
	body           io.ReadCloser
	eventCount     int
	textEvents     int
	textChars      int
	reasoningChars int
	doneEmitted    bool
}

func NewDeepSeekTypedStreamDecoder(body io.ReadCloser) *DeepSeekTypedStreamDecoder {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(nil, bufio.MaxScanTokenSize<<9)
	return &DeepSeekTypedStreamDecoder{scanner: scanner, body: body}
}

func (d *DeepSeekTypedStreamDecoder) Next() (*AIStreamEvent, error) {
	if d.doneEmitted {
		return nil, io.EOF
	}
	if d.scanner == nil {
		return nil, fmt.Errorf("DeepSeek stream scanner 为空")
	}

	var dataBuf strings.Builder

	for d.scanner.Scan() {
		line := d.scanner.Bytes()

		// 空行：dispatch 当前事件
		if len(line) == 0 {
			data := strings.TrimSpace(dataBuf.String())
			if data == "" {
				// 空 data，跳过，继续读下一个事件
				dataBuf.Reset()
				continue
			}
			if data == "[DONE]" {
				d.doneEmitted = true
				return &AIStreamEvent{Type: EventDone}, nil
			}

			d.eventCount++
			var chunk deepSeekSSEChunk
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				fmt.Printf("[DeepSeek SDK Stream] json unmarshal err=%v raw=%q, skip this event\n", err, data)
				dataBuf.Reset()
				continue
			}

			if chunk.Usage != nil && (chunk.Usage.PromptTokens > 0 || chunk.Usage.CompletionTokens > 0 || chunk.Usage.TotalTokens > 0) {
				usage := &TokenUsage{
					PromptTokens:     chunk.Usage.PromptTokens,
					CompletionTokens: chunk.Usage.CompletionTokens,
					TotalTokens:      chunk.Usage.TotalTokens,
				}
				fmt.Printf("[DeepSeek SDK Stream] usage input=%d output=%d total=%d events=%d text_events=%d text_chars=%d reasoning_chars=%d\n",
					usage.PromptTokens, usage.CompletionTokens, usage.TotalTokens,
					d.eventCount, d.textEvents, d.textChars, d.reasoningChars)
				return &AIStreamEvent{Type: EventUsage, Usage: usage}, nil
			}

			for _, choice := range chunk.Choices {
				if reasoning := choice.Delta.ReasoningContent; reasoning != "" {
					d.reasoningChars += len([]rune(reasoning))
					return &AIStreamEvent{Type: EventReasoningDelta, Delta: reasoning}, nil
				}
				if choice.Delta.Content != "" {
					d.textEvents++
					d.textChars += len([]rune(choice.Delta.Content))
					return &AIStreamEvent{Type: EventTextDelta, Delta: choice.Delta.Content}, nil
				}
			}

			// 当前 chunk 没有有效内容（如 content="" 的空 delta），继续读下一个
			dataBuf.Reset()
			continue
		}

		// 解析 SSE 字段
		name, value, found := bytes.Cut(line, []byte(":"))
		if !found {
			continue
		}
		if len(value) > 0 && value[0] == ' ' {
			value = value[1:]
		}

		switch string(name) {
		case "data":
			dataBuf.Write(value)
			dataBuf.WriteByte('\n')
		}
	}

	if err := d.scanner.Err(); err != nil {
		return nil, err
	}

	// 流正常结束（scanner 读到 EOF）
	fmt.Printf("[DeepSeek SDK Stream] eof events=%d text_events=%d text_chars=%d reasoning_chars=%d\n",
		d.eventCount, d.textEvents, d.textChars, d.reasoningChars)
	d.doneEmitted = true
	return &AIStreamEvent{Type: EventDone}, nil
}

func (d *DeepSeekTypedStreamDecoder) Close() error {
	if d.body == nil {
		return nil
	}
	err := d.body.Close()
	d.body = nil
	return err
}
