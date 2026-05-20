package services

import (
	"fmt"
	"io"

	"github.com/openai/openai-go/packages/ssestream"
	"github.com/openai/openai-go/responses"
)

type sdkStreamBody struct {
	stream  *ssestream.Stream[responses.ResponseStreamEventUnion]
	release func()
}

func (b sdkStreamBody) Read(_ []byte) (int, error) { return 0, io.EOF }
func (b sdkStreamBody) Close() error {
	if b.release != nil {
		b.release()
	}
	if b.stream == nil {
		return nil
	}
	return b.stream.Close()
}

// OpenAIResponsesTypedDecoder 基于 openai-go 的 typed SSE stream，避免自行解析 Responses SSE JSON。
type OpenAIResponsesTypedDecoder struct {
	stream         *ssestream.Stream[responses.ResponseStreamEventUnion]
	model          string
	eventCount     int
	textEvents     int
	textChars      int
	reasoningChars int
	doneEmitted    bool
}

func NewOpenAIResponsesTypedDecoder(stream *ssestream.Stream[responses.ResponseStreamEventUnion], model ...string) *OpenAIResponsesTypedDecoder {
	decoder := &OpenAIResponsesTypedDecoder{stream: stream}
	if len(model) > 0 {
		decoder.model = model[0]
	}
	return decoder
}

func (d *OpenAIResponsesTypedDecoder) Next() (*AIStreamEvent, error) {
	if d.stream == nil {
		return nil, fmt.Errorf("OpenAI typed stream 为空")
	}
	if d.doneEmitted {
		return nil, io.EOF
	}

	for d.stream.Next() {
		event := d.stream.Current()
		d.eventCount++
		parsed := d.parseTypedEvent(event)
		if parsed != nil {
			parsed.SequenceNumber = event.SequenceNumber
			switch parsed.Type {
			case EventTextDelta:
				if parsed.Delta != "" {
					d.textEvents++
					d.textChars += len([]rune(parsed.Delta))
				}
			case EventReasoningDelta:
				d.reasoningChars += len([]rune(parsed.Delta))
			case EventUsage:
				if parsed.Usage != nil {
					fmt.Printf("[OpenAI Responses SDK Stream] usage input=%d output=%d total=%d events=%d text_events=%d text_chars=%d reasoning_chars=%d\n",
						parsed.Usage.PromptTokens,
						parsed.Usage.CompletionTokens,
						parsed.Usage.TotalTokens,
						d.eventCount,
						d.textEvents,
						d.textChars,
						d.reasoningChars,
					)
				}
			case EventDone:
				d.doneEmitted = true
				fmt.Printf("[OpenAI Responses SDK Stream] done events=%d text_events=%d text_chars=%d reasoning_chars=%d last_event=%s\n", d.eventCount, d.textEvents, d.textChars, d.reasoningChars, event.Type)
			case EventError:
				fmt.Printf("[OpenAI Responses SDK Stream] error code=%s message=%s events=%d text_chars=%d last_event=%s\n", parsed.Code, parsed.Message, d.eventCount, d.textChars, event.Type)
			}
			return parsed, nil
		}
	}

	if err := d.stream.Err(); err != nil {
		d.doneEmitted = true
		if pe := ParseOpenAIProviderError(err, d.model); pe != nil {
			return providerErrorToStreamEvent(pe), nil
		}
		return nil, err
	}
	fmt.Printf("[OpenAI Responses SDK Stream] eof events=%d text_events=%d text_chars=%d reasoning_chars=%d\n", d.eventCount, d.textEvents, d.textChars, d.reasoningChars)
	d.doneEmitted = true
	return &AIStreamEvent{Type: EventDone}, nil
}

func (d *OpenAIResponsesTypedDecoder) parseTypedEvent(event responses.ResponseStreamEventUnion) *AIStreamEvent {
	switch event.Type {
	case "response.created", "response.in_progress", "response.queued":
		if event.Response.ID != "" {
			return &AIStreamEvent{Type: EventResponseCreated, ResponseID: event.Response.ID}
		}
		return nil
	case "response.output_text.delta":
		return &AIStreamEvent{Type: EventTextDelta, Delta: event.AsResponseOutputTextDelta().Delta}
	case "response.reasoning_summary_text.delta":
		return &AIStreamEvent{Type: EventReasoningDelta, Delta: event.AsResponseReasoningSummaryTextDelta().Delta}
	case "response.reasoning_summary.delta":
		return &AIStreamEvent{Type: EventReasoningDelta, Delta: fmt.Sprint(event.AsResponseReasoningSummaryDelta().Delta)}
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
		completed := event.AsResponseCompleted()
		if completed.Response.Usage.InputTokens > 0 || completed.Response.Usage.OutputTokens > 0 || completed.Response.Usage.TotalTokens > 0 {
			return &AIStreamEvent{Type: EventUsage, Usage: &TokenUsage{
				PromptTokens:     int(completed.Response.Usage.InputTokens),
				CompletionTokens: int(completed.Response.Usage.OutputTokens),
				TotalTokens:      int(completed.Response.Usage.TotalTokens),
			}}
		}
		return &AIStreamEvent{Type: EventDone}
	case "response.incomplete":
		incomplete := event.AsResponseIncomplete()
		msg := "上游响应未完成"
		code := "response_incomplete"
		if incomplete.Response.IncompleteDetails.Reason != "" {
			msg = "上游响应未完成: " + string(incomplete.Response.IncompleteDetails.Reason)
			code = string(incomplete.Response.IncompleteDetails.Reason)
		}
		if pe := ParseOpenAIProviderErrorText(msg, d.model); pe != nil {
			return providerErrorToStreamEvent(pe)
		}
		return &AIStreamEvent{Type: EventError, Code: code, Message: msg}
	case "response.failed":
		failed := event.AsResponseFailed()
		msg := "上游响应失败"
		code := "response_failed"
		if failed.Response.Error.Message != "" {
			msg = failed.Response.Error.Message
		}
		if failed.Response.Error.Code != "" {
			code = string(failed.Response.Error.Code)
		}
		if pe := ParseOpenAIProviderErrorText(msg, d.model); pe != nil {
			return providerErrorToStreamEvent(pe)
		}
		return &AIStreamEvent{Type: EventError, Code: code, Message: msg}
	case "error":
		errEvent := event.AsError()
		msg := errEvent.Message
		if msg == "" {
			msg = "unknown error"
		}
		if pe := ParseOpenAIProviderErrorText(msg, d.model); pe != nil {
			if pe.Code == "" {
				pe.Code = errEvent.Code
			}
			return providerErrorToStreamEvent(pe)
		}
		return &AIStreamEvent{Type: EventError, Code: errEvent.Code, Message: msg}
	default:
		return nil
	}
}
