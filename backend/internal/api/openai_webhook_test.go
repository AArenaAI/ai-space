package api

import "testing"

func TestMergeReasoningPersistedContentClosesUnclosedThinkBeforeFinalText(t *testing.T) {
	existing := "<think>模型正在分析\n还没闭合"
	finalText := "这是最终正文。"

	got := mergeReasoningPersistedContent(existing, finalText)
	want := "<think>模型正在分析\n还没闭合</think>\n\n这是最终正文。"
	if got != want {
		t.Fatalf("unexpected merged content\nwant: %q\n got: %q", want, got)
	}
}

func TestMergeReasoningPersistedContentKeepsClosedThinkBeforeFinalText(t *testing.T) {
	existing := "<think>模型正在分析</think>"
	finalText := "这是最终正文。"

	got := mergeReasoningPersistedContent(existing, finalText)
	want := "<think>模型正在分析</think>\n\n这是最终正文。"
	if got != want {
		t.Fatalf("unexpected merged content\nwant: %q\n got: %q", want, got)
	}
}

func TestMergeReasoningPersistedContentDoesNotDuplicateExistingFinalText(t *testing.T) {
	existing := "<think>模型正在分析</think>\n\n这是最终正文。"
	finalText := "这是最终正文。"

	got := mergeReasoningPersistedContent(existing, finalText)
	if got != existing {
		t.Fatalf("expected existing content unchanged\nwant: %q\n got: %q", existing, got)
	}
}
