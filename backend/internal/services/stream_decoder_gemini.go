package services

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// GeminiDecoder 解码 Google Gemini streamGenerateContent?alt=sse 流。
type GeminiDecoder struct {
	parser        *SSEParser
	reader        io.ReadCloser
	pending       []*AIStreamEvent
	citations     []geminiCitation
	seenCitations map[string]bool
}

type geminiCitation struct {
	Title string
	URI   string
}

func NewGeminiDecoder(body io.ReadCloser) *GeminiDecoder {
	return &GeminiDecoder{
		parser:        NewSSEParser(body),
		reader:        body,
		seenCitations: make(map[string]bool),
	}
}

func (d *GeminiDecoder) Next() (*AIStreamEvent, error) {
	if len(d.pending) > 0 {
		event := d.pending[0]
		d.pending = d.pending[1:]
		return event, nil
	}

	for {
		event, err := d.parser.Next()
		if err != nil {
			if err == io.EOF {
				// 流结束前，如果有累积的引用来源，先发出引用文本
				if citationDelta := d.flushCitations(); citationDelta != "" {
					d.pending = append(d.pending, &AIStreamEvent{Type: EventDone})
					return &AIStreamEvent{Type: EventTextDelta, Delta: citationDelta}, nil
				}
				return &AIStreamEvent{Type: EventDone}, io.EOF
			}
			return nil, err
		}
		if len(event.Data) == 0 {
			continue
		}

		var raw map[string]interface{}
		if err := json.Unmarshal(event.Data, &raw); err != nil {
			continue
		}

		// 提取 groundingMetadata 中的引用（流式通常在最后几个 chunk 中返回）
		d.extractGrounding(raw)

		text := extractGeminiText(raw)
		thoughtText := extractGeminiThoughtText(raw)
		if usage, ok := raw["usageMetadata"].(map[string]interface{}); ok {
			usageEvent := &AIStreamEvent{Type: EventUsage, Usage: parseGeminiUsage(usage)}
			if thoughtText != "" {
				d.pending = append(d.pending, usageEvent)
				if text != "" {
					d.pending = append(d.pending, &AIStreamEvent{Type: EventTextDelta, Delta: text})
				}
				return &AIStreamEvent{Type: EventReasoningDelta, Delta: thoughtText}, nil
			}
			if text != "" {
				d.pending = append(d.pending, usageEvent)
				return &AIStreamEvent{Type: EventTextDelta, Delta: text}, nil
			}
			return usageEvent, nil
		}
		if thoughtText != "" {
			if text != "" {
				d.pending = append(d.pending, &AIStreamEvent{Type: EventTextDelta, Delta: text})
			}
			return &AIStreamEvent{Type: EventReasoningDelta, Delta: thoughtText}, nil
		}
		if text == "" {
			continue
		}
		return &AIStreamEvent{Type: EventTextDelta, Delta: text}, nil
	}
}

func (d *GeminiDecoder) extractGrounding(raw map[string]interface{}) {
	candidates, _ := raw["candidates"].([]interface{})
	for _, c := range candidates {
		cand, _ := c.(map[string]interface{})
		if cand == nil {
			continue
		}
		gm, _ := cand["groundingMetadata"].(map[string]interface{})
		if gm == nil {
			continue
		}
		chunks, _ := gm["groundingChunks"].([]interface{})
		for _, ch := range chunks {
			chunk, _ := ch.(map[string]interface{})
			if chunk == nil {
				continue
			}
			web, _ := chunk["web"].(map[string]interface{})
			if web == nil {
				continue
			}
			uri, _ := web["uri"].(string)
			if uri == "" || d.seenCitations[uri] {
				continue
			}
			d.seenCitations[uri] = true
			title, _ := web["title"].(string)
			d.citations = append(d.citations, geminiCitation{Title: title, URI: uri})
		}
	}
}

func (d *GeminiDecoder) flushCitations() string {
	if len(d.citations) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\n---\n🔍 参考来源：\n")
	for i, c := range d.citations {
		title := c.Title
		if title == "" {
			title = c.URI
		}
		b.WriteString(fmt.Sprintf("%d. [%s](%s)\n", i+1, title, c.URI))
	}
	d.citations = nil
	return b.String()
}

func parseGeminiUsage(usage map[string]interface{}) *TokenUsage {
	prompt := geminiUsageInt(usage, "promptTokenCount")
	completion := geminiUsageInt(usage, "candidatesTokenCount")
	total := geminiUsageInt(usage, "totalTokenCount")
	if total == 0 {
		total = prompt + completion
	}
	return &TokenUsage{
		PromptTokens:     prompt,
		CompletionTokens: completion,
		TotalTokens:      total,
		Raw:              usage,
	}
}
