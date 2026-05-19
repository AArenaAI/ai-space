package services

import (
	"context"
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
