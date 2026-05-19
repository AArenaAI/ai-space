package services

import (
	"context"
	"io"
	"strings"
	"sync"

	"google.golang.org/genai"
)

// GeminiSDKStreamDecoder converts google.golang.org/genai typed streaming
// responses into the unified AIStreamEvent shape used by the chat API.
type GeminiSDKStreamDecoder struct {
	ctx       context.Context
	seq       func(func(*genai.GenerateContentResponse, error) bool)
	startOnce sync.Once
	events    chan streamDecoderResult
	citations []geminiCitation
}

type streamDecoderResult struct {
	event *AIStreamEvent
	err   error
}

func NewGeminiSDKStreamDecoder(ctx context.Context, seq func(func(*genai.GenerateContentResponse, error) bool)) *GeminiSDKStreamDecoder {
	return &GeminiSDKStreamDecoder{
		ctx:    ctx,
		seq:    seq,
		events: make(chan streamDecoderResult, 8),
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
		stopped := false
		d.seq(func(resp *genai.GenerateContentResponse, err error) bool {
			if stopped {
				return false
			}
			if err != nil {
				stopped = true
				return d.emit(&AIStreamEvent{Type: EventError, Message: err.Error()}, nil)
			}
			if resp == nil {
				return true
			}
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
		if stopped {
			return
		}
		if citationDelta := d.flushSDKCitations(); citationDelta != "" {
			if !d.emit(&AIStreamEvent{Type: EventTextDelta, Delta: citationDelta}, nil) {
				return
			}
		}
		d.emit(&AIStreamEvent{Type: EventDone}, nil)
	}()
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

func (d *GeminiSDKStreamDecoder) flushSDKCitations() string {
	if len(d.citations) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\n---\n🔍 参考来源：\n")
	seen := make(map[string]bool)
	idx := 1
	for _, c := range d.citations {
		if c.URI == "" || seen[c.URI] {
			continue
		}
		seen[c.URI] = true
		title := c.Title
		if title == "" {
			title = c.URI
		}
		b.WriteString("[" + title + "](" + c.URI + ")")
		b.WriteString("\n")
		idx++
	}
	if idx == 1 {
		return ""
	}
	return b.String()
}
