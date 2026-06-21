package services

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/genai"
)

func TestGeminiSDKStreamDecoderReturnsFirstChunkBeforeStreamEnds(t *testing.T) {
	firstReturned := make(chan struct{})
	releaseSecond := make(chan struct{})

	seq := func(yield func(*genai.GenerateContentResponse, error) bool) {
		resp := &genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{
				{
					Content: &genai.Content{
						Parts: []*genai.Part{
							{Text: "思考一", Thought: true},
						},
					},
				},
			},
		}
		if !yield(resp, nil) {
			return
		}
		close(firstReturned)
		<-releaseSecond
		yield(&genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{
				{
					Content: &genai.Content{
						Parts: []*genai.Part{
							{Text: "正文二"},
						},
					},
				},
			},
		}, nil)
	}

	dec := NewGeminiSDKStreamDecoder(context.Background(), seq)

	event, err := dec.Next()
	if err != nil {
		t.Fatalf("first event err: %v", err)
	}
	if event.Type != EventReasoningDelta || event.Delta != "思考一" {
		t.Fatalf("first event = %#v, want reasoning 思考一", event)
	}

	select {
	case <-firstReturned:
		// ok: first chunk was yielded without waiting for the stream to end.
	case <-time.After(200 * time.Millisecond):
		t.Fatal("decoder waited for full Gemini stream before returning first chunk")
	}

	close(releaseSecond)
	event, err = dec.Next()
	if err != nil {
		t.Fatalf("second event err: %v", err)
	}
	if event.Type != EventTextDelta || event.Delta != "正文二" {
		t.Fatalf("second event = %#v, want text 正文二", event)
	}

	event, err = dec.Next()
	if err != nil {
		t.Fatalf("done event err: %v", err)
	}
	if event.Type != EventDone {
		t.Fatalf("done event = %#v", event)
	}
}

func TestGeminiSDKStreamDecoderClassifiesHeaderTimeoutAsRecoverable(t *testing.T) {
	seq := func(yield func(*genai.GenerateContentResponse, error) bool) {
		yield(nil, errors.New(`doRequest: error sending request: Post "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:streamGenerateContent?alt=sse": net/http: timeout awaiting response headers`))
	}

	dec := NewGeminiSDKStreamDecoder(context.Background(), seq)
	event, err := dec.Next()
	if err != nil {
		t.Fatalf("timeout event err: %v", err)
	}
	if event.Type != EventError {
		t.Fatalf("event type = %s, want error", event.Type)
	}
	if event.Code != "upstream_timeout" {
		t.Fatalf("code = %q, want upstream_timeout", event.Code)
	}
	if event.ErrorKind != "network_timeout" {
		t.Fatalf("kind = %q, want network_timeout", event.ErrorKind)
	}
	if !event.Recoverable {
		t.Fatal("timeout event should be recoverable")
	}
	if event.Provider != "gemini" {
		t.Fatalf("provider = %q, want gemini", event.Provider)
	}
	if event.Message == "" || event.Message == `doRequest: error sending request: Post "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:streamGenerateContent?alt=sse": net/http: timeout awaiting response headers` {
		t.Fatalf("message should be user-facing, got %q", event.Message)
	}
}

func TestGeminiSDKStreamDecoderRetriesPreFirstChunkTimeout(t *testing.T) {
	var attempts int32
	seq := func(yield func(*genai.GenerateContentResponse, error) bool) {
		attempt := atomic.AddInt32(&attempts, 1)
		if attempt == 1 {
			yield(nil, errors.New("net/http: timeout awaiting response headers"))
			return
		}
		yield(&genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{{
				Content: &genai.Content{Parts: []*genai.Part{{Text: "重试成功"}}},
			}},
		}, nil)
	}

	dec := NewGeminiSDKStreamDecoder(context.Background(), seq)
	dec.retryDelay = func(int) time.Duration { return 0 }
	event, err := dec.Next()
	if err != nil {
		t.Fatalf("event err: %v", err)
	}
	if got := atomic.LoadInt32(&attempts); got != 2 {
		t.Fatalf("attempts = %d, want 2", got)
	}
	if event.Type != EventTextDelta || event.Delta != "重试成功" {
		t.Fatalf("event = %#v, want retried text delta", event)
	}
	event, err = dec.Next()
	if err != nil {
		t.Fatalf("done err: %v", err)
	}
	if event.Type != EventDone {
		t.Fatalf("done event = %#v", event)
	}
}

func TestGeminiSDKStreamDecoderDoesNotRetryAfterFirstChunk(t *testing.T) {
	var attempts int32
	seq := func(yield func(*genai.GenerateContentResponse, error) bool) {
		atomic.AddInt32(&attempts, 1)
		if !yield(&genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{{
				Content: &genai.Content{Parts: []*genai.Part{{Text: "已开始"}}},
			}},
		}, nil) {
			return
		}
		yield(nil, errors.New("net/http: timeout awaiting response headers"))
	}

	dec := NewGeminiSDKStreamDecoder(context.Background(), seq)
	dec.retryDelay = func(int) time.Duration { return 0 }
	event, err := dec.Next()
	if err != nil {
		t.Fatalf("first event err: %v", err)
	}
	if event.Type != EventTextDelta || event.Delta != "已开始" {
		t.Fatalf("first event = %#v, want text delta", event)
	}
	event, err = dec.Next()
	if err != nil {
		t.Fatalf("error event err: %v", err)
	}
	if got := atomic.LoadInt32(&attempts); got != 1 {
		t.Fatalf("attempts = %d, want 1", got)
	}
	if event.Type != EventError || event.Code != "upstream_timeout" || !event.Recoverable {
		t.Fatalf("error event = %#v, want recoverable upstream timeout", event)
	}
}
