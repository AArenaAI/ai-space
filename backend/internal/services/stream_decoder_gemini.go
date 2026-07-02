package services

import (
	"encoding/json"
	"io"
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
				// 流结束前，如果有累积的引用来源，先发出结构化来源事件。
				// 这里必须返回 EventDone + nil，不能带 io.EOF；上层读取 goroutine
				// 遇到 err 会直接退出，导致前端收不到 data: [DONE]，流式 UI 一直等待。
				if sources := d.flushCitations(); len(sources) > 0 {
					d.pending = append(d.pending, &AIStreamEvent{Type: EventDone})
					return &AIStreamEvent{Type: EventSearchDone, Delta: "网页搜索完成", SearchSources: sources}, nil
				}
				return &AIStreamEvent{Type: EventDone}, nil
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

func (d *GeminiDecoder) flushCitations() []SearchResult {
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
