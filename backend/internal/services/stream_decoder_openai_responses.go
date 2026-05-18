package services

import (
	"bufio"
	"encoding/json"
	"io"
	"strings"
)

// OpenAIResponsesDecoder 解码 OpenAI Responses API 的 SSE 流。
type OpenAIResponsesDecoder struct {
	scanner *bufio.Scanner
	reader  io.ReadCloser
}

// NewOpenAIResponsesDecoder 创建 OpenAI Responses 流解码器。
func NewOpenAIResponsesDecoder(body io.ReadCloser) *OpenAIResponsesDecoder {
	return &OpenAIResponsesDecoder{
		scanner: bufio.NewScanner(body),
		reader:  body,
	}
}

// Next 返回下一个解码后的 AIStreamEvent，io.EOF 表示流结束。
func (d *OpenAIResponsesDecoder) Next() (*AIStreamEvent, error) {
	var eventName string
	for d.scanner.Scan() {
		line := d.scanner.Text()

		// 空行表示事件结束
		if line == "" {
			continue
		}

		// 解析 event 行: "event: xxx"
		if strings.HasPrefix(line, "event: ") {
			eventName = strings.TrimSpace(line[7:])
			continue
		}

		// 解析 data 行: "data: {...}"
		if strings.HasPrefix(line, "data: ") {
			data := line[6:]
			if data == "[DONE]" {
				return &AIStreamEvent{Type: EventDone}, io.EOF
			}

			var raw map[string]interface{}
			if err := json.Unmarshal([]byte(data), &raw); err != nil {
				return nil, err
			}

			return d.parseEvent(eventName, raw), nil
		}
	}

	if err := d.scanner.Err(); err != nil {
		return nil, err
	}
	return &AIStreamEvent{Type: EventDone}, io.EOF
}

func (d *OpenAIResponsesDecoder) parseEvent(name string, raw map[string]interface{}) *AIStreamEvent {
	switch name {
	case "response.output_text.delta":
		if delta, ok := raw["delta"].(string); ok {
			return &AIStreamEvent{Type: EventTextDelta, Delta: delta}
		}
	case "response.reasoning_item.delta":
		if delta, ok := raw["delta"].(string); ok {
			return &AIStreamEvent{Type: EventReasoningDelta, Delta: delta}
		}
	case "response.web_search_call.in_progress":
		return &AIStreamEvent{Type: EventSearchStart, Delta: "正在搜索..."}
	case "response.web_search_call.completed":
		return &AIStreamEvent{Type: EventSearchDone, Delta: "搜索完成"}
	case "response.completed":
		// usage 信息在 response.completed 事件中
		if resp, ok := raw["response"].(map[string]interface{}); ok {
			if usage, ok := resp["usage"].(map[string]interface{}); ok {
				tu := &TokenUsage{}
				if v, ok := usage["input_tokens"].(float64); ok {
					tu.PromptTokens = int(v)
				}
				if v, ok := usage["output_tokens"].(float64); ok {
					tu.CompletionTokens = int(v)
				}
				if v, ok := usage["total_tokens"].(float64); ok {
					tu.TotalTokens = int(v)
				}
				return &AIStreamEvent{Type: EventUsage, Usage: tu}
			}
		}
	case "error":
		msg := "unknown error"
		if m, ok := raw["message"].(string); ok {
			msg = m
		}
		code := ""
		if c, ok := raw["code"].(string); ok {
			code = c
		}
		return &AIStreamEvent{Type: EventError, Code: code, Message: msg}
	}

	return &AIStreamEvent{Type: EventTextDelta, Delta: ""}
}
