package services

import (
	"bufio"
	"encoding/json"
	"io"
	"strings"
)

// ChatSSEDecoder 解码标准 OpenAI / Claude / DeepSeek / Moonshot 等兼容的 SSE 流。
type ChatSSEDecoder struct {
	scanner *bufio.Scanner
	reader  io.ReadCloser
}

// NewChatSSEDecoder 创建标准聊天 SSE 流解码器。
func NewChatSSEDecoder(body io.ReadCloser) *ChatSSEDecoder {
	return &ChatSSEDecoder{
		scanner: bufio.NewScanner(body),
		reader:  body,
	}
}

// Next 返回下一个解码后的 AIStreamEvent，io.EOF 表示流结束。
func (d *ChatSSEDecoder) Next() (*AIStreamEvent, error) {
	for d.scanner.Scan() {
		line := d.scanner.Text()

		if line == "" {
			continue
		}

		// 处理 "data: [DONE]"
		if line == "data: [DONE]" {
			return &AIStreamEvent{Type: EventDone}, io.EOF
		}

		// 处理 "data: {...}"
		if strings.HasPrefix(line, "data: ") {
			data := line[6:]

			var raw map[string]interface{}
			if err := json.Unmarshal([]byte(data), &raw); err != nil {
				// 某些模型可能返回非 JSON 的 data，跳过
				continue
			}

			return d.parseChoice(raw), nil
		}
	}

	if err := d.scanner.Err(); err != nil {
		return nil, err
	}
	return &AIStreamEvent{Type: EventDone}, io.EOF
}

func (d *ChatSSEDecoder) parseChoice(raw map[string]interface{}) *AIStreamEvent {
	// OpenAI Chat Completions streaming with stream_options.include_usage:
	// The last chunk may have choices=[] and a top-level usage object.
	usage, hasUsage := raw["usage"].(map[string]interface{})
	choices, hasChoices := raw["choices"].([]interface{})

	if hasUsage && len(choices) == 0 {
		// usage-only event (final chunk)
		tu := &TokenUsage{}
		if v, ok := usage["prompt_tokens"].(float64); ok {
			tu.PromptTokens = int(v)
		}
		if v, ok := usage["completion_tokens"].(float64); ok {
			tu.CompletionTokens = int(v)
		}
		if v, ok := usage["total_tokens"].(float64); ok {
			tu.TotalTokens = int(v)
		}
		return &AIStreamEvent{Type: EventUsage, Usage: tu}
	}

	if !hasChoices || len(choices) == 0 {
		return &AIStreamEvent{Type: EventTextDelta, Delta: ""}
	}

	choice, ok := choices[0].(map[string]interface{})
	if !ok {
		return &AIStreamEvent{Type: EventTextDelta, Delta: ""}
	}

	delta, ok := choice["delta"].(map[string]interface{})
	if !ok {
		return &AIStreamEvent{Type: EventTextDelta, Delta: ""}
	}

	// 推理内容（Claude thinking / DeepSeek reasoning_content / Moonshot reasoning_content）
	if reasoning, ok := delta["reasoning_content"].(string); ok && reasoning != "" {
		return &AIStreamEvent{Type: EventReasoningDelta, Delta: reasoning}
	}

	// 普通文本内容
	if content, ok := delta["content"].(string); ok {
		return &AIStreamEvent{Type: EventTextDelta, Delta: content}
	}

	// Claude thinking 字段（某些版本的 SDK 可能用 thinking）
	if thinking, ok := delta["thinking"].(string); ok && thinking != "" {
		return &AIStreamEvent{Type: EventReasoningDelta, Delta: thinking}
	}

	return &AIStreamEvent{Type: EventTextDelta, Delta: ""}
}
