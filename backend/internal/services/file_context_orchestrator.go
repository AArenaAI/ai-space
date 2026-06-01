package services

import (
	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/models"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gorm.io/gorm"
)

const (
	DefaultCurrentFileContextChars    = 100000
	DefaultHistoricalFileContextChars = 40000
)

// FileContextPackage 是聊天层可直接注入模型的文件上下文包。
// Current files（本轮上传）与 historical/context files 分开处理，避免当前附件被历史文件 RAG 稀释。
type FileContextPackage struct {
	SystemPrompt string
	NativeParts  []ModelPart
	Warnings     []string
	UsedFileIDs  []uint
	Sources      []FileContextSource
}

// FileContextSource 是返回给前端展示的安全来源信息，不暴露 file_id/chunk_id/metadata。
type FileContextSource struct {
	Title       string  `json:"title"`
	Filename    string  `json:"filename"`
	Description string  `json:"description"`
	Snippet     string  `json:"snippet"`
	Page        int     `json:"page,omitempty"`
	Slide       int     `json:"slide,omitempty"`
	SheetName   string  `json:"sheet_name,omitempty"`
	Score       float64 `json:"score,omitempty"`
	Type        string  `json:"type,omitempty"`
}

type ModelPart struct {
	Type     string
	MimeType string
	DataURI  string
	FileID   uint
	Filename string
}

const defaultNativeFileMaxBytes int64 = 25 * 1024 * 1024

type FileContextBuildRequest struct {
	CurrentFiles    []models.File
	HistoricalFiles []models.File
	Query           string
	Model           string
	LogPrefix       string
}

type FileContextOrchestrator struct {
	db             *gorm.DB
	retrievalSvc   *RetrievalService
	contextBuilder *ContextBuilder
}

func NewFileContextOrchestrator(db *gorm.DB, retrievalSvc *RetrievalService, contextBuilder *ContextBuilder) *FileContextOrchestrator {
	return &FileContextOrchestrator{db: db, retrievalSvc: retrievalSvc, contextBuilder: contextBuilder}
}

func (o *FileContextOrchestrator) Build(req FileContextBuildRequest) FileContextPackage {
	logPrefix := strings.TrimSpace(req.LogPrefix)
	if logPrefix == "" {
		logPrefix = "FileContext"
	}

	pkg := FileContextPackage{}
	if o == nil || o.db == nil || o.contextBuilder == nil {
		return pkg
	}

	currentNativeFiles := uniqueFilesByID(req.CurrentFiles)
	var nativeFileIDs []uint
	if len(currentNativeFiles) > 0 {
		nativeParts, nativeWarnings := o.buildCurrentNativeParts(currentNativeFiles, req.Model, logPrefix)
		pkg.NativeParts = append(pkg.NativeParts, nativeParts...)
		pkg.Warnings = append(pkg.Warnings, nativeWarnings...)
		for _, part := range nativeParts {
			pkg.UsedFileIDs = appendUniqueUint(pkg.UsedFileIDs, part.FileID)
			nativeFileIDs = appendUniqueUint(nativeFileIDs, part.FileID)
		}
	}

	currentReady, currentWarnings := filterReadyFilesExcept(req.CurrentFiles, nativeFileIDs)
	historicalReady, historicalWarnings := filterReadyFiles(req.HistoricalFiles)
	pkg.Warnings = append(pkg.Warnings, currentWarnings...)
	pkg.Warnings = append(pkg.Warnings, historicalWarnings...)

	var parts []string
	if len(currentReady) > 0 {
		currentContext, currentSources := o.buildDirectCurrentContext(currentReady, req.Query, req.Model, logPrefix)
		if currentContext != "" {
			parts = append(parts, currentContext)
			pkg.UsedFileIDs = appendUniqueUint(pkg.UsedFileIDs, fileIDs(currentReady)...)
			pkg.Sources = append(pkg.Sources, currentSources...)
		}
	}

	if len(historicalReady) > 0 && o.retrievalSvc != nil {
		historicalContext, historicalSources := o.buildHistoricalContext(historicalReady, req.Query, req.Model, logPrefix)
		if historicalContext != "" {
			parts = append(parts, historicalContext)
			pkg.UsedFileIDs = appendUniqueUint(pkg.UsedFileIDs, fileIDs(historicalReady)...)
			pkg.Sources = append(pkg.Sources, historicalSources...)
		}
	}

	if len(parts) == 0 && len(pkg.NativeParts) == 0 && len(pkg.Warnings) == 0 {
		return pkg
	}

	var sb strings.Builder
	sb.WriteString("<file_context>\n")
	sb.WriteString("<instruction>\n")
	sb.WriteString("以下是文件上下文。current_files 是用户本轮上传/附加的当前文件，优先级最高；historical_files 仅作补充。\n")
	sb.WriteString("回答涉及文件的问题时，必须优先依据 current_files；不要把历史文件当成本轮上传文件。\n")
	sb.WriteString("如果 warning 提示有文件未解析完成，不要猜测其内容，直接说明该文件暂不可参与回答。\n")
	sb.WriteString("引用文件时请注明来源文件名。\n")
	sb.WriteString("</instruction>\n\n")
	if len(pkg.Warnings) > 0 {
		sb.WriteString("<warnings>\n")
		for _, w := range pkg.Warnings {
			sb.WriteString("- ")
			sb.WriteString(w)
			sb.WriteString("\n")
		}
		sb.WriteString("</warnings>\n\n")
	}
	sb.WriteString(strings.Join(parts, "\n\n"))
	if len(parts) > 0 {
		sb.WriteString("\n")
	}
	sb.WriteString("</file_context>\n")
	pkg.SystemPrompt = sb.String()
	fmt.Printf("[%s FileContext] built current=%d historical=%d nativeParts=%d warnings=%d length=%d\n", logPrefix, len(currentReady), len(historicalReady), len(pkg.NativeParts), len(pkg.Warnings), len(pkg.SystemPrompt))
	return pkg
}

func (o *FileContextOrchestrator) buildCurrentNativeParts(files []models.File, model string, logPrefix string) ([]ModelPart, []string) {
	if !supportsNativeVision(model) && !supportsNativeFileInput(model) {
		return nil, nil
	}

	var parts []ModelPart
	var warnings []string
	for _, file := range files {
		if isImageModelFile(file) {
			if !supportsNativeVision(model) {
				continue
			}
			if file.Size > defaultNativeImageMaxBytes {
				warnings = append(warnings, fmt.Sprintf("图片 %s 超过原图直传大小限制，已回退使用解析文本。", file.Filename))
				continue
			}
			data, err := os.ReadFile(file.StoragePath)
			if err != nil {
				warnings = append(warnings, fmt.Sprintf("图片 %s 原图读取失败，已回退使用解析文本。", file.Filename))
				fmt.Printf("[%s FileContext] native image read failed fileID=%d path=%s err=%v\n", logPrefix, file.ID, file.StoragePath, err)
				continue
			}
			mimeType := strings.TrimSpace(file.MimeType)
			if mimeType == "" || mimeType == "image" {
				mimeType = mimeTypeFromImageExt(file.Filename)
			}
			parts = append(parts, ModelPart{
				Type:     "image",
				MimeType: mimeType,
				DataURI:  "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data),
				FileID:   file.ID,
				Filename: file.Filename,
			})
			fmt.Printf("[%s FileContext] native image attached fileID=%d name=%s bytes=%d model=%s\n", logPrefix, file.ID, file.Filename, len(data), model)
			continue
		}

		inputType := fileInputType(file)
		if !supportsNativeFileInput(model) || !modelmeta.SupportsInput(model, inputType) {
			continue
		}
		if file.Size > defaultNativeFileMaxBytes {
			warnings = append(warnings, fmt.Sprintf("文件 %s 超过原文件直传大小限制，已回退使用解析文本。", file.Filename))
			continue
		}
		data, err := os.ReadFile(file.StoragePath)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("文件 %s 原文件读取失败，已回退使用解析文本。", file.Filename))
			fmt.Printf("[%s FileContext] native file read failed fileID=%d path=%s err=%v\n", logPrefix, file.ID, file.StoragePath, err)
			continue
		}
		mimeType := nativeFileMimeType(file)
		parts = append(parts, ModelPart{
			Type:     "file",
			MimeType: mimeType,
			DataURI:  "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data),
			FileID:   file.ID,
			Filename: file.Filename,
		})
		fmt.Printf("[%s FileContext] native file attached fileID=%d name=%s input=%s bytes=%d model=%s\n", logPrefix, file.ID, file.Filename, inputType, len(data), model)
	}
	return parts, warnings
}

func (o *FileContextOrchestrator) buildDirectCurrentContext(files []models.File, query string, model string, logPrefix string) (string, []FileContextSource) {
	fileNames := fileNameMap(files)
	var contexts []FileContext
	var allResults []ChunkSearchResult

	for _, file := range files {
		chunks := o.loadDirectChunks(file, DefaultCurrentFileContextChars)
		if len(chunks) == 0 {
			fmt.Printf("[%s FileContext] current file has no chunks fileID=%d name=%s\n", logPrefix, file.ID, file.Filename)
			continue
		}
		results := make([]ChunkSearchResult, 0, len(chunks))
		for _, c := range chunks {
			result := ChunkSearchResult{Chunk: c, Score: 1, Relevance: "current"}
			results = append(results, result)
			allResults = append(allResults, result)
		}
		contexts = append(contexts, FileContext{FileName: fileNames[file.ID], Chunks: results})
		fmt.Printf("[%s FileContext] current direct fileID=%d chunks=%d\n", logPrefix, file.ID, len(chunks))
	}

	body := o.contextBuilder.BuildSection("current_files", contexts, query, maxFileContextTokensForModel(model), DefaultCurrentFileContextChars)
	return body, BuildFileContextSources(allResults, fileNames, 6)
}

func (o *FileContextOrchestrator) buildHistoricalContext(files []models.File, query string, model string, logPrefix string) (string, []FileContextSource) {
	var allResults []ChunkSearchResult
	var imageFileIDs []uint
	var docFileIDs []uint
	for _, file := range files {
		if isImageModelFile(file) {
			imageFileIDs = append(imageFileIDs, file.ID)
		} else {
			docFileIDs = append(docFileIDs, file.ID)
		}
	}

	for _, fid := range imageFileIDs {
		var chunks []models.FileChunk
		if err := o.db.Where("file_id = ? AND block_type = ?", fid, "image_caption").Order("chunk_index").Find(&chunks).Error; err != nil {
			fmt.Printf("[%s FileContext] historical image chunks failed fileID=%d: %v\n", logPrefix, fid, err)
			continue
		}
		for _, c := range chunks {
			allResults = append(allResults, ChunkSearchResult{Chunk: c, Score: 1, Relevance: "image_caption"})
		}
	}

	if len(docFileIDs) > 0 {
		if IsDocumentOverviewQuery(query) {
			for _, fid := range docFileIDs {
				var chunks []models.FileChunk
				if err := o.db.Where("file_id = ?", fid).Order("chunk_index").Find(&chunks).Error; err != nil {
					fmt.Printf("[%s FileContext] historical overview chunks failed fileID=%d: %v\n", logPrefix, fid, err)
					continue
				}
				selected := SelectOverviewChunks(chunks, query, DefaultHistoricalFileContextChars)
				for _, c := range selected {
					allResults = append(allResults, ChunkSearchResult{Chunk: c, Score: 1, Relevance: "overview"})
				}
			}
		} else {
			results, err := o.retrievalSvc.Search(docFileIDs, query, DynamicTopK(model), false)
			fmt.Printf("[%s FileContext] historical search docFileIDs=%v query=%q results=%d err=%v\n", logPrefix, docFileIDs, query, len(results), err)
			if err == nil {
				allResults = append(allResults, results...)
			}
		}
	}

	if len(allResults) == 0 {
		return "", nil
	}
	fileNames := fileNameMap(files)
	contexts := ExtractFileContexts(allResults, fileNames)
	return o.contextBuilder.BuildSection("historical_files", contexts, query, maxFileContextTokensForModel(model), DefaultHistoricalFileContextChars), BuildFileContextSources(allResults, fileNames, 6)
}

func (o *FileContextOrchestrator) loadDirectChunks(file models.File, maxChars int) []models.FileChunk {
	var chunks []models.FileChunk
	q := o.db.Where("file_id = ?", file.ID)
	if isImageModelFile(file) {
		q = q.Where("block_type = ?", "image_caption")
	}
	if err := q.Order("chunk_index").Find(&chunks).Error; err != nil {
		return nil
	}
	return trimChunksByChars(chunks, maxChars)
}

func filterReadyFiles(files []models.File) ([]models.File, []string) {
	return filterReadyFilesExcept(files, nil)
}

func filterReadyFilesExcept(files []models.File, skipWarningFileIDs []uint) ([]models.File, []string) {
	ready := make([]models.File, 0, len(files))
	var warnings []string
	seen := map[uint]struct{}{}
	skipWarnings := make(map[uint]struct{}, len(skipWarningFileIDs))
	for _, id := range skipWarningFileIDs {
		skipWarnings[id] = struct{}{}
	}
	for _, f := range files {
		if _, ok := seen[f.ID]; ok {
			continue
		}
		seen[f.ID] = struct{}{}
		if f.ParseStatus != "done" {
			if _, ok := skipWarnings[f.ID]; ok {
				continue
			}
			status := strings.TrimSpace(f.ParseStatus)
			if status == "" {
				status = "unknown"
			}
			warnings = append(warnings, fmt.Sprintf("文件 %s 尚未解析完成（status=%s），本轮不会使用其内容。", f.Filename, status))
			continue
		}
		ready = append(ready, f)
	}
	return ready, warnings
}

func uniqueFilesByID(files []models.File) []models.File {
	out := make([]models.File, 0, len(files))
	seen := map[uint]struct{}{}
	for _, f := range files {
		if _, ok := seen[f.ID]; ok {
			continue
		}
		seen[f.ID] = struct{}{}
		out = append(out, f)
	}
	return out
}

func trimChunksByChars(chunks []models.FileChunk, maxChars int) []models.FileChunk {
	if maxChars <= 0 {
		return chunks
	}
	sort.SliceStable(chunks, func(i, j int) bool { return chunks[i].ChunkIndex < chunks[j].ChunkIndex })
	used := 0
	out := make([]models.FileChunk, 0, len(chunks))
	for _, c := range chunks {
		text := c.Markdown
		if text == "" {
			text = c.Content
		}
		if text == "" {
			continue
		}
		remaining := maxChars - used
		if remaining <= 0 {
			break
		}
		if len(text) > remaining {
			if c.Markdown != "" {
				c.Markdown = text[:remaining] + "\n...（当前文件内容已截断）..."
			} else {
				c.Content = text[:remaining] + "\n...（当前文件内容已截断）..."
			}
			out = append(out, c)
			break
		}
		used += len(text)
		out = append(out, c)
	}
	return out
}

func fileIDs(files []models.File) []uint {
	ids := make([]uint, 0, len(files))
	for _, f := range files {
		ids = append(ids, f.ID)
	}
	return ids
}

func fileNameMap(files []models.File) map[uint]string {
	names := make(map[uint]string, len(files))
	for _, f := range files {
		names[f.ID] = f.Filename
	}
	return names
}

func BuildFileContextSources(results []ChunkSearchResult, fileNames map[uint]string, limit int) []FileContextSource {
	if limit <= 0 {
		limit = 6
	}
	out := make([]FileContextSource, 0, limit)
	seen := map[string]struct{}{}
	for _, result := range results {
		if len(out) >= limit {
			break
		}
		chunk := result.Chunk
		text := strings.TrimSpace(chunk.Markdown)
		if text == "" {
			text = strings.TrimSpace(chunk.Content)
		}
		if text == "" {
			continue
		}
		filename := strings.TrimSpace(fileNames[chunk.FileID])
		if filename == "" {
			filename = "资料文件"
		}
		key := fmt.Sprintf("%s:%d:%s", filename, chunk.ChunkIndex, PreviewRunes(text, 32))
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		source := FileContextSource{
			Title:       filename,
			Filename:    filename,
			Description: buildSourceDescription(chunk),
			Snippet:     cleanSourceSnippet(text, 220),
			Page:        chunk.Page,
			Slide:       chunk.Slide,
			SheetName:   chunk.SheetName,
			Score:       result.Score,
			Type:        "notebook_file",
		}
		out = append(out, source)
	}
	return out
}

func buildSourceDescription(chunk models.FileChunk) string {
	var parts []string
	if chunk.Page > 0 {
		parts = append(parts, fmt.Sprintf("第 %d 页", chunk.Page))
	}
	if chunk.Slide > 0 {
		parts = append(parts, fmt.Sprintf("第 %d 张幻灯片", chunk.Slide))
	}
	if strings.TrimSpace(chunk.SheetName) != "" {
		parts = append(parts, fmt.Sprintf("工作表 %s", strings.TrimSpace(chunk.SheetName)))
	}
	if len(parts) == 0 {
		return "命中文本片段"
	}
	return strings.Join(parts, " · ")
}

func cleanSourceSnippet(text string, limit int) string {
	text = strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
	if limit <= 0 {
		limit = 220
	}
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit]) + "…"
}

func appendUniqueUint(dst []uint, values ...uint) []uint {
	seen := make(map[uint]struct{}, len(dst)+len(values))
	for _, v := range dst {
		seen[v] = struct{}{}
	}
	for _, v := range values {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		dst = append(dst, v)
	}
	return dst
}

func isImageModelFile(file models.File) bool {
	return file.MimeType == "image" || strings.HasPrefix(file.MimeType, "image/")
}

const defaultNativeImageMaxBytes int64 = 20 * 1024 * 1024

func supportsNativeVision(model string) bool {
	return modelmeta.SupportsInput(model, "image")
}

func supportsNativeFileInput(model string) bool {
	return strings.HasPrefix(model, "gpt-") || strings.HasPrefix(model, "gemini-")
}

func fileInputType(file models.File) string {
	return modelmeta.FileInputType(file.Filename, file.MimeType)
}

func nativeFileMimeType(file models.File) string {
	mimeType := strings.TrimSpace(file.MimeType)
	if mimeType != "" && mimeType != "application/octet-stream" {
		return mimeType
	}
	return modelmeta.MimeTypeForFile(file.Filename)
}

func mimeTypeFromImageExt(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return "image/png"
	}
}

func maxFileContextTokensForModel(model string) int {
	if strings.Contains(model, "flash") || strings.Contains(model, "8k") {
		return 8000
	}
	if strings.Contains(model, "opus") || strings.Contains(model, "200k") {
		return 12000
	}
	return 0
}
