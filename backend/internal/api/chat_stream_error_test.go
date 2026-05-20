package api

import (
	"bytes"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"aipool-backend/internal/services"

	"github.com/gin-gonic/gin"
)

type oneShotErrorDecoder struct {
	calls int
}

func (d *oneShotErrorDecoder) Next() (*services.AIStreamEvent, error) {
	d.calls++
	if d.calls == 1 {
		return &services.AIStreamEvent{
			Type:            services.EventError,
			Code:            "rate_limit_exceeded",
			Message:         "Rate limit reached for gpt-5.5-pro.",
			Recoverable:     true,
			RetryAfterMs:    1234,
			ErrorKind:       "rate_limit",
			Provider:        "openai",
			Model:           "gpt-5.5-pro",
			LimitType:       "tokens_per_minute",
			LimitTokens:     30000,
			UsedTokens:      30000,
			RequestedTokens: 20000,
		}, nil
	}
	return nil, io.EOF
}

func TestForwardUnifiedStreamErrorTerminatesAfterOneEvent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &ChatHandler{}
	decoder := &oneShotErrorDecoder{}
	resp := &services.AICompletionResponse{Decoder: decoder, ModelType: "openai_responses", Provider: "openai", Model: "gpt-5.5-pro"}

	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Writer.Header().Set("Content-Type", "text/event-stream")

	outcome, _, err := h.forwardUnifiedStream(resp, ctx.Writer, true, 0, false, 0, "", 0, "gpt-5.5-pro", "openai", nil, 0)
	if err != nil {
		t.Fatalf("forwardUnifiedStream returned error: %v", err)
	}
	if outcome == nil {
		t.Fatalf("expected outcome")
	}
	body := w.Body.String()
	if got := strings.Count(body, "\"content\":\"Rate limit reached for gpt-5.5-pro.\""); got != 1 {
		t.Fatalf("error delta should be emitted once, got %d in body: %s", got, body)
	}
	if !strings.Contains(body, "\"_error_meta\"") {
		t.Fatalf("expected _error_meta in body: %s", body)
	}
	if !strings.Contains(body, "data: [DONE]\n\n") {
		t.Fatalf("expected stream to end with [DONE], body: %s", body)
	}
	// forwardUnifiedStream 内部解码 goroutine 可能预读一次 EOF，但不能重复向前端输出错误事件。
	if decoder.calls > 2 {
		t.Fatalf("decoder should not keep polling after EventError, calls=%d", decoder.calls)
	}
	if bytes.Count(w.Body.Bytes(), []byte("data:")) != 2 {
		t.Fatalf("expected exactly error event + DONE, body: %s", body)
	}
}
