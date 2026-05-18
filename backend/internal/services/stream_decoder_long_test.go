package services

import (
	"io"
	"strings"
	"testing"
)

type testReadCloser struct{ *strings.Reader }

func (r testReadCloser) Close() error { return nil }

func TestChatSSEDecoder_LongSingleDataLine(t *testing.T) {
	long := strings.Repeat("中", 80*1024)
	payload := `data: {"choices":[{"delta":{"content":"` + long + `"}}]}` + "\n\n" + "data: [DONE]\n\n"
	dec := NewChatSSEDecoder(testReadCloser{strings.NewReader(payload)})

	event, err := dec.Next()
	if err != nil {
		t.Fatalf("Next returned error: %v", err)
	}
	if event.Type != EventTextDelta {
		t.Fatalf("event type = %v, want %v", event.Type, EventTextDelta)
	}
	if event.Delta != long {
		t.Fatalf("delta len = %d, want %d", len(event.Delta), len(long))
	}

	done, err := dec.Next()
	if err != io.EOF {
		t.Fatalf("done err = %v, want io.EOF", err)
	}
	if done == nil || done.Type != EventDone {
		t.Fatalf("done event = %#v, want EventDone", done)
	}
}

func TestOpenAIResponsesDecoder_LongSingleDataLine(t *testing.T) {
	long := strings.Repeat("中", 80*1024)
	payload := "event: response.output_text.delta\n" + `data: {"delta":"` + long + `"}` + "\n\n" + "data: [DONE]\n\n"
	dec := NewOpenAIResponsesDecoder(testReadCloser{strings.NewReader(payload)})

	event, err := dec.Next()
	if err != nil {
		t.Fatalf("Next returned error: %v", err)
	}
	if event.Type != EventTextDelta {
		t.Fatalf("event type = %v, want %v", event.Type, EventTextDelta)
	}
	if event.Delta != long {
		t.Fatalf("delta len = %d, want %d", len(event.Delta), len(long))
	}

	done, err := dec.Next()
	if err != io.EOF {
		t.Fatalf("done err = %v, want io.EOF", err)
	}
	if done == nil || done.Type != EventDone {
		t.Fatalf("done event = %#v, want EventDone", done)
	}
}
