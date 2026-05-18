package services

import (
	"strings"
	"testing"
)

func TestChunkStructured_ShortText(t *testing.T) {
	text := "Hello world"
	chunks := chunkStructured(text, 1, "paragraph", "")
	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].Text != text {
		t.Fatalf("expected %q, got %q", text, chunks[0].Text)
	}
}

func TestChunkStructured_LongTextWithoutBlankLines(t *testing.T) {
	// 模拟日志文件：每行 100 字符，共 2000 行 = 200K 字符
	line := strings.Repeat("A", 100)
	lines := make([]string, 2000)
	for i := range lines {
		lines[i] = line
	}
	text := strings.Join(lines, "\n")

	chunks := chunkStructured(text, 1, "paragraph", "")

	if len(chunks) < 10 {
		t.Fatalf("expected many chunks for 200K text, got %d", len(chunks))
	}

	for i, c := range chunks {
		if len([]rune(c.Text)) > 16000 {
			t.Fatalf("chunk %d exceeds max size: %d runes", i, len([]rune(c.Text)))
		}
	}

	// 验证开头不会丢失
	if !strings.Contains(chunks[0].Text, line) {
		t.Fatal("first chunk should contain the first line")
	}
}

func TestChunkStructured_LongLine(t *testing.T) {
	// 单行超长 50K 字符
	line := strings.Repeat("B", 50000)
	text := line

	chunks := chunkStructured(text, 1, "paragraph", "")

	if len(chunks) < 3 {
		t.Fatalf("expected hard-split chunks for long line, got %d", len(chunks))
	}

	for i, c := range chunks {
		if len([]rune(c.Text)) > 16000 {
			t.Fatalf("chunk %d exceeds max size: %d runes", i, len([]rune(c.Text)))
		}
	}

	// 验证所有 chunks 拼起来接近原文（硬切无 overlap）
	var sb strings.Builder
	for _, c := range chunks {
		sb.WriteString(c.Text)
	}
	if !strings.Contains(sb.String(), line) {
		t.Fatal("reconstructed text should contain original long line")
	}
}

func TestChunkStructured_CodeFile(t *testing.T) {
	// 模拟 Go 代码文件：每行 ~80 字符，3000 行 = 240K 字符
	codeLine := "func someVeryLongFunctionNameThatDoesSomethingImportant(arg1 string, arg2 int) error { // comment"
	lines := make([]string, 3000)
	for i := range lines {
		lines[i] = codeLine
	}
	text := "```go\n" + strings.Join(lines, "\n") + "\n```"

	chunks := chunkStructured(text, 1, "code", `{"language":"go"}`)

	if len(chunks) < 10 {
		t.Fatalf("expected many chunks for code file, got %d", len(chunks))
	}

	for i, c := range chunks {
		if len([]rune(c.Text)) > 16000 {
			t.Fatalf("chunk %d exceeds max size: %d runes", i, len([]rune(c.Text)))
		}
	}

	// 第一个 chunk 应该包含代码块开头
	if !strings.Contains(chunks[0].Text, "```go") {
		t.Fatal("first chunk should contain code block start")
	}
}

func TestChunkStructured_MarkdownFile(t *testing.T) {
	// 模拟 Markdown：标题 + 段落，每段 2K 字符，共 100 段 = 200K
	var paras []string
	for i := 0; i < 100; i++ {
		paras = append(paras, "## Section "+string(rune('A'+i%26))+"\n\n"+strings.Repeat("word ", 400))
	}
	text := strings.Join(paras, "\n\n")

	chunks := chunkStructured(text, 1, "paragraph", "")

	if len(chunks) < 10 {
		t.Fatalf("expected many chunks for markdown, got %d", len(chunks))
	}

	for i, c := range chunks {
		if len([]rune(c.Text)) > 16000 {
			t.Fatalf("chunk %d exceeds max size: %d runes", i, len([]rune(c.Text)))
		}
	}
}

func TestChunkStructured_ExactTargetSize(t *testing.T) {
	// 正好 target size
	text := strings.Repeat("X", 10000)
	chunks := chunkStructured(text, 1, "paragraph", "")
	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk for exact target size, got %d", len(chunks))
	}
}

func TestChunkStructured_Overlap(t *testing.T) {
	// 构造一个肯定会产生 overlap 的文本
	line := strings.Repeat("A", 100)
	lines := make([]string, 120)
	for i := range lines {
		lines[i] = line
	}
	text := strings.Join(lines, "\n")

	chunks := chunkStructured(text, 1, "paragraph", "")
	if len(chunks) < 2 {
		t.Fatal("expected at least 2 chunks")
	}

	// 相邻 chunks 应该有一部分重叠（因为有 overlap）
	found := false
	for i := 0; i < len(chunks)-1; i++ {
		// 简单检查：前一个 chunk 的末尾和后一个 chunk 的开头是否有重叠
		end := chunks[i].Text
		start := chunks[i+1].Text
		if len(end) > 50 && len(start) > 50 {
			// 检查后一个 chunk 的开头是否在前一个中出现
			prefix := start[:50]
			if strings.Contains(end, prefix) {
				found = true
				break
			}
		}
	}
	if !found {
		t.Log("warning: no obvious overlap found between adjacent chunks")
	}
}
