package services

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const defaultVisionDocTimeoutSeconds = 180
const defaultVisionDocMaxFileMB = 20

// parseComplexDocumentWithVision 将 PDF/DOCX/PPTX 渲染成页面图片后交给 Vision 做文档理解。
// 它只负责视觉增强；调用方必须保留本地解析作为失败回退。
func (p *FileParser) parseComplexDocumentWithVision(ctx context.Context, data []byte, filename string) (*ParseResult, error) {
	if p.aiService == nil {
		return nil, fmt.Errorf("文档视觉解析失败: AI 服务未初始化")
	}
	if p.cfg == nil || !p.cfg.VisionDocEnable {
		return nil, fmt.Errorf("文档视觉解析未启用")
	}

	maxMB := p.cfg.VisionDocMaxFileMB
	if maxMB <= 0 {
		maxMB = defaultVisionDocMaxFileMB
	}
	if len(data) > maxMB*1024*1024 {
		return nil, fmt.Errorf("文档超过视觉解析大小限制: %dMB", maxMB)
	}

	timeoutSeconds := p.cfg.VisionDocTimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = defaultVisionDocTimeoutSeconds
	}
	parseCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSeconds)*time.Second)
	defer cancel()

	tmpDir, err := os.MkdirTemp("", "aipool-doc-vision-*")
	if err != nil {
		return nil, fmt.Errorf("创建文档视觉解析临时目录失败: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	ext := strings.ToLower(filepath.Ext(filename))
	inputPath := filepath.Join(tmpDir, "input"+ext)
	if err := os.WriteFile(inputPath, data, 0600); err != nil {
		return nil, fmt.Errorf("写入文档视觉解析临时文件失败: %w", err)
	}

	pdfPath := inputPath
	if ext == ".docx" || ext == ".pptx" {
		converted, err := convertOfficeDocumentToPDF(parseCtx, inputPath, tmpDir)
		if err != nil {
			return nil, err
		}
		pdfPath = converted
	}

	pageImages, err := renderPDFToPNGs(parseCtx, pdfPath, tmpDir)
	if err != nil {
		return nil, err
	}
	if len(pageImages) == 0 {
		return nil, fmt.Errorf("文档视觉解析失败: 未生成页面图片")
	}

	var content strings.Builder
	var chunks []TextChunk
	var mergedUsage *VisionUsage
	hasTables := false

	for i, imagePath := range pageImages {
		select {
		case <-parseCtx.Done():
			return nil, fmt.Errorf("文档视觉解析超时: %w", parseCtx.Err())
		default:
		}

		imageData, err := os.ReadFile(imagePath)
		if err != nil {
			return nil, fmt.Errorf("读取页面图片失败: %w", err)
		}
		pageText, usage, err := p.aiService.ExtractImageContent(parseCtx, imageData, "image/png")
		if err != nil {
			return nil, fmt.Errorf("第 %d 页视觉解析失败: %w", i+1, err)
		}
		pageText = strings.TrimSpace(pageText)
		if pageText == "" {
			continue
		}

		if strings.Contains(pageText, "|") || strings.Contains(pageText, "表格") || strings.Contains(strings.ToLower(pageText), "table") {
			hasTables = true
		}

		pageMarkdown := fmt.Sprintf("## 第 %d 页\n\n%s", i+1, pageText)
		if content.Len() > 0 {
			content.WriteString("\n\n")
		}
		content.WriteString(pageMarkdown)

		pageChunks := chunkStructured(pageMarkdown, i+1, "vision_page", fmt.Sprintf(`{"source":"vision_doc","filename":"%s","page":%d}`, jsonEscape(filename), i+1))
		for j := range pageChunks {
			pageChunks[j].Index = len(chunks)
			pageChunks[j].Page = i + 1
			pageChunks[j].BlockID = fmt.Sprintf("vision-p%d-b%d", i+1, j+1)
			pageChunks[j].BlockType = "vision_page"
		}
		chunks = append(chunks, pageChunks...)
		mergedUsage = mergeVisionUsage(mergedUsage, usage)
	}

	resultContent := strings.TrimSpace(content.String())
	if resultContent == "" {
		return nil, fmt.Errorf("文档视觉解析失败: 返回内容为空")
	}

	return &ParseResult{
		Content:     resultContent,
		Summary:     firstRunes(resultContent, 200),
		Pages:       len(pageImages),
		Chunks:      chunks,
		HasImages:   true,
		HasTables:   hasTables,
		VisionUsage: mergedUsage,
	}, nil
}

func convertOfficeDocumentToPDF(ctx context.Context, inputPath, outDir string) (string, error) {
	bin, err := findExecutable("libreoffice", "soffice")
	if err != nil {
		return "", fmt.Errorf("文档视觉解析需要 LibreOffice: %w", err)
	}

	cmd := exec.CommandContext(ctx, bin, "--headless", "--convert-to", "pdf", "--outdir", outDir, inputPath)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg != "" {
			return "", fmt.Errorf("Office 转 PDF 失败: %w: %s", err, msg)
		}
		return "", fmt.Errorf("Office 转 PDF 失败: %w", err)
	}

	pdfPath := filepath.Join(outDir, strings.TrimSuffix(filepath.Base(inputPath), filepath.Ext(inputPath))+".pdf")
	if _, err := os.Stat(pdfPath); err != nil {
		return "", fmt.Errorf("Office 转 PDF 失败: 未找到输出文件")
	}
	return pdfPath, nil
}

func renderPDFToPNGs(ctx context.Context, pdfPath, outDir string) ([]string, error) {
	bin, err := findExecutable("pdftoppm")
	if err != nil {
		return nil, fmt.Errorf("文档视觉解析需要 poppler-utils/pdftoppm: %w", err)
	}

	prefix := filepath.Join(outDir, "page")
	cmd := exec.CommandContext(ctx, bin, "-png", "-r", "144", pdfPath, prefix)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg != "" {
			return nil, fmt.Errorf("PDF 转页面图片失败: %w: %s", err, msg)
		}
		return nil, fmt.Errorf("PDF 转页面图片失败: %w", err)
	}

	matches, err := filepath.Glob(prefix + "-*.png")
	if err != nil {
		return nil, fmt.Errorf("查找页面图片失败: %w", err)
	}
	sortPDFPageImages(matches)
	return matches, nil
}

func sortPDFPageImages(paths []string) {
	getPageNum := func(path string) int {
		base := filepath.Base(path)
		base = strings.TrimSuffix(base, filepath.Ext(base))
		idx := strings.LastIndex(base, "-")
		if idx < 0 || idx == len(base)-1 {
			return 0
		}
		n, _ := strconv.Atoi(base[idx+1:])
		return n
	}
	for i := 1; i < len(paths); i++ {
		for j := i; j > 0; j-- {
			left, right := getPageNum(paths[j-1]), getPageNum(paths[j])
			if left < right || (left == right && paths[j-1] <= paths[j]) {
				break
			}
			paths[j-1], paths[j] = paths[j], paths[j-1]
		}
	}
}

func findExecutable(names ...string) (string, error) {
	for _, name := range names {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("未找到可执行文件: %s", strings.Join(names, ", "))
}

func mergeVisionUsage(a, b *VisionUsage) *VisionUsage {
	if b == nil {
		return a
	}
	if a == nil {
		return &VisionUsage{
			PromptTokens:     b.PromptTokens,
			CompletionTokens: b.CompletionTokens,
			TotalTokens:      b.TotalTokens,
			CostRMB:          b.CostRMB,
		}
	}
	a.PromptTokens += b.PromptTokens
	a.CompletionTokens += b.CompletionTokens
	a.TotalTokens += b.TotalTokens
	a.CostRMB += b.CostRMB
	return a
}

func jsonEscape(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return s
}
