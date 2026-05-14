package services

import (
	"fmt"
	"strings"

	"aipool-backend/internal/models"
)

// FileContext 单个文件的检索结果
type FileContext struct {
	FileName string
	Chunks   []ChunkSearchResult
}

// ContextBuilder 统一上下文构造器
type ContextBuilder struct{}

// NewContextBuilder 创建构造器
func NewContextBuilder() *ContextBuilder {
	return &ContextBuilder{}
}

// Build 从检索结果构造系统上下文
// maxTokens: 最大允许的 token 数，0 表示不限制
func (b *ContextBuilder) Build(fileContexts []FileContext, query string, maxTokens int) string {
	if len(fileContexts) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("<file_context>\n")
	sb.WriteString("<instruction>\n")
	sb.WriteString("以下是用户上传的文件内容，请基于这些内容回答用户问题。\n")
	sb.WriteString("如果查询与文件内容无关，请直接回答问题，不需强行引用文件。\n")
	sb.WriteString("引用文件时请注明来源文件名称。\n")
	sb.WriteString("</instruction>\n\n")

	totalTokens := estimateTokens(sb.String())

	for _, fc := range fileContexts {
		if len(fc.Chunks) == 0 {
			continue
		}

		sb.WriteString(fmt.Sprintf("### 文件: %s\n\n", fc.FileName))

		for _, result := range fc.Chunks {
			chunk := result.Chunk
			chunkText := b.formatChunk(chunk, result.Relevance)
			chunkTokens := estimateTokens(chunkText)

			if maxTokens > 0 && totalTokens+chunkTokens > maxTokens {
				sb.WriteString("\n... (已截断，达到上下文长度上限) ...\n")
				break
			}

			sb.WriteString(chunkText)
			totalTokens += chunkTokens
		}

		sb.WriteString("\n")
	}

	sb.WriteString("</file_context>\n")
	return sb.String()
}

// formatChunk 格式化单个 chunk
func (b *ContextBuilder) formatChunk(chunk models.FileChunk, relevance string) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("--- Chunk %d", chunk.ChunkIndex))
	if chunk.Page > 0 {
		sb.WriteString(fmt.Sprintf(" [page %d]", chunk.Page))
	}
	if chunk.Slide > 0 {
		sb.WriteString(fmt.Sprintf(" [slide %d]", chunk.Slide))
	}
	if chunk.SheetName != "" {
		sb.WriteString(fmt.Sprintf(" [sheet: %s]", chunk.SheetName))
	}
	if relevance != "" {
		sb.WriteString(fmt.Sprintf(" [relevance: %s]", relevance))
	}
	sb.WriteString("\n")

	// 优先使用 Markdown，否则使用纯文本
	content := chunk.Markdown
	if content == "" {
		content = chunk.Content
	}
	sb.WriteString(content)
	sb.WriteString("\n\n")
	return sb.String()
}

// estimateTokens 简单估算 token 数（1 token ≈ 4 字节）
func estimateTokens(text string) int {
	return len(text) / 4
}

// ExtractFileContexts 从检索结果按文件分组
func ExtractFileContexts(results []ChunkSearchResult, fileNames map[uint]string) []FileContext {
	fileMap := make(map[uint][]ChunkSearchResult)
	for _, r := range results {
		fileMap[r.Chunk.FileID] = append(fileMap[r.Chunk.FileID], r)
	}

	var contexts []FileContext
	for fileID, chunks := range fileMap {
		name := fileNames[fileID]
		if name == "" {
			name = fmt.Sprintf("未知文件(%d)", fileID)
		}
		contexts = append(contexts, FileContext{
			FileName: name,
			Chunks:   chunks,
		})
	}
	return contexts
}
