package api

import (
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type generatedNotebookArtifactDraft struct {
	Type        string
	Title       string
	Subtitle    string
	Content     json.RawMessage
	SourceCount int
}

type notebookGeneratedAIResponse struct {
	Title    string          `json:"title"`
	Subtitle string          `json:"subtitle"`
	Content  json.RawMessage `json:"content"`
}

type notebookGenerationSource struct {
	Index    int
	File     models.File
	Summary  string
	Excerpt  string
	IsReady  bool
	Selected bool
}

type notebookStudioTextSection struct {
	Heading string   `json:"heading"`
	Body    string   `json:"body,omitempty"`
	Bullets []string `json:"bullets,omitempty"`
}

type notebookStudioTableRow struct {
	Module         string `json:"module"`
	Capability     string `json:"capability"`
	Status         string `json:"status"`
	Implementation string `json:"implementation"`
	Value          string `json:"value"`
	Source         string `json:"source"`
}

type notebookStudioMindmapNode struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Summary string `json:"summary,omitempty"`
	Source  string `json:"source,omitempty"`
}

type notebookStudioMindmapEdge struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Label string `json:"label,omitempty"`
}

func buildGeneratedNotebookArtifactDraft(generationType string, notebookTitle string, files []models.File, selectedFileIDs []uint, language string) (generatedNotebookArtifactDraft, error) {
	generationType = strings.TrimSpace(generationType)
	artifactType, ok := notebookArtifactTypeForGeneration(generationType)
	if !ok {
		return generatedNotebookArtifactDraft{}, fmt.Errorf("暂不支持这个生成类型")
	}
	sources := selectNotebookGenerationSources(files, selectedFileIDs)
	if len(sources) == 0 {
		return generatedNotebookArtifactDraft{}, fmt.Errorf("没有可用于生成的就绪资料")
	}
	if strings.TrimSpace(notebookTitle) == "" {
		notebookTitle = "未命名笔记本"
	}
	if strings.TrimSpace(language) == "" {
		language = "zh-CN"
	}

	var payload any
	switch generationType {
	case "table":
		payload = map[string]any{"rows": buildNotebookGeneratedTableRows(sources)}
	case "mindmap":
		payload = buildNotebookGeneratedMindmap(notebookTitle, sources)
	case "summary", "faq", "briefing":
		payload = map[string]any{"sections": buildNotebookGeneratedTextSections(generationType, notebookTitle, sources, language)}
	}
	content, err := json.Marshal(payload)
	if err != nil {
		return generatedNotebookArtifactDraft{}, err
	}
	return generatedNotebookArtifactDraft{
		Type:        artifactType,
		Title:       notebookGeneratedArtifactTitle(generationType, notebookTitle),
		Subtitle:    fmt.Sprintf("基于 %d 个资料源生成", len(sources)),
		Content:     content,
		SourceCount: len(sources),
	}, nil
}

func buildAINotebookArtifactDraft(ctx context.Context, aiService chatAIService, generationType string, notebookTitle string, files []models.File, selectedFileIDs []uint, language string) (generatedNotebookArtifactDraft, error) {
	fallback, err := buildGeneratedNotebookArtifactDraft(generationType, notebookTitle, files, selectedFileIDs, language)
	if err != nil {
		return generatedNotebookArtifactDraft{}, err
	}
	if aiService == nil {
		return fallback, nil
	}
	sources := selectNotebookGenerationSources(files, selectedFileIDs)
	messages := buildNotebookArtifactAIMessages(generationType, notebookTitle, sources, language)
	resp, err := aiService.ChatCompletion(ctx, notebookArtifactAIModel(), messages, false, false, "", false, nil)
	if err != nil || resp == nil || resp.Body == nil {
		return fallback, nil
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return fallback, nil
	}
	draft, err := parseAINotebookArtifactResponse(body, fallback)
	if err != nil {
		return fallback, nil
	}
	return draft, nil
}

func buildNotebookArtifactAIMessages(generationType string, notebookTitle string, sources []notebookGenerationSource, language string) []services.Message {
	if strings.TrimSpace(language) == "" {
		language = "zh-CN"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Notebook: %s\n", fallbackText(notebookTitle, "未命名笔记本"))
	fmt.Fprintf(&b, "Artifact type: %s\n", generationType)
	fmt.Fprintf(&b, "Language: %s\n\n", language)
	b.WriteString("Sources:\n")
	for _, source := range sources {
		fmt.Fprintf(&b, "[%d] %s\nSummary: %s\nExcerpt: %s\n\n", source.Index, source.File.Filename, fallbackText(source.Summary, "无摘要"), fallbackText(source.Excerpt, "无正文摘录"))
	}
	b.WriteString("Return strict JSON only with keys: title, subtitle, content. For summary/faq/briefing content must be {\"sections\":[{\"heading\":string,\"body\":string,\"bullets\":[string]}]}. For table content must be {\"rows\":[{\"module\":string,\"capability\":string,\"status\":string,\"implementation\":string,\"value\":string,\"source\":string}]}; organize factual table rows from the uploaded source summaries/excerpts, not file parsing/indexing statuses. Choose row and column content that makes comparison clear; source must cite bracket numbers such as [1]. For mindmap content must be {\"nodes\":[{\"id\":string,\"label\":string,\"summary\":string,\"source\":string}],\"edges\":[{\"from\":string,\"to\":string,\"label\":string}]}. Cite sources using bracket numbers such as [1].")
	return []services.Message{
		{Role: "system", Content: "You generate structured Notebook Studio artifacts. Return valid JSON only; no markdown fences."},
		{Role: "user", Content: b.String()},
	}
}

func parseAINotebookArtifactResponse(body []byte, fallback generatedNotebookArtifactDraft) (generatedNotebookArtifactDraft, error) {
	text := strings.TrimSpace(string(body))
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	text = strings.TrimSpace(text)
	var ai notebookGeneratedAIResponse
	if err := json.Unmarshal([]byte(text), &ai); err != nil {
		return generatedNotebookArtifactDraft{}, err
	}
	if len(ai.Content) == 0 || !json.Valid(ai.Content) {
		return generatedNotebookArtifactDraft{}, fmt.Errorf("AI artifact content is not valid JSON")
	}
	fallback.Title = fallbackText(ai.Title, fallback.Title)
	fallback.Subtitle = fallbackText(ai.Subtitle, fallback.Subtitle)
	fallback.Content = ai.Content
	return fallback, nil
}

func notebookArtifactAIModel() string {
	return "gpt-5.4-mini"
}

func notebookArtifactTypeForGeneration(generationType string) (string, bool) {
	switch generationType {
	case "table":
		return "data-table", true
	case "summary", "faq", "briefing", "mindmap":
		return generationType, true
	default:
		return "", false
	}
}

func selectNotebookGenerationSources(files []models.File, selectedFileIDs []uint) []notebookGenerationSource {
	selected := map[uint]bool{}
	for _, id := range selectedFileIDs {
		if id > 0 {
			selected[id] = true
		}
	}
	useSelection := len(selected) > 0
	sources := make([]notebookGenerationSource, 0, len(files))
	for _, file := range files {
		if useSelection && !selected[file.ID] {
			continue
		}
		if !isNotebookGenerationFileReady(file) {
			continue
		}
		summary := strings.TrimSpace(file.Summary)
		excerpt := strings.TrimSpace(file.Content)
		if excerpt == "" {
			excerpt = summary
		}
		if len(excerpt) > 1200 {
			excerpt = excerpt[:1200]
		}
		if summary == "" {
			summary = excerpt
			if len(summary) > 220 {
				summary = summary[:220]
			}
		}
		sources = append(sources, notebookGenerationSource{
			Index:    len(sources) + 1,
			File:     file,
			Summary:  summary,
			Excerpt:  excerpt,
			IsReady:  true,
			Selected: useSelection,
		})
	}
	return sources
}

func isNotebookGenerationFileReady(file models.File) bool {
	if file.ParseStatus != "done" {
		return false
	}
	if file.EmbeddingStatus != "done" && file.EmbeddingStatus != "skipped" {
		return false
	}
	return strings.TrimSpace(file.Content) != "" || strings.TrimSpace(file.Summary) != ""
}

func buildNotebookGeneratedTableRows(sources []notebookGenerationSource) []notebookStudioTableRow {
	rows := make([]notebookStudioTableRow, 0, len(sources))
	for _, source := range sources {
		factText := fallbackText(source.Summary, source.Excerpt)
		detailText := fallbackText(source.Excerpt, source.Summary)
		rows = append(rows, notebookStudioTableRow{
			Module:         notebookTableTopic(source),
			Capability:     truncateNotebookTableCell(factText, 120),
			Status:         notebookTableStatus(detailText),
			Implementation: notebookTableMethod(detailText),
			Value:          notebookTableValue(detailText),
			Source:         fmt.Sprintf("[%d]", source.Index),
		})
	}
	return rows
}

func notebookTableTopic(source notebookGenerationSource) string {
	text := strings.TrimSpace(source.Summary)
	if text == "" {
		text = strings.TrimSpace(source.Excerpt)
	}
	for _, separator := range []string{"：", ":", "。", "\n"} {
		if index := strings.Index(text, separator); index > 0 && index <= 28 {
			return truncateNotebookTableCell(text[:index], 42)
		}
	}
	filename := strings.TrimSpace(source.File.Filename)
	if filename != "" {
		return truncateNotebookTableCell(strings.TrimSuffix(filename, notebookFileExtension(filename)), 42)
	}
	return fmt.Sprintf("资料 %d", source.Index)
}

func notebookFileExtension(filename string) string {
	lastDot := strings.LastIndex(filename, ".")
	if lastDot <= 0 || lastDot == len(filename)-1 {
		return ""
	}
	return filename[lastDot:]
}

func notebookTableStatus(text string) string {
	if containsAnyNotebookText(text, []string{"风险", "缺口", "待验证", "不确定", "失败", "限制"}) {
		return "需核查"
	}
	if containsAnyNotebookText(text, []string{"成熟", "完成", "已上线", "结论", "支持", "包括", "需要"}) {
		return "已整理"
	}
	return "资料要点"
}

func notebookTableMethod(text string) string {
	sentences := splitNotebookSentences(text)
	for _, sentence := range sentences {
		if containsAnyNotebookText(sentence, []string{"通过", "采用", "支持", "包括", "整理", "输出", "上传", "引用"}) {
			return truncateNotebookTableCell(sentence, 140)
		}
	}
	return truncateNotebookTableCell(fallbackText(text, "从上传资料中提取关键事实并整理为表格"), 140)
}

func notebookTableValue(text string) string {
	sentences := splitNotebookSentences(text)
	for _, sentence := range sentences {
		if containsAnyNotebookText(sentence, []string{"价值", "优势", "减少", "提升", "用户", "场景", "结论", "差异化"}) {
			return truncateNotebookTableCell(sentence, 140)
		}
	}
	if len(sentences) > 1 {
		return truncateNotebookTableCell(sentences[len(sentences)-1], 140)
	}
	return "可用于后续问答、对比分析和 Studio 输出"
}

func splitNotebookSentences(text string) []string {
	text = strings.ReplaceAll(text, "\r", "\n")
	parts := strings.FieldsFunc(text, func(r rune) bool {
		return r == '。' || r == '！' || r == '？' || r == '\n' || r == ';' || r == '；'
	})
	sentences := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			sentences = append(sentences, part)
		}
	}
	return sentences
}

func containsAnyNotebookText(text string, needles []string) bool {
	for _, needle := range needles {
		if strings.Contains(text, needle) {
			return true
		}
	}
	return false
}

func truncateNotebookTableCell(value string, limit int) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "暂无摘要"
	}
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}

func buildNotebookGeneratedMindmap(notebookTitle string, sources []notebookGenerationSource) map[string]any {
	nodes := []notebookStudioMindmapNode{{ID: "root", Label: notebookTitle, Summary: fmt.Sprintf("基于 %d 个资料源生成的知识结构", len(sources))}}
	edges := make([]notebookStudioMindmapEdge, 0, len(sources)*2)
	for _, source := range sources {
		sourceID := fmt.Sprintf("source-%d", source.Index)
		summary := fallbackText(source.Summary, source.Excerpt)
		nodes = append(nodes, notebookStudioMindmapNode{ID: sourceID, Label: source.File.Filename, Summary: summary, Source: fmt.Sprintf("[%d]", source.Index)})
		edges = append(edges, notebookStudioMindmapEdge{From: "root", To: sourceID, Label: "资料源"})
		if strings.TrimSpace(summary) != "" {
			ideaID := fmt.Sprintf("idea-%d", source.Index)
			nodes = append(nodes, notebookStudioMindmapNode{ID: ideaID, Label: truncateNotebookMindmapLabel(summary), Summary: source.Excerpt, Source: fmt.Sprintf("[%d]", source.Index)})
			edges = append(edges, notebookStudioMindmapEdge{From: sourceID, To: ideaID, Label: "关键要点"})
		}
	}
	return map[string]any{"nodes": nodes, "edges": edges}
}

func truncateNotebookMindmapLabel(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 36 {
		return value
	}
	return value[:36] + "…"
}

func buildNotebookGeneratedTextSections(generationType string, notebookTitle string, sources []notebookGenerationSource, language string) []notebookStudioTextSection {
	bullets := make([]string, 0, len(sources))
	for _, source := range sources {
		bullets = append(bullets, fmt.Sprintf("[%d] %s：%s", source.Index, source.File.Filename, fallbackText(source.Summary, source.Excerpt)))
	}
	switch generationType {
	case "faq":
		return []notebookStudioTextSection{
			{Heading: "这个笔记本覆盖哪些资料？", Body: fmt.Sprintf("当前 FAQ 基于《%s》中的 %d 个就绪资料源生成。", notebookTitle, len(sources))},
			{Heading: "可以从哪些资料继续追问？", Bullets: bullets},
			{Heading: "建议追问", Bullets: []string{"请对比不同资料中的共同结论", "请列出目前资料中的风险和缺口", "请把资料整理成执行清单"}},
		}
	case "briefing":
		return []notebookStudioTextSection{
			{Heading: "态势概览", Body: fmt.Sprintf("《%s》目前有 %d 个就绪资料源，可用于形成简报。", notebookTitle, len(sources))},
			{Heading: "关键信号", Bullets: bullets},
			{Heading: "建议动作", Bullets: []string{"核对关键来源原文", "围绕高价值主题继续追问", "导出简报并补充业务判断"}},
		}
	default:
		return []notebookStudioTextSection{
			{Heading: "整体摘要", Body: fmt.Sprintf("《%s》当前选中的 %d 个就绪资料源已整理为摘要草稿。", notebookTitle, len(sources))},
			{Heading: "资料要点", Bullets: bullets},
			{Heading: "下一步", Bullets: []string{"继续向 Notebook Chat 追问细节", "生成数据表格做结构化对比", "补充更多资料后重新生成"}},
		}
	}
}

func notebookGeneratedArtifactTitle(generationType string, notebookTitle string) string {
	switch generationType {
	case "table":
		return fmt.Sprintf("%s · 数据表格", notebookTitle)
	case "faq":
		return fmt.Sprintf("%s · FAQ", notebookTitle)
	case "briefing":
		return fmt.Sprintf("%s · 简报", notebookTitle)
	case "mindmap":
		return fmt.Sprintf("%s · 思维导图", notebookTitle)
	default:
		return fmt.Sprintf("%s · 摘要", notebookTitle)
	}
}

func fallbackText(primary string, fallback string) string {
	primary = strings.TrimSpace(primary)
	if primary != "" {
		return primary
	}
	fallback = strings.TrimSpace(fallback)
	if fallback != "" {
		return fallback
	}
	return "暂无摘要"
}
