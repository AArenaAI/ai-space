package services

import (
	"strings"
	"testing"

	"aipool-backend/internal/models"
)

func TestSelectOverviewChunks_Basic(t *testing.T) {
	var chunks []models.FileChunk
	for i := 0; i < 20; i++ {
		chunks = append(chunks, models.FileChunk{
			ChunkIndex: i,
			Content:    strings.Repeat("X", 1000),
		})
	}

	result := SelectOverviewChunks(chunks, "这是什么", 100000)

	// 应该至少有开头和结尾
	if len(result) < 4 {
		t.Fatalf("expected at least 4 chunks (head+tail), got %d", len(result))
	}

	// 验证第一个是 chunk 0
	if result[0].ChunkIndex != 0 {
		t.Fatalf("expected first chunk index 0, got %d", result[0].ChunkIndex)
	}

	// 验证最后一个是 chunk 19
	last := result[len(result)-1]
	if last.ChunkIndex != 19 {
		t.Fatalf("expected last chunk index 19, got %d", last.ChunkIndex)
	}
}

func TestSelectOverviewChunks_KeywordMatch(t *testing.T) {
	var chunks []models.FileChunk
	for i := 0; i < 10; i++ {
		content := strings.Repeat("X", 500)
		if i == 5 {
			content = "DB_KEY_NOT_FOUND error happened here"
		}
		chunks = append(chunks, models.FileChunk{
			ChunkIndex: i,
			Content:    content,
		})
	}

	result := SelectOverviewChunks(chunks, "DB_KEY_NOT_FOUND 是什么", 100000)

	// 应该包含 chunk 5
	found := false
	for _, c := range result {
		if c.ChunkIndex == 5 {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected chunk 5 (keyword match) to be selected")
	}
}

func TestSelectOverviewChunks_BudgetLimit(t *testing.T) {
	var chunks []models.FileChunk
	for i := 0; i < 10; i++ {
		chunks = append(chunks, models.FileChunk{
			ChunkIndex: i,
			Content:    strings.Repeat("X", 5000),
		})
	}

	result := SelectOverviewChunks(chunks, "总结", 8000)

	// 由于每个 chunk 5000 字符，预算 8000 只能放 1 个完整的 + 1 个截断的
	if len(result) == 0 {
		t.Fatal("expected at least 1 chunk")
	}

	// 检查总字符数不超过预算
	total := 0
	for _, c := range result {
		total += len([]rune(c.Content))
	}
	if total > 8000 {
		t.Fatalf("total chars %d exceeds budget 8000", total)
	}
}

func TestSelectOverviewChunks_SingleChunk(t *testing.T) {
	chunks := []models.FileChunk{
		{ChunkIndex: 0, Content: "only one chunk"},
	}

	result := SelectOverviewChunks(chunks, "这是什么", 100000)
	if len(result) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(result))
	}
}

func TestExtractOverviewKeywords(t *testing.T) {
	kws := extractOverviewKeywords("DB_KEY_NOT_FOUND 是什么？")
	if len(kws) == 0 {
		t.Fatal("expected some keywords")
	}
	found := false
	for _, k := range kws {
		if strings.Contains("db_key_not_found", k) || k == "db_key_not_found" {
			found = true
			break
		}
	}
	if !found {
		t.Logf("keywords: %v", kws)
		t.Fatal("expected DB_KEY_NOT_FOUND related keyword")
	}
}
