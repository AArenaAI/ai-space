package services

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"aipool-backend/internal/config"
	"github.com/ledongthuc/pdf"
)

// ParseResult 文件解析结果
type ParseResult struct {
	Content     string       // 完整文本（Markdown）
	Summary     string       // 文件摘要
	Pages       int          // 页数
	Chunks      []TextChunk  // 切块
	HasImages   bool         // 是否包含图片（需要 Vision 增强）
	HasTables   bool         // 是否包含表格
	TokenCount  int          // 总 token 数
	VisionUsage *VisionUsage // Vision API token 消耗（仅图片解析有值）
}

// TextChunk 文本块（结构化）
type TextChunk struct {
	Index      int
	BlockID    string // 例如 "p3-b7"
	Page       int
	Slide      int    // PPT 幻灯片编号
	SheetName  string // Excel sheet 名称
	BlockType  string // paragraph | table | heading | image_ref | code
	Text       string // 纯文本内容
	Markdown   string // Markdown 格式内容（如果不同于 Text）
	TokenCount int    // token 数
	Metadata   string // JSON 字符串
}

// FileParser 文件解析器
type FileParser struct {
	cfg       *config.Config
	aiService *AIService
}

// NewFileParser 创建文件解析器
func NewFileParser(cfg *config.Config, aiService *AIService) *FileParser {
	return &FileParser{cfg: cfg, aiService: aiService}
}

// Parse 根据文件类型解析
func (p *FileParser) Parse(ctx context.Context, data []byte, filename string) (*ParseResult, error) {
	ext := strings.ToLower(filepath.Ext(filename))

	switch ext {
	case ".txt", ".md", ".url", ".json", ".csv", ".js", ".ts", ".go", ".py", ".java",
		".cpp", ".c", ".h", ".hpp", ".rs", ".html", ".css", ".xml", ".yaml",
		".yml", ".log", ".sql", ".sh", ".bash", ".tsx", ".jsx", ".vue", ".php",
		".rb", ".swift", ".kt", ".scala", ".r", ".matlab", ".tex":
		return p.parseText(data, filename)
	case ".pdf":
		return p.parseDocumentWithVisionFallback(ctx, data, filename, p.parsePDF)
	case ".docx":
		return p.parseDocumentWithVisionFallback(ctx, data, filename, p.parseDOCX)
	case ".pptx":
		return p.parseDocumentWithVisionFallback(ctx, data, filename, p.parsePPTX)
	case ".xlsx":
		return p.parseXLSX(data)
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp":
		return p.parseImage(ctx, data, ext)
	case ".mp4", ".mov":
		return &ParseResult{
			Content:    "",
			Pages:      1,
			Chunks:     nil,
			TokenCount: 0,
		}, nil
	default:
		return p.parseText(data, filename) // fallback
	}
}

// parseDocumentWithVisionFallback 先做本地文本解析，再尝试视觉文档解析；视觉失败时回退本地结果。
func (p *FileParser) parseDocumentWithVisionFallback(ctx context.Context, data []byte, filename string, localParser func([]byte) (*ParseResult, error)) (*ParseResult, error) {
	localResult, localErr := localParser(data)

	if p.shouldUseVisionDocumentParser(data, filename, localResult, localErr) {
		visionResult, visionErr := p.parseComplexDocumentWithVision(ctx, data, filename)
		if visionErr == nil && visionResult != nil && strings.TrimSpace(visionResult.Content) != "" {
			if localResult != nil && strings.TrimSpace(localResult.Content) != "" {
				visionResult.Content = strings.TrimSpace(localResult.Content) + "\n\n---\n\n# 视觉增强解析\n\n" + strings.TrimSpace(visionResult.Content)
				visionResult.Chunks = append(localResult.Chunks, reindexChunks(visionResult.Chunks, len(localResult.Chunks))...)
				visionResult.HasTables = visionResult.HasTables || localResult.HasTables
			}
			return visionResult, nil
		}
	}

	if localErr != nil {
		return nil, localErr
	}
	return localResult, nil
}

func (p *FileParser) shouldUseVisionDocumentParser(data []byte, filename string, localResult *ParseResult, localErr error) bool {
	if p.cfg == nil || !p.cfg.VisionDocEnable {
		return false
	}
	if p.aiService == nil {
		return false
	}
	maxMB := p.cfg.VisionDocMaxFileMB
	if maxMB <= 0 {
		maxMB = defaultVisionDocMaxFileMB
	}
	if len(data) > maxMB*1024*1024 {
		return false
	}

	ext := strings.ToLower(filepath.Ext(filename))
	if ext == ".pptx" {
		return true
	}
	if localErr != nil || localResult == nil || strings.TrimSpace(localResult.Content) == "" {
		return true
	}

	textRunes := len([]rune(strings.TrimSpace(localResult.Content)))
	if ext == ".pdf" {
		pages := localResult.Pages
		if pages <= 0 {
			pages = 1
		}
		return textRunes/pages < 120
	}
	if ext == ".docx" {
		return officeZipHasMedia(data, "word/media/") || textRunes < 300
	}
	return false
}

func officeZipHasMedia(data []byte, prefix string) bool {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return false
	}
	for _, f := range r.File {
		if strings.HasPrefix(f.Name, prefix) {
			return true
		}
	}
	return false
}

func reindexChunks(chunks []TextChunk, offset int) []TextChunk {
	out := make([]TextChunk, len(chunks))
	copy(out, chunks)
	for i := range out {
		out[i].Index = offset + i
	}
	return out
}

// parseText 解析纯文本/代码文件
func (p *FileParser) parseText(data []byte, filename string) (*ParseResult, error) {
	content := string(data)
	if !utf8.Valid(data) {
		content = string(bytes.Map(func(r rune) rune {
			if r == utf8.RuneError {
				return '�'
			}
			return r
		}, data))
	}

	ext := strings.ToLower(filepath.Ext(filename))
	isCode := isCodeFile(ext)
	blockType := "paragraph"
	metadata := ""
	if isCode {
		blockType = "code"
		lang := codeLanguage(ext)
		metadata = fmt.Sprintf(`{"language":"%s","filename":"%s"}`, lang, filename)
		// 包裵成 Markdown 代码块
		content = fmt.Sprintf("```%s\n%s\n```", lang, strings.TrimRight(content, "\n"))
	}

	chunks := chunkStructured(content, 1, blockType, metadata)
	return &ParseResult{
		Content: content,
		Pages:   1,
		Chunks:  chunks,
	}, nil
}

// isCodeFile 判断是否为代码文件
func isCodeFile(ext string) bool {
	switch ext {
	case ".go", ".py", ".js", ".ts", ".java", ".cpp", ".c", ".h", ".hpp",
		".rs", ".html", ".css", ".xml", ".yaml", ".yml", ".sql", ".sh",
		".bash", ".tsx", ".jsx", ".vue", ".php", ".rb", ".swift", ".kt",
		".scala", ".r", ".matlab", ".tex", ".json", ".csv":
		return true
	}
	return false
}

// codeLanguage 拓展名转编程语言标识
func codeLanguage(ext string) string {
	langMap := map[string]string{
		".go": "go", ".py": "python", ".js": "javascript", ".ts": "typescript",
		".java": "java", ".cpp": "cpp", ".c": "c", ".h": "c", ".hpp": "cpp",
		".rs": "rust", ".html": "html", ".css": "css", ".xml": "xml",
		".yaml": "yaml", ".yml": "yaml", ".sql": "sql", ".sh": "bash",
		".bash": "bash", ".tsx": "tsx", ".jsx": "jsx", ".vue": "vue",
		".php": "php", ".rb": "ruby", ".swift": "swift", ".kt": "kotlin",
		".scala": "scala", ".r": "r", ".matlab": "matlab", ".tex": "latex",
		".json": "json", ".csv": "csv",
	}
	if l, ok := langMap[ext]; ok {
		return l
	}
	return ""
}

// parsePDF 解析 PDF（结构化：检测表格、生成 BlockID）
func (p *FileParser) parsePDF(data []byte) (*ParseResult, error) {
	if result, err := p.parsePDFWithPoppler(data); err == nil && result != nil && hasReadablePDFText(result.Content) {
		return result, nil
	}

	tmpFile, err := os.CreateTemp("", "*.pdf")
	if err != nil {
		return nil, fmt.Errorf("创建临时文件失败: %w", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		return nil, fmt.Errorf("写入临时文件失败: %w", err)
	}
	tmpFile.Close()

	f, r, err := pdf.Open(tmpFile.Name())
	if err != nil {
		return nil, fmt.Errorf("打开 PDF 失败: %w", err)
	}
	defer f.Close()

	var result strings.Builder
	var chunks []TextChunk
	totalPage := r.NumPage()
	hasTables := false
	blockCounter := 0

	for pageIndex := 1; pageIndex <= totalPage; pageIndex++ {
		pg := r.Page(pageIndex)
		if pg.V.IsNull() {
			continue
		}
		text, err := pg.GetPlainText(nil)
		if err != nil {
			continue
		}

		// 分块检测：表格、段落、标题
		blocks := detectBlocks(text, pageIndex)
		for _, blk := range blocks {
			blockCounter++
			blk.Index = blockCounter - 1
			blk.BlockID = fmt.Sprintf("p%d-b%d", pageIndex, blockCounter)
			chunks = append(chunks, blk)
			result.WriteString(blk.Text)
			result.WriteString("\n\n")
			if blk.BlockType == "table" {
				hasTables = true
			}
		}
	}

	return &ParseResult{
		Content:   result.String(),
		Pages:     totalPage,
		Chunks:    chunks,
		HasTables: hasTables,
	}, nil
}

func (p *FileParser) parsePDFWithPoppler(data []byte) (*ParseResult, error) {
	if _, err := exec.LookPath("pdftotext"); err != nil {
		return nil, err
	}

	tmpFile, err := os.CreateTemp("", "*.pdf")
	if err != nil {
		return nil, fmt.Errorf("创建临时 PDF 文件失败: %w", err)
	}
	defer os.Remove(tmpFile.Name())
	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		return nil, fmt.Errorf("写入临时 PDF 文件失败: %w", err)
	}
	tmpFile.Close()

	out, err := exec.Command("pdftotext", "-layout", "-enc", "UTF-8", tmpFile.Name(), "-").Output()
	if err != nil {
		return nil, fmt.Errorf("pdftotext 解析 PDF 失败: %w", err)
	}
	content := normalizeExtractedPDFText(string(out))
	if strings.TrimSpace(content) == "" {
		return nil, fmt.Errorf("pdftotext 解析 PDF 内容为空")
	}

	chunks := chunkPDFTextByPage(content)
	if len(chunks) == 0 {
		chunks = chunkStructured(content, 1, "paragraph", `{"source":"pdftotext"}`)
	}
	hasTables := false
	for _, chunk := range chunks {
		if chunk.BlockType == "table" || strings.Contains(chunk.Text, "|") {
			hasTables = true
			break
		}
	}

	return &ParseResult{
		Content:   content,
		Pages:     max(1, strings.Count(content, "\f")+1),
		Chunks:    chunks,
		HasTables: hasTables,
	}, nil
}

func normalizeExtractedPDFText(text string) string {
	text = strings.ReplaceAll(text, "\x00", "")
	text = regexp.MustCompile(`[	 ]+\n`).ReplaceAllString(text, "\n")
	text = regexp.MustCompile(`\n{4,}`).ReplaceAllString(text, "\n\n\n")
	return strings.TrimSpace(text)
}

func chunkPDFTextByPage(content string) []TextChunk {
	pages := strings.Split(content, "\f")
	var chunks []TextChunk
	for i, page := range pages {
		pageText := strings.TrimSpace(page)
		if pageText == "" {
			continue
		}
		blocks := detectBlocks(pageText, i+1)
		for j := range blocks {
			blocks[j].Index = len(chunks)
			blocks[j].BlockID = fmt.Sprintf("p%d-b%d", i+1, j+1)
			blocks[j].Page = i + 1
			if blocks[j].Metadata == "" {
				blocks[j].Metadata = `{"source":"pdftotext"}`
			}
			chunks = append(chunks, blocks[j])
		}
	}
	return chunks
}

func hasReadablePDFText(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}
	runes := []rune(trimmed)
	bad := 0
	letters := 0
	for _, r := range runes {
		if r == '�' || r < 32 && r != '\n' && r != '\r' && r != '	' && r != '\f' {
			bad++
		}
		if r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '\u4e00' && r <= '\u9fff' {
			letters++
		}
	}
	if len(runes) > 0 && float64(bad)/float64(len(runes)) > 0.02 {
		return false
	}
	return letters >= 20
}

// detectBlocks 将页面文本检测为不同类型的 block
func detectBlocks(pageText string, pageNum int) []TextChunk {
	lines := strings.Split(pageText, "\n")
	var blocks []TextChunk
	var current strings.Builder
	currentType := "paragraph"
	inTable := false
	blockIdx := 0

	flushBlock := func() {
		text := strings.TrimSpace(current.String())
		if text == "" {
			return
		}
		blocks = append(blocks, TextChunk{
			Index:     blockIdx,
			BlockID:   fmt.Sprintf("p%d-b%d", pageNum, blockIdx+1),
			Page:      pageNum,
			BlockType: currentType,
			Text:      text,
		})
		blockIdx++
		current.Reset()
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			flushBlock()
			inTable = false
			continue
		}

		// 表格检测：包含 | 或 多空格对齐
		isTableLine := strings.Contains(trimmed, "|") || isAlignedColumns(trimmed)
		isTableBySpaces := isAlignedColumns(trimmed) && !strings.Contains(trimmed, "|")

		if isTableLine && !inTable {
			// 开始新表格
			flushBlock()
			currentType = "table"
			inTable = true
			if isTableBySpaces {
				current.WriteString(formatTableRow(trimmed))
			} else {
				current.WriteString(trimmed + "\n")
			}
		} else if isTableLine && inTable {
			if isTableBySpaces {
				current.WriteString(formatTableRow(trimmed))
			} else {
				current.WriteString(trimmed + "\n")
			}
		} else if !isTableLine && inTable {
			// 表格结束
			flushBlock()
			currentType = "paragraph"
			inTable = false
			current.WriteString(trimmed + "\n")
		} else {
			// 标题检测：短行、全大写、以数字结尾
			if len(trimmed) < 100 && (isHeadingLike(trimmed) || strings.HasPrefix(trimmed, "Table ") || strings.HasPrefix(trimmed, "Fig. ")) {
				if current.Len() > 0 {
					flushBlock()
				}
				currentType = "heading"
				current.WriteString(trimmed)
				flushBlock()
				currentType = "paragraph"
			} else {
				if current.Len() > 0 {
					current.WriteString("\n")
				}
				current.WriteString(trimmed)
			}
		}
	}
	flushBlock()
	// 为所有 table 类型的 block 添加 Markdown 表头分隔线
	for i := range blocks {
		if blocks[i].BlockType == "table" {
			blocks[i].Text = ensureTableHeaderSeparator(blocks[i].Text)
		}
	}
	return blocks
}

// isAlignedColumns 检测是否像列对齐（简单启发式）
func isAlignedColumns(line string) bool {
	// 检测是否有多个连续空格区域（3个以上空格）
	return strings.Count(line, "  ") >= 3 && len(line) > 20
}

// formatTableRow 将多空格对齐的行转换为 Markdown 表格行
func formatTableRow(line string) string {
	// 按多个连续空格分割
	fields := strings.Fields(line)
	return "| " + strings.Join(fields, " | ") + " |\n"
}

// ensureTableHeaderSeparator 确保 Markdown 表格有标准的表头分隔线
func ensureTableHeaderSeparator(tableText string) string {
	lines := strings.Split(strings.TrimSpace(tableText), "\n")
	if len(lines) < 1 {
		return tableText
	}
	// 检测第二行是否已经是分隔线
	if len(lines) >= 2 && strings.Contains(lines[1], "---") {
		return tableText
	}
	// 从第一行推断列数
	firstLine := lines[0]
	colCount := strings.Count(firstLine, "|") - 1
	if colCount < 1 {
		colCount = len(strings.Fields(firstLine))
	}
	sepParts := make([]string, colCount)
	for i := range sepParts {
		sepParts[i] = "---"
	}
	sepLine := "| " + strings.Join(sepParts, " | ") + " |"
	// 插入分隔线
	newLines := append([]string{lines[0], sepLine}, lines[1:]...)
	return strings.Join(newLines, "\n") + "\n"
}

// isHeadingLike 检测是否像标题
func isHeadingLike(text string) bool {
	if len(text) > 120 {
		return false
	}
	// 全大写
	if text == strings.ToUpper(text) && len(text) > 3 {
		return true
	}
	// 以 Chapter / Section / 第 X 章 等开头
	headingPrefixes := []string{"CHAPTER", "SECTION", "APPENDIX", "FIGURE", "TABLE",
		"第", "Chapter", "Section", "Appendix"}
	for _, prefix := range headingPrefixes {
		if strings.HasPrefix(text, prefix) {
			return true
		}
	}
	return false
}

// parseDOCX 解析 Word 文档（识别标题层级）
func (p *FileParser) parseDOCX(data []byte) (*ParseResult, error) {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("解压 DOCX 失败: %w", err)
	}

	var documentXML string
	for _, f := range r.File {
		if f.Name == "word/document.xml" {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			content, err := io.ReadAll(rc)
			if err != nil {
				return nil, err
			}
			documentXML = string(content)
			break
		}
	}

	if documentXML == "" {
		return nil, fmt.Errorf("DOCX 中没有找到 document.xml")
	}

	blocks := extractDOCXBlocks(documentXML)
	var result strings.Builder
	var chunks []TextChunk
	for i, blk := range blocks {
		result.WriteString(blk.Text)
		result.WriteString("\n\n")
		chunks = append(chunks, TextChunk{
			Index:     i,
			BlockID:   fmt.Sprintf("docx-b%d", i+1),
			Page:      1,
			BlockType: blk.BlockType,
			Text:      blk.Text,
		})
	}

	return &ParseResult{
		Content: result.String(),
		Pages:   1,
		Chunks:  chunks,
	}, nil
}

// docxBlock DOCX 内部块结构
type docxBlock struct {
	Text      string
	BlockType string // heading | paragraph | table
	Level     int    // 标题级别 1-6
}

// extractDOCXBlocks 从 document.xml 提取结构化块
func extractDOCXBlocks(xmlStr string) []docxBlock {
	// 简单正则：提取 <w:pStyle w:val="Heading1"/> 等标签
	var blocks []docxBlock
	lines := strings.Split(xmlStr, "<w:p")

	for _, p := range lines {
		if p == "" || p == xmlStr {
			continue
		}
		text := extractTextFromXML("<w:p" + p)
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}

		// 检测标题样式
		level := 0
		for l := 1; l <= 6; l++ {
			if strings.Contains(p, fmt.Sprintf("Heading%d", l)) ||
				strings.Contains(p, fmt.Sprintf("标题%d", l)) {
				level = l
				break
			}
		}

		// 检测是否为表格
		isTable := strings.Contains(p, "<w:tbl")

		if isTable {
			// 将表格转为 Markdown 表格（简单处理）
			blocks = append(blocks, docxBlock{
				Text:      text,
				BlockType: "table",
			})
		} else if level > 0 {
			prefix := strings.Repeat("#", level)
			blocks = append(blocks, docxBlock{
				Text:      fmt.Sprintf("%s %s", prefix, text),
				BlockType: "heading",
				Level:     level,
			})
		} else {
			blocks = append(blocks, docxBlock{
				Text:      text,
				BlockType: "paragraph",
			})
		}
	}
	return blocks
}

// parsePPTX 解析 PowerPoint（区分标题/正文）
func (p *FileParser) parsePPTX(data []byte) (*ParseResult, error) {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("解压 PPTX 失败: %w", err)
	}

	var result strings.Builder
	var chunks []TextChunk
	chunkIdx := 0

	for i := 1; ; i++ {
		slideName := fmt.Sprintf("ppt/slides/slide%d.xml", i)
		found := false
		for _, f := range r.File {
			if f.Name == slideName {
				found = true
				rc, err := f.Open()
				if err != nil {
					continue
				}
				content, err := io.ReadAll(rc)
				rc.Close()
				if err != nil {
					continue
				}
				slideBlocks := extractPPTXSlideBlocks(string(content), i)
				for _, blk := range slideBlocks {
					if blk.Text == "" {
						continue
					}
					result.WriteString(blk.Text)
					result.WriteString("\n\n")
					chunks = append(chunks, TextChunk{
						Index:     chunkIdx,
						BlockID:   fmt.Sprintf("slide%d-b%d", i, chunkIdx+1),
						Page:      i,
						BlockType: blk.BlockType,
						Text:      blk.Text,
					})
					chunkIdx++
				}
				break
			}
		}
		if !found {
			break
		}
	}

	return &ParseResult{
		Content:   result.String(),
		Pages:     chunkIdx,
		Chunks:    chunks,
		HasImages: true,
	}, nil
}

// pptxSlideBlock PPTX 幻灯片内部块
type pptxSlideBlock struct {
	Text      string
	BlockType string // heading | paragraph | image_ref
}

// extractPPTXSlideBlocks 从 slide XML 提取结构化块
func extractPPTXSlideBlocks(xmlStr string, slideNum int) []pptxSlideBlock {
	var blocks []pptxSlideBlock
	// PPTX 中标题通常在 <a:p> 中且字体较大，简单检测：第一段作为标题
	lines := strings.Split(xmlStr, "<a:p")
	for idx, p := range lines {
		if p == "" || p == xmlStr {
			continue
		}
		text := extractTextFromXML("<a:p" + p)
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}

		// 第一段通常是标题
		blockType := "paragraph"
		if idx == 1 {
			blockType = "heading"
		}
		// 检测图片引用
		if strings.Contains(p, "<a:blip") {
			blocks = append(blocks, pptxSlideBlock{
				Text:      fmt.Sprintf("[Image in Slide %d]", slideNum),
				BlockType: "image_ref",
			})
		}
		blocks = append(blocks, pptxSlideBlock{
			Text:      text,
			BlockType: blockType,
		})
	}
	return blocks
}

// parseXLSX 解析 Excel（输出标准 Markdown 表格）
func (p *FileParser) parseXLSX(data []byte) (*ParseResult, error) {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("解压 XLSX 失败: %w", err)
	}

	sharedStrings := make(map[int]string)
	for _, f := range r.File {
		if f.Name == "xl/sharedStrings.xml" {
			rc, err := f.Open()
			if err != nil {
				break
			}
			content, err := io.ReadAll(rc)
			rc.Close()
			if err != nil {
				break
			}
			sharedStrings = parseSharedStrings(string(content))
			break
		}
	}

	var result strings.Builder
	var chunks []TextChunk
	chunkIdx := 0

	for i := 1; ; i++ {
		sheetName := fmt.Sprintf("xl/worksheets/sheet%d.xml", i)
		found := false
		for _, f := range r.File {
			if f.Name == sheetName {
				found = true
				rc, err := f.Open()
				if err != nil {
					continue
				}
				content, err := io.ReadAll(rc)
				rc.Close()
				if err != nil {
					continue
				}
				text, colCount := parseSheetXMLStructured(string(content), sharedStrings)
				if text != "" {
					result.WriteString(fmt.Sprintf("## Sheet %d\n\n", i))
					result.WriteString(text)
					result.WriteString("\n\n")
					chunks = append(chunks, TextChunk{
						Index:     chunkIdx,
						BlockID:   fmt.Sprintf("sheet%d", i),
						Page:      i,
						BlockType: "table",
						Text:      text,
						Metadata:  fmt.Sprintf(`{"table_cols":%d,"sheet":"Sheet%d"}`, colCount, i),
					})
					chunkIdx++
				}
				break
			}
		}
		if !found {
			break
		}
	}

	return &ParseResult{
		Content:   result.String(),
		Pages:     chunkIdx,
		Chunks:    chunks,
		HasTables: chunkIdx > 0,
	}, nil
}

// parseSheetXMLStructured 解析 XLSX sheet 为标准 Markdown 表格
func parseSheetXMLStructured(xmlStr string, sharedStrings map[int]string) (string, int) {
	type SheetData struct {
		XMLName xml.Name `xml:"sheetData"`
		Row     []struct {
			C []struct {
				T string `xml:"t,attr"`
				V string `xml:"v"`
			} `xml:"c"`
		} `xml:"row"`
	}

	start := strings.Index(xmlStr, "<sheetData")
	end := strings.Index(xmlStr, "</sheetData>")
	if start == -1 || end == -1 {
		return "", 0
	}
	sheetDataXML := xmlStr[start : end+len("</sheetData>")]

	var sd SheetData
	if err := xml.Unmarshal([]byte(sheetDataXML), &sd); err != nil {
		return "", 0
	}

	if len(sd.Row) == 0 {
		return "", 0
	}

	var result strings.Builder
	maxCols := 0

	for rowIdx, row := range sd.Row {
		var cells []string
		for _, cell := range row.C {
			value := cell.V
			if cell.T == "s" {
				if idx, err := parseInt(value); err == nil {
					if s, ok := sharedStrings[idx]; ok {
						value = s
					}
				}
			}
			cells = append(cells, value)
		}
		if len(cells) > maxCols {
			maxCols = len(cells)
		}
		result.WriteString("| ")
		result.WriteString(strings.Join(cells, " | "))
		result.WriteString(" |\n")

		// 第一行后添加 Markdown 表头分隔线
		if rowIdx == 0 {
			sep := make([]string, len(cells))
			for i := range sep {
				sep[i] = "---"
			}
			result.WriteString("| ")
			result.WriteString(strings.Join(sep, " | "))
			result.WriteString(" |\n")
		}
	}
	return result.String(), maxCols
}

// parseImage 解析图片：上传解析阶段优先调用 Vision 生成文字描述，作为 image_caption chunk 进入统一 RAG。
// Vision 失败时不能把图片附件标记为上传/解析失败；主聊天仍可把原图作为多模态附件发送。
func (p *FileParser) parseImage(ctx context.Context, data []byte, ext string) (*ParseResult, error) {
	mimeType := extToMimeType2(ext)
	if p.aiService == nil {
		return imageParseFallbackResult(), nil
	}

	caption, usage, err := p.aiService.ExtractImageContent(ctx, data, mimeType)
	if err != nil {
		return imageParseFallbackResult(), nil
	}
	caption = strings.TrimSpace(caption)
	if caption == "" {
		return imageParseFallbackResult(), nil
	}

	// 截断过长的 caption 到 2000 字符，避占用过多上下文（之前 500 太短，浪费了 vision 模型能力）
	if len([]rune(caption)) > 2000 {
		caption = string([]rune(caption)[:2000]) + "..."
	}

	content := fmt.Sprintf("图片视觉描述：\n%s", caption)
	metadata := fmt.Sprintf(`{"mime_type":"%s","source":"vision"}`, mimeType)
	chunks := chunkStructured(content, 1, "image_caption", metadata)
	for i := range chunks {
		chunks[i].BlockID = fmt.Sprintf("img-1-caption-%d", i+1)
		chunks[i].BlockType = "image_caption"
		chunks[i].Metadata = metadata
	}

	return &ParseResult{
		Content:     content,
		Pages:       1,
		Chunks:      chunks,
		HasImages:   true,
		Summary:     firstRunes(caption, 200),
		VisionUsage: usage,
	}, nil
}

func imageParseFallbackResult() *ParseResult {
	return &ParseResult{
		Content:    "",
		Pages:      1,
		Chunks:     nil,
		HasImages:  true,
		TokenCount: 0,
	}
}

func firstRunes(text string, max int) string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) <= max {
		return string(runes)
	}
	return string(runes[:max]) + "..."
}

// extToMimeType2 扩展名转 MIME 类型
func extToMimeType2(ext string) string {
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	default:
		return "image/jpeg"
	}
}

// extractTextFromXML 从 XML 中提取文本（简单标签剥离）
func extractTextFromXML(xmlStr string) string {
	var result strings.Builder
	inTag := false
	for i := 0; i < len(xmlStr); i++ {
		ch := xmlStr[i]
		if ch == '<' {
			inTag = true
			continue
		}
		if ch == '>' {
			inTag = false
			continue
		}
		if !inTag {
			result.WriteByte(ch)
		}
	}
	return strings.TrimSpace(result.String())
}

// parseSharedStrings 解析 XLSX shared strings
func parseSharedStrings(xmlStr string) map[int]string {
	result := make(map[int]string)
	type Sst struct {
		XMLName xml.Name `xml:"sst"`
		Si      []struct {
			T struct {
				Value string `xml:",chardata"`
			} `xml:"t"`
		} `xml:"si"`
	}
	var sst Sst
	if err := xml.Unmarshal([]byte(xmlStr), &sst); err != nil {
		return result
	}
	for i, si := range sst.Si {
		result[i] = si.T.Value
	}
	return result
}

// parseSheetXML 解析 XLSX sheet 为 Markdown 表格
func parseSheetXML(xmlStr string, sharedStrings map[int]string) string {
	type SheetData struct {
		XMLName xml.Name `xml:"sheetData"`
		Row     []struct {
			C []struct {
				T string `xml:"t,attr"`
				V string `xml:"v"`
			} `xml:"c"`
		} `xml:"row"`
	}

	// 提取 sheetData 部分
	start := strings.Index(xmlStr, "<sheetData")
	end := strings.Index(xmlStr, "</sheetData>")
	if start == -1 || end == -1 {
		return ""
	}
	sheetDataXML := xmlStr[start : end+len("</sheetData>")]

	var sd SheetData
	if err := xml.Unmarshal([]byte(sheetDataXML), &sd); err != nil {
		return ""
	}

	if len(sd.Row) == 0 {
		return ""
	}

	var result strings.Builder
	for _, row := range sd.Row {
		for j, cell := range row.C {
			value := cell.V
			if cell.T == "s" {
				// shared string reference
				if idx, err := parseInt(value); err == nil {
					if s, ok := sharedStrings[idx]; ok {
						value = s
					}
				}
			}
			if j > 0 {
				result.WriteString(" | ")
			}
			result.WriteString(value)
		}
		result.WriteString("\n")
	}
	return result.String()
}

func parseInt(s string) (int, error) {
	var n int
	_, err := fmt.Sscanf(s, "%d", &n)
	return n, err
}

// chunkStructured 按固定长度切分文本，优先在换行处切分，并带上块类型和元数据。
// 目标单块 10K 字符，上限 16K 字符，相邻块保留 800 字符 overlap。
func chunkStructured(text string, page int, blockType string, metadata string) []TextChunk {
	const targetChunkRunes = 10000
	const maxChunkRunes = 16000
	const overlapRunes = 800

	runes := []rune(text)
	if len(runes) <= targetChunkRunes {
		return []TextChunk{{
			Index:     0,
			BlockID:   fmt.Sprintf("p%d-b1", page),
			Page:      page,
			BlockType: blockType,
			Text:      text,
			Metadata:  metadata,
		}}
	}

	lines := strings.Split(text, "\n")
	var chunks []TextChunk
	var buf []rune
	chunkIdx := 0

	flushChunk := func() {
		t := strings.TrimSpace(string(buf))
		if t == "" {
			return
		}
		chunks = append(chunks, TextChunk{
			Index:     chunkIdx,
			BlockID:   fmt.Sprintf("p%d-b%d", page, chunkIdx+1),
			Page:      page,
			BlockType: blockType,
			Text:      t,
			Metadata:  metadata,
		})
		chunkIdx++
	}

	for _, line := range lines {
		lineRunes := []rune(line)
		// 单行超长：先 flush buf，然后硬切这行
		if len(lineRunes) > maxChunkRunes {
			if len(buf) > 0 {
				flushChunk()
				buf = nil
			}
			for i := 0; i < len(lineRunes); i += targetChunkRunes {
				end := i + targetChunkRunes
				if end > len(lineRunes) {
					end = len(lineRunes)
				}
				chunks = append(chunks, TextChunk{
					Index:     chunkIdx,
					BlockID:   fmt.Sprintf("p%d-b%d", page, chunkIdx+1),
					Page:      page,
					BlockType: blockType,
					Text:      string(lineRunes[i:end]),
					Metadata:  metadata,
				})
				chunkIdx++
			}
			continue
		}

		// 正常行：追加到 buf
		if len(buf) > 0 {
			buf = append(buf, '\n')
		}
		buf = append(buf, lineRunes...)
		if len(buf) >= targetChunkRunes {
			flushChunk()
			// overlap
			if len(buf) > overlapRunes {
				buf = buf[len(buf)-overlapRunes:]
			} else {
				buf = nil
			}
		}
	}
	flushChunk()
	return chunks
}

// chunkText 保留兼容性的切分函数
func chunkText(text string, chunkSize int, overlap int) []TextChunk {
	return chunkStructured(text, 1, "paragraph", "")
}
