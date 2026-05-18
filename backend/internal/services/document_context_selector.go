package services

import (
	"sort"
	"strings"
	"unicode"

	"aipool-backend/internal/models"
)

// SelectOverviewChunks 从文件的所有 chunks 中按确定性策略选择概览上下文。
// 策略：开头 chunks + 包含关键词的 chunks + 结尾 chunks，不超过 maxChars 字符预算。
// 返回的 chunks 按 ChunkIndex 排序。
func SelectOverviewChunks(chunks []models.FileChunk, query string, maxChars int) []models.FileChunk {
	if len(chunks) == 0 {
		return nil
	}
	if maxChars <= 0 {
		maxChars = 40000 // 默认预算：约 40K 字符
	}

	// 关键词：从 query 提取（简单分词，过滤空白/标点）
	keywords := extractOverviewKeywords(query)

	// 确定选择的 chunk 索引
	selected := make(map[int]bool)

	// 1. 选择开头：前 2 个 chunk
	for i := 0; i < 2 && i < len(chunks); i++ {
		selected[i] = true
	}

	// 2. 选择结尾：后 2 个 chunk
	for i := len(chunks) - 2; i < len(chunks) && i >= 0; i++ {
		selected[i] = true
	}

	// 3. 选择包含关键词的 chunks
	for i, c := range chunks {
		content := c.Content
		if content == "" {
			content = c.Markdown
		}
		content = strings.ToLower(content)
		for _, kw := range keywords {
			if strings.Contains(content, kw) {
				selected[i] = true
				break
			}
		}
	}

	// 按索引排序
	var indices []int
	for i := range selected {
		indices = append(indices, i)
	}
	sort.Ints(indices)

	// 根据预算过滤
	var result []models.FileChunk
	used := 0
	for _, i := range indices {
		c := chunks[i]
		content := c.Content
		if content == "" {
			content = c.Markdown
		}
		l := len([]rune(content))
		if used+l > maxChars {
			// 如果这个 chunk 本身就超大，只取前 maxChars-used 字符
			if l > maxChars-used && maxChars-used > 200 {
				truncated := string([]rune(content)[:maxChars-used])
				c.Content = truncated
				c.Markdown = ""
				result = append(result, c)
			}
			break
		}
		result = append(result, c)
		used += l
	}

	return result
}

// extractOverviewKeywords 从查询中提取关键词，用于 chunk 命中检测。
func extractOverviewKeywords(query string) []string {
	q := strings.ToLower(strings.TrimSpace(query))
	// 去掉常见废话
	stopWords := map[string]bool{
		"这": true, "是": true, "什么": true, "一": true, "下": true,
		"帮": true, "我": true, "看": true, "分析": true, "总结": true,
		"概括": true, "解析": true, "提取": true, "重点": true,
		"文档": true, "内容": true, "日志": true, "报告": true,
		"the": true, "is": true, "this": true, "what": true, "a": true,
		"an": true, "and": true, "or": true, "of": true, "in": true,
		"for": true, "to": true, "on": true, "with": true,
		"summary": true, "summarize": true, "analyze": true, "describe": true,
		"overview": true, "please": true, "help": true, "me": true,
	}

	// 按空白或标点分割
	fields := strings.FieldsFunc(q, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsPunct(r)
	})

	var keywords []string
	seen := make(map[string]bool)
	for _, f := range fields {
		if f == "" || stopWords[f] || len(f) < 2 {
			continue
		}
		if !seen[f] {
			seen[f] = true
			keywords = append(keywords, f)
		}
	}
	return keywords
}
