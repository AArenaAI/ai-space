package api

import (
	"strings"
	"testing"

	"aipool-backend/internal/services"
)

func TestInjectCurrentUserTimeContextPrefersClientTimezone(t *testing.T) {
	messages := []services.Message{{Role: "user", Content: "今天星期几？"}}

	got := injectCurrentUserTimeContext(messages, "127.0.0.1", "America/New_York")

	if len(got) != 2 {
		t.Fatalf("expected injected system message plus original message, got %d messages", len(got))
	}
	if !strings.Contains(got[0].Content, "America/New_York") {
		t.Fatalf("expected browser timezone to win over IP fallback, got %q", got[0].Content)
	}
}

func TestInjectCurrentUserTimeContextFallsBackWhenTimezoneLookupFails(t *testing.T) {
	messages := []services.Message{{Role: "user", Content: "今天星期几？"}}

	got := injectCurrentUserTimeContext(messages, "invalid-ip-for-timezone-lookup", "")

	if len(got) != 2 {
		t.Fatalf("expected injected system message plus original message, got %d messages", len(got))
	}
	if got[0].Role != "system" {
		t.Fatalf("expected first message role system, got %q", got[0].Role)
	}
	if !strings.Contains(got[0].Content, "当前本地时间") {
		t.Fatalf("expected current local time context, got %q", got[0].Content)
	}
	if !strings.Contains(got[0].Content, "Asia/Shanghai") {
		t.Fatalf("expected fallback timezone Asia/Shanghai, got %q", got[0].Content)
	}
	if got[1].Content != messages[0].Content {
		t.Fatalf("expected original user message preserved, got %q", got[1].Content)
	}
}
