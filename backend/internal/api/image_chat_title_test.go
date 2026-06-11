package api

import (
	"testing"
	"unicode/utf8"
)

func TestImageChatTitleFromPromptKeepsValidUTF8ForChinesePrompt(t *testing.T) {
	prompt := "## 段落01｜黑屏钩子与教室亮起，长提示词用于复现中文标题截断问题\n\n| 镜头 | 画面 |"

	title := imageChatTitleFromPrompt(prompt)

	if !utf8.ValidString(title) {
		t.Fatalf("title should be valid UTF-8, got %q", title)
	}
	if title == prompt {
		t.Fatalf("title should be truncated for long prompts")
	}
}

func TestImageChatTitleFromPromptUsesDefaultForEmptyPrompt(t *testing.T) {
	if got := imageChatTitleFromPrompt(""); got != "新会话" {
		t.Fatalf("expected default title, got %q", got)
	}
}
