package services

import (
	"context"
	"io"
	"strings"
	"sync"
	"time"

	"google.golang.org/genai"
)

const geminiSDKStreamMaxPreFirstChunkRetries = 2

func geminiSDKStreamRetryDelay(attempt int) time.Duration {
	if attempt <= 0 {
		return 0
	}
	return time.Duration(1<<uint(attempt-1)) * 800 * time.Millisecond
}

func geminiSDKErrorToStreamEvent(err error) *AIStreamEvent {
	if err == nil {
		return nil
	}
	raw := strings.TrimSpace(err.Error())
	lower := strings.ToLower(raw)
	isTimeout := strings.Contains(lower, "timeout awaiting response headers") ||
		strings.Contains(lower, "client.timeout exceeded while awaiting headers") ||
		strings.Contains(lower, "context deadline exceeded") ||
		strings.Contains(lower, "i/o timeout") ||
		strings.Contains(lower, "net/http: timeout")
	if isTimeout {
		return &AIStreamEvent{
			Type:             EventError,
			Code:             "upstream_timeout",
			Message:          "Gemini 上游响应超时，本次生成中断，请重新生成或稍后重试。",
			ErrorKind:        "network_timeout",
			Recoverable:      true,
			Provider:         "gemini",
			SuggestedActions: []string{"retry", "switch_model"},
		}
	}
	return &AIStreamEvent{
		Type:             EventError,
		Code:             "upstream_error",
		Message:          raw,
		ErrorKind:        "upstream_error",
		Recoverable:      false,
		Provider:         "gemini",
		SuggestedActions: []string{"retry", "switch_model"},
	}
}

// GeminiSDKStreamDecoder converts google.golang.org/genai typed streaming
// responses into the unified AIStreamEvent shape used by the chat API.
type GeminiSDKStreamDecoder struct {
	ctx        context.Context
	seq        func(func(*genai.GenerateContentResponse, error) bool)
	startOnce  sync.Once
	events     chan streamDecoderResult
	citations  []geminiCitation
	retryDelay func(attempt int) time.Duration
}

type streamDecoderResult struct {
	event *AIStreamEvent
	err   error
}

func NewGeminiSDKStreamDecoder(ctx context.Context, seq func(func(*genai.GenerateContentResponse, error) bool)) *GeminiSDKStreamDecoder {
	return &GeminiSDKStreamDecoder{
		ctx:        ctx,
		seq:        seq,
		events:     make(chan streamDecoderResult, 8),
		retryDelay: geminiSDKStreamRetryDelay,
	}
}

func (d *GeminiSDKStreamDecoder) Next() (*AIStreamEvent, error) {
	d.startOnce.Do(d.start)

	select {
	case <-d.ctx.Done():
		return nil, d.ctx.Err()
	case result, ok := <-d.events:
		if !ok {
			return nil, io.EOF
		}
		return result.event, result.err
	}
}

func (d *GeminiSDKStreamDecoder) start() {
	go func() {
		defer close(d.events)
		for attempt := 0; ; attempt++ {
			if d.runSeqAttempt(attempt) {
				return
			}
		}
	}()
}

func (d *GeminiSDKStreamDecoder) runSeqAttempt(attempt int) bool {
	stopped := false
	retry := false
	seenFirstChunk := false
	d.seq(func(resp *genai.GenerateContentResponse, err error) bool {
		if stopped {
			return false
		}
		if err != nil {
			event := geminiSDKErrorToStreamEvent(err)
			if !seenFirstChunk && event != nil && event.Recoverable && attempt < geminiSDKStreamMaxPreFirstChunkRetries {
				retry = true
				stopped = true
				return false
			}
			stopped = true
			return d.emit(event, nil)
		}
		if resp == nil {
			return true
		}
		seenFirstChunk = true
		if usage := geminiSDKUsageToTokenUsage(resp.UsageMetadata); usage != nil {
			if !d.emit(&AIStreamEvent{Type: EventUsage, Usage: usage}, nil) {
				stopped = true
				return false
			}
		}
		d.captureSDKGrounding(resp)
		for _, cand := range resp.Candidates {
			if cand == nil || cand.Content == nil {
				continue
			}
			for _, part := range cand.Content.Parts {
				if part == nil || part.Text == "" {
					continue
				}
				eventType := EventTextDelta
				if part.Thought {
					eventType = EventReasoningDelta
				}
				if !d.emit(&AIStreamEvent{Type: eventType, Delta: part.Text}, nil) {
					stopped = true
					return false
				}
			}
		}
		return true
	})
	if retry {
		if !d.sleepBeforeRetry(attempt + 1) {
			return true
		}
		return false
	}
	if stopped {
		return true
	}
	if sources := d.flushSDKCitations(); len(sources) > 0 {
		if !d.emit(&AIStreamEvent{Type: EventSearchDone, Delta: "网页搜索完成", SearchSources: sources}, nil) {
			return true
		}
	}
	d.emit(&AIStreamEvent{Type: EventDone}, nil)
	return true
}

func (d *GeminiSDKStreamDecoder) sleepBeforeRetry(attempt int) bool {
	delay := time.Duration(0)
	if d.retryDelay != nil {
		delay = d.retryDelay(attempt)
	}
	if delay <= 0 {
		return true
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-d.ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (d *GeminiSDKStreamDecoder) emit(event *AIStreamEvent, err error) bool {
	select {
	case <-d.ctx.Done():
		return false
	case d.events <- streamDecoderResult{event: event, err: err}:
		return true
	}
}

func geminiSDKUsageToTokenUsage(usage *genai.GenerateContentResponseUsageMetadata) *TokenUsage {
	if usage == nil {
		return nil
	}
	prompt := int(usage.PromptTokenCount)
	completion := int(usage.CandidatesTokenCount)
	total := int(usage.TotalTokenCount)
	if total == 0 {
		total = prompt + completion
	}
	if prompt == 0 && completion == 0 && total == 0 {
		return nil
	}
	return &TokenUsage{
		PromptTokens:     prompt,
		CompletionTokens: completion,
		TotalTokens:      total,
	}
}

func (d *GeminiSDKStreamDecoder) captureSDKGrounding(resp *genai.GenerateContentResponse) {
	for _, cand := range resp.Candidates {
		if cand == nil || cand.GroundingMetadata == nil {
			continue
		}
		for _, chunk := range cand.GroundingMetadata.GroundingChunks {
			if chunk == nil || chunk.Web == nil || chunk.Web.URI == "" {
				continue
			}
			d.citations = append(d.citations, geminiCitation{Title: chunk.Web.Title, URI: chunk.Web.URI})
		}
	}
}

func (d *GeminiSDKStreamDecoder) flushSDKCitations() []SearchResult {
	if len(d.citations) == 0 {
		return nil
	}
	var sources []SearchResult
	seen := make(map[string]bool)
	for _, c := range d.citations {
		if c.URI == "" || seen[c.URI] {
			continue
		}
		seen[c.URI] = true
		title := c.Title
		if title == "" {
			title = c.URI
		}
		sources = append(sources, SearchResult{Title: title, URL: c.URI, Description: title})
	}
	d.citations = nil
	return sources
}
