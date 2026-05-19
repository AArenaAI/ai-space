package services

import (
	"strings"
	"testing"
)

type geminiTestReadCloser struct {
	*strings.Reader
}

func (r geminiTestReadCloser) Close() error { return nil }

func TestGeminiDecoderSeparatesThoughtFromText(t *testing.T) {
	payload := "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"思考内容\",\"thought\":true},{\"text\":\"正文内容\"}]}}]}\n\n"
	dec := NewGeminiDecoder(geminiTestReadCloser{strings.NewReader(payload)})

	event, err := dec.Next()
	if err != nil {
		t.Fatalf("first event err: %v", err)
	}
	if event.Type != EventReasoningDelta || event.Delta != "思考内容" {
		t.Fatalf("first event = %#v, want reasoning 思考内容", event)
	}

	event, err = dec.Next()
	if err != nil {
		t.Fatalf("second event err: %v", err)
	}
	if event.Type != EventTextDelta || event.Delta != "正文内容" {
		t.Fatalf("second event = %#v, want text 正文内容", event)
	}

	event, err = dec.Next()
	if err != nil {
		t.Fatalf("done event err: %v", err)
	}
	if event.Type != EventDone {
		t.Fatalf("done event = %#v", event)
	}
}

func TestGeminiExtractTextSkipsThoughtParts(t *testing.T) {
	raw := map[string]interface{}{
		"candidates": []interface{}{
			map[string]interface{}{
				"content": map[string]interface{}{
					"parts": []interface{}{
						map[string]interface{}{"text": "思考内容", "thought": true},
						map[string]interface{}{"text": "正文内容"},
					},
				},
			},
		},
	}

	if got := extractGeminiText(raw); got != "正文内容" {
		t.Fatalf("extractGeminiText = %q, want 正文内容", got)
	}
	if got := extractGeminiThoughtText(raw); got != "思考内容" {
		t.Fatalf("extractGeminiThoughtText = %q, want 思考内容", got)
	}
}
