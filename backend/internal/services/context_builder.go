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
	section := b.BuildSection("files", fileContexts, query, maxTokens, 100000)
	if section == "" {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("<file_context>\n")
	sb.WriteString("<instruction>\n")
	sb.WriteString("以下是用户在本轮请求中上传或关联的文件内容。\n")
	sb.WriteString("请优先基于下面的文件上下文回答问题。\n")
	sb.WriteString("当用户问题为\"总结一下\"、\"描述一下\"、\"这是什么\"、\"分析一下\"等指代性问题时，\n")
	sb.WriteString("默认必须指向本轮上传或关联的文件内容，而不是历史对话中的旧文件或旧图片。\n")
	sb.WriteString("当文件内容与历史对话中的旧文件、旧图片描述冲突时，以本轮文件内容为准。\n")
	sb.WriteString("不要把历史对话中的旧文件正文、旧图片描述或旧附件分析当成本轮上传的文件。\n")
	sb.WriteString("如果查询与文件内容无关，请直接回答问题，不需强行引用文件。\n")
	sb.WriteString("引用文件时请注明来源文件名称。\n")
	sb.WriteString("</instruction>\n\n")
	sb.WriteString(section)
	sb.WriteString("\n</file_context>\n")
	return sb.String()
}

// BuildSection 构造 file_context 内部的一个分区，不自带 <file_context> 外壳。
func (b *ContextBuilder) BuildSection(sectionName string, fileContexts []FileContext, query string, maxTokens int, maxTotalChars int) string {
	if len(fileContexts) == 0 {
		return ""
	}
	if maxTotalChars <= 0 {
		maxTotalChars = 100000
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("<%s>\n", sectionName))
	totalTokens := estimateTokens(sb.String())

	for _, fc := range fileContexts {
		if len(fc.Chunks) == 0 {
			continue
		}

		sb.WriteString(fmt.Sprintf("### 文件: %s\n\n", fc.FileName))

		for _, result := range fc.Chunks {
			chunk := result.Chunk
			chunkText := b.formatChunk(chunk, result.Relevance)

			remainingChars := maxTotalChars - sb.Len()
			if remainingChars <= 0 {
				sb.WriteString("\n... (已达到总字数上限) ...\n")
				break
			}
			if len(chunkText) > remainingChars {
				marker := "\n... (已达到总字数上限) ...\n"
				if remainingChars > len(marker) {
					sb.WriteString(chunkText[:remainingChars-len(marker)])
				}
				sb.WriteString(marker)
				break
			}

			chunkTokens := estimateTokens(chunkText)
			if maxTokens > 0 && totalTokens+chunkTokens > maxTokens {
				sb.WriteString("\n... (已截断，达到上下文长度上限) ...\n")
				break
			}

			sb.WriteString(chunkText)
			totalTokens += chunkTokens
		}

		sb.WriteString("\n")
		if sb.Len() >= maxTotalChars {
			break
		}
	}

	sb.WriteString(fmt.Sprintf("</%s>", sectionName))
	return sb.String()
}

// PreviewRunes 安全截取前 n 个字符（按 rune，不截断半个 UTF-8 字符）
func PreviewRunes(s string, n int) string {
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	return string(rs[:n])
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
