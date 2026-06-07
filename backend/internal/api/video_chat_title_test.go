package api

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestVideoChatTitleFromPromptKeepsValidUTF8ForChinesePrompt(t *testing.T) {
	prompt := "## 段落01｜黑屏钩子与教室亮起\n\n### 建议时长\n\n12秒"

	title := videoChatTitleFromPrompt(prompt)

	if !utf8.ValidString(title) {
		t.Fatalf("title must be valid UTF-8, got bytes: %q", []byte(title))
	}
	if !strings.HasSuffix(title, "...") {
		t.Fatalf("long prompt title should end with ellipsis, got %q", title)
	}
	if len([]rune(strings.TrimSuffix(title, "..."))) != 30 {
		t.Fatalf("title should keep 30 Unicode characters before ellipsis, got %d in %q", len([]rune(strings.TrimSuffix(title, "..."))), title)
	}
}

func TestVideoChatTitleFromPromptUsesFallbackForEmptyPrompt(t *testing.T) {
	if got := videoChatTitleFromPrompt(""); got != "新视频会话" {
		t.Fatalf("expected fallback title, got %q", got)
	}
}
