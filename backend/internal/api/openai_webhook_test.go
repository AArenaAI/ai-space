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

// ────────── 回归补充用例 ──────────

func TestMergeReasoningPersistedContent_NoThink_ReturnsFinalText(t *testing.T) {
	existing := "普通消息正文"
	finalText := "最终正文。"

	got := mergeReasoningPersistedContent(existing, finalText)
	// 没有 <think> 时以 retrieve 到的最终正文为准
	if got != finalText {
		t.Fatalf("no <think> should return finalText\nwant: %q\n got: %q", finalText, got)
	}
}

func TestMergeReasoningPersistedContent_EmptyExisting_ReturnsFinalText(t *testing.T) {
	existing := ""
	finalText := "最终正文。"

	got := mergeReasoningPersistedContent(existing, finalText)
	if got != finalText {
		t.Fatalf("empty existing should return finalText\nwant: %q\n got: %q", finalText, got)
	}
}

func TestMergeReasoningPersistedContent_EmptyFinalText_ReturnsExisting(t *testing.T) {
	existing := "<think>分析中</think>"
	finalText := ""

	got := mergeReasoningPersistedContent(existing, finalText)
	if got != existing {
		t.Fatalf("empty finalText should return existing\nwant: %q\n got: %q", existing, got)
	}
}

func TestMergeReasoningPersistedContent_MultipleUnclosedThink(t *testing.T) {
	// 两个 <think> 只有一个 </think>，仍视为未闭合
	existing := "<think>第一层<think>第二层</think>"
	finalText := "最终正文。"

	got := mergeReasoningPersistedContent(existing, finalText)
	want := "<think>第一层<think>第二层</think></think>\n\n最终正文。"
	if got != want {
		t.Fatalf("multiple unclosed think should close all\nwant: %q\n got: %q", want, got)
	}
}

func TestMergeReasoningPersistedContent_AllUnclosedThink(t *testing.T) {
	existing := "<think>完全没有闭合"
	finalText := "最终正文。"

	got := mergeReasoningPersistedContent(existing, finalText)
	want := "<think>完全没有闭合</think>\n\n最终正文。"
	if got != want {
		t.Fatalf("all unclosed think should close\nwant: %q\n got: %q", want, got)
	}
}

func TestMergeReasoningPersistedContent_ThinkWithTrailingText_NotDuplicate(t *testing.T) {
	// think 已闭合，后面已有其他文字，但和 finalText 不一样
	existing := "<think>分析</think>\n\n已有其他正文"
	finalText := "这是最终正文。"

	got := mergeReasoningPersistedContent(existing, finalText)
	want := "<think>分析</think>\n\n已有其他正文\n\n这是最终正文。"
	if got != want {
		t.Fatalf("existing trailing text should still append finalText\nwant: %q\n got: %q", want, got)
	}
}

func TestMergeReasoningPersistedContent_FinalTextInsideThink_NotAppend(t *testing.T) {
	// finalText 恰好是 think 块内部的一段子串（整体包含）
	existing := "<think>推理过程：这是最终正文。</think>"
	finalText := "这是最终正文。"

	got := mergeReasoningPersistedContent(existing, finalText)
	if got != existing {
		t.Fatalf("finalText inside think should not duplicate\nwant: %q\n got: %q", existing, got)
	}
}

func TestMergeReasoningPersistedContent_WhitespaceOnlyExisting_ReturnsFinalText(t *testing.T) {
	existing := "   \n\t  "
	finalText := "最终正文。"

	got := mergeReasoningPersistedContent(existing, finalText)
	if got != finalText {
		t.Fatalf("whitespace-only existing should return finalText\nwant: %q\n got: %q", finalText, got)
	}
}

func TestMergeReasoningPersistedContent_WhitespaceOnlyFinalText_ReturnsExisting(t *testing.T) {
	existing := "<think>分析</think>"
	finalText := "   \n\t  "

	got := mergeReasoningPersistedContent(existing, finalText)
	if got != existing {
		t.Fatalf("whitespace-only finalText should return existing\nwant: %q\n got: %q", existing, got)
	}
}

func TestMergeReasoningPersistedContent_ExactExistingWithFinalTextPlusExtra(t *testing.T) {
	// existing 已包含 finalText 且还有额外内容，不应重复追加
	existing := "<think>分析</think>\n\n这是最终正文。额外内容。"
	finalText := "这是最终正文。"

	got := mergeReasoningPersistedContent(existing, finalText)
	if got != existing {
		t.Fatalf("existing with extra content should stay unchanged\nwant: %q\n got: %q", existing, got)
	}
}

func TestMergeReasoningPersistedContent_UnclosedThinkAtEnd(t *testing.T) {
	// think 标签在末尾，没有闭合，边界情况
	existing := "前缀<think>末尾思考"
	finalText := "最终正文。"

	got := mergeReasoningPersistedContent(existing, finalText)
	want := "前缀<think>末尾思考</think>\n\n最终正文。"
	if got != want {
		t.Fatalf("unclosed think at end should close\nwant: %q\n got: %q", want, got)
	}
}

func TestMergeReasoningPersistedContent_MoreCloseThanOpen(t *testing.T) {
	// </think> 比 <think> 多，不应再补 </think>
	existing := "<think>分析</think></think>"
	finalText := "最终正文。"

	got := mergeReasoningPersistedContent(existing, finalText)
	want := "<think>分析</think></think>\n\n最终正文。"
	if got != want {
		t.Fatalf("more close than open should not add extra close\nwant: %q\n got: %q", want, got)
	}
}
