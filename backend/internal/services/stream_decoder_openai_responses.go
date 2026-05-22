package services

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// OpenAIResponsesDecoder 解码 OpenAI Responses API 的 SSE 流。
type OpenAIResponsesDecoder struct {
	parser         *SSEParser
	reader         io.ReadCloser
	eventCount     int
	textEvents     int
	textChars      int
	reasoningChars int
	doneEmitted    bool
	pending        []*AIStreamEvent
	fullText       strings.Builder
}

// NewOpenAIResponsesDecoder 创建 OpenAI Responses 流解码器。
func NewOpenAIResponsesDecoder(body io.ReadCloser) *OpenAIResponsesDecoder {
	return &OpenAIResponsesDecoder{
		parser: NewSSEParser(body),
		reader: body,
	}
}

// Next 返回下一个解码后的 AIStreamEvent，io.EOF 表示流结束。
func (d *OpenAIResponsesDecoder) Next() (*AIStreamEvent, error) {
	if d.doneEmitted {
		return nil, io.EOF
	}
	if pending := d.popPendingEvent(); pending != nil {
		return pending, nil
	}

	for {
		event, err := d.parser.Next()
		if err != nil {
			if err == io.EOF {
				fmt.Printf("[OpenAI Responses Stream] eof events=%d text_events=%d text_chars=%d reasoning_chars=%d\n", d.eventCount, d.textEvents, d.textChars, d.reasoningChars)
				done := &AIStreamEvent{Type: EventDone}
				d.trackEvent(done)
				return done, io.EOF
			}
			return nil, err
		}

		data := string(event.Data)
		if data == "" {
			continue
		}

		if data == "[DONE]" {
			done := &AIStreamEvent{Type: EventDone}
			d.trackEvent(done)
			return done, io.EOF
		}

		var raw map[string]interface{}
		if err := json.Unmarshal(event.Data, &raw); err != nil {
			return nil, err
		}

		d.eventCount++
		parsed := d.parseEvent(event.Event, raw)
		if parsed != nil {
			if seq, ok := raw["sequence_number"].(float64); ok {
				parsed.SequenceNumber = int64(seq)
			}
			d.trackEvent(parsed)
		}
		return parsed, nil
	}
}

func (d *OpenAIResponsesDecoder) popPendingEvent() *AIStreamEvent {
	event := d.shiftPendingEvent()
	d.trackEvent(event)
	return event
}

func (d *OpenAIResponsesDecoder) shiftPendingEvent() *AIStreamEvent {
	if len(d.pending) == 0 {
		return nil
	}
	event := d.pending[0]
	d.pending = d.pending[1:]
	return event
}

func (d *OpenAIResponsesDecoder) trackEvent(event *AIStreamEvent) {
	if event == nil {
		return
	}
	switch event.Type {
	case EventTextDelta:
		if event.Delta != "" {
			d.textEvents++
			d.textChars += len([]rune(event.Delta))
			d.fullText.WriteString(event.Delta)
		}
	case EventReasoningDelta:
		d.reasoningChars += len([]rune(event.Delta))
	case EventUsage:
		if event.Usage != nil {
			fmt.Printf("[OpenAI Responses Stream] usage input=%d output=%d total=%d events=%d text_events=%d text_chars=%d reasoning_chars=%d\n",
				event.Usage.PromptTokens,
				event.Usage.CompletionTokens,
				event.Usage.TotalTokens,
				d.eventCount,
				d.textEvents,
				d.textChars,
				d.reasoningChars,
			)
		}
	case EventDone:
		d.doneEmitted = true
		fmt.Printf("[OpenAI Responses Stream] done events=%d text_events=%d text_chars=%d reasoning_chars=%d\n", d.eventCount, d.textEvents, d.textChars, d.reasoningChars)
	case EventError:
		fmt.Printf("[OpenAI Responses Stream] error code=%s message=%s events=%d text_chars=%d\n", event.Code, event.Message, d.eventCount, d.textChars)
	}
}

func (d *OpenAIResponsesDecoder) parseEvent(name string, raw map[string]interface{}) *AIStreamEvent {
	switch name {
	case "response.created", "response.in_progress", "response.queued":
		if resp, ok := raw["response"].(map[string]interface{}); ok {
			if id, ok := resp["id"].(string); ok && id != "" {
				return &AIStreamEvent{Type: EventResponseCreated, ResponseID: id}
			}
		}
	case "response.output_text.delta":
		if delta, ok := raw["delta"].(string); ok {
			return &AIStreamEvent{Type: EventTextDelta, Delta: delta}
		}
	case "response.reasoning_item.delta", "response.reasoning_summary_text.delta":
		if delta, ok := raw["delta"].(string); ok {
			return &AIStreamEvent{Type: EventReasoningDelta, Delta: delta}
		}
	case "response.reasoning_summary.delta":
		if delta, ok := raw["delta"]; ok {
			return &AIStreamEvent{Type: EventReasoningDelta, Delta: fmt.Sprint(delta)}
		}
	case "response.web_search_call.in_progress", "response.web_search_call.searching":
		return &AIStreamEvent{Type: EventSearchStart, Delta: "正在搜索网页"}
	case "response.web_search_call.completed":
		return &AIStreamEvent{Type: EventSearchDone, Delta: "网页搜索完成"}
	case "response.file_search_call.in_progress", "response.file_search_call.searching":
		return &AIStreamEvent{Type: EventFileSearchStart, Delta: "正在检索知识库"}
	case "response.file_search_call.completed":
		return &AIStreamEvent{Type: EventFileSearchDone, Delta: "知识库检索完成"}
	case "response.function_call_arguments.delta":
		return &AIStreamEvent{Type: EventToolCallStart, Delta: "正在调用工具"}
	case "response.function_call_arguments.done":
		return &AIStreamEvent{Type: EventToolCallDone, Delta: "工具调用完成"}
	case "response.completed":
		// OpenAI background+stream can finish with response.completed whose final
		// response.output_text is longer than the emitted output_text.delta stream.
		// Emit the missing suffix before usage/DONE so task-event replay remains
		// token-continuous instead of polling jumping from partial text to full DB text.
		if resp, ok := raw["response"].(map[string]interface{}); ok {
			if missingText := missingOpenAICompletedSuffix(d.fullText.String(), extractTextFromRawResponse(resp)); missingText != "" {
				d.pending = append(d.pending, &AIStreamEvent{Type: EventTextDelta, Delta: missingText})
			}
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
				d.pending = append(d.pending, &AIStreamEvent{Type: EventUsage, Usage: tu})
			}
		}
		d.pending = append(d.pending, &AIStreamEvent{Type: EventDone})
		return d.shiftPendingEvent()
	case "response.incomplete":
		msg := "上游响应未完成"
		code := "response_incomplete"
		if resp, ok := raw["response"].(map[string]interface{}); ok {
			if details, ok := resp["incomplete_details"].(map[string]interface{}); ok {
				if reason, ok := details["reason"].(string); ok && reason != "" {
					msg = "上游响应未完成: " + reason
					code = reason
				}
			}
		}
		if pe := ParseOpenAIProviderErrorText(msg, ""); pe != nil {
			return providerErrorToStreamEvent(pe)
		}
		return &AIStreamEvent{Type: EventError, Code: code, Message: msg}
	case "response.failed":
		msg := "上游响应失败"
		code := "response_failed"
		if resp, ok := raw["response"].(map[string]interface{}); ok {
			if errObj, ok := resp["error"].(map[string]interface{}); ok {
				if m, ok := errObj["message"].(string); ok && m != "" {
					msg = m
				}
				if c, ok := errObj["code"].(string); ok && c != "" {
					code = c
				}
			}
		}
		if pe := ParseOpenAIProviderErrorText(msg, ""); pe != nil {
			return providerErrorToStreamEvent(pe)
		}
		return &AIStreamEvent{Type: EventError, Code: code, Message: msg}
	case "error":
		msg := "unknown error"
		if m, ok := raw["message"].(string); ok {
			msg = m
		}
		code := ""
		if c, ok := raw["code"].(string); ok {
			code = c
		}
		if pe := ParseOpenAIProviderErrorText(msg, ""); pe != nil {
			return providerErrorToStreamEvent(pe)
		}
		return &AIStreamEvent{Type: EventError, Code: code, Message: msg}
	}

	return &AIStreamEvent{Type: EventTextDelta, Delta: ""}
}

func extractTextFromRawResponse(response map[string]interface{}) string {
	output, ok := response["output"].([]interface{})
	if !ok {
		return ""
	}
	var parts []string
	for _, itemValue := range output {
		item, ok := itemValue.(map[string]interface{})
		if !ok || item["type"] != "message" {
			continue
		}
		contentItems, ok := item["content"].([]interface{})
		if !ok {
			continue
		}
		for _, contentValue := range contentItems {
			content, ok := contentValue.(map[string]interface{})
			if !ok {
				continue
			}
			if text, ok := content["text"].(string); ok && text != "" {
				parts = append(parts, text)
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}
