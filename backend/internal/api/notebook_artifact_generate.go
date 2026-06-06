package api

import (
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode"
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
	sources := selectNotebookGenerationSources(files, selectedFileIDs, generationType)
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
	sources := selectNotebookGenerationSources(files, selectedFileIDs, generationType)
	messages := buildNotebookArtifactAIMessages(generationType, notebookTitle, sources, language)
	resp, err := aiService.ChatCompletion(ctx, notebookArtifactAIModel(generationType), messages, false, false, "", false, nil)
	if err != nil || resp == nil || resp.Body == nil {
		if generationType == "mindmap" {
			return generatedNotebookArtifactDraft{}, fmt.Errorf("思维导图需要完整模型分析，当前模型服务不可用，请稍后重试")
		}
		return fallback, nil
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		if generationType == "mindmap" {
			return generatedNotebookArtifactDraft{}, fmt.Errorf("思维导图模型响应读取失败，请稍后重试")
		}
		return fallback, nil
	}
	draft, err := parseAINotebookArtifactResponse(body, fallback)
	if err != nil {
		if generationType == "mindmap" {
			return generatedNotebookArtifactDraft{}, fmt.Errorf("思维导图模型返回格式无效，请重新生成")
		}
		return fallback, nil
	}
	if generationType == "table" && !notebookTableDraftLooksUseful(draft.Content) {
		return fallback, nil
	}
	if generationType == "mindmap" && !notebookMindmapDraftLooksUseful(draft.Content) {
		return generatedNotebookArtifactDraft{}, fmt.Errorf("思维导图分析结果不完整，请重新生成")
	}
	return draft, nil
}

func buildNotebookArtifactAIMessages(generationType string, notebookTitle string, sources []notebookGenerationSource, language string) []services.Message {
	if strings.TrimSpace(language) == "" {
		language = "zh-CN"
	}
	if generationType == "mindmap" {
		return buildNotebookMindmapAIMessages(notebookTitle, sources, language)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Notebook: %s\n", fallbackText(notebookTitle, "未命名笔记本"))
	fmt.Fprintf(&b, "Artifact type: %s\n", generationType)
	fmt.Fprintf(&b, "Language: %s\n\n", language)
	b.WriteString("Sources:\n")
	for _, source := range sources {
		fmt.Fprintf(&b, "[%d] %s\nSummary: %s\nExcerpt: %s\n\n", source.Index, source.File.Filename, fallbackText(source.Summary, "无摘要"), fallbackText(source.Excerpt, "无正文摘录"))
	}
	if generationType == "table" {
		b.WriteString("Return strict JSON only with keys: title, subtitle, content. For table content must be {\"rows\":[{\"module\":string,\"capability\":string,\"status\":string,\"implementation\":string,\"value\":string,\"source\":string}]}. You MUST read the uploaded source text and extract a functional/specification table: each row is one product feature, capability, module, workflow, scenario, or business item described in the documents. Use columns as: module=模块名称, capability=核心功能, status=当前状态/成熟度, implementation=差异化竞争优势, value=对标产品/参照对象/适用场景, source=bracket citations like [1]. Do NOT create a file list, parse/index status checklist, or one row per file. If one document describes multiple functions, output multiple rows from that same document. Prefer 6-12 high-signal rows when enough content exists. Keep all cells grounded in the source text.\n")
	} else if generationType == "mindmap" {
		b.WriteString("Return strict JSON only with keys: title, subtitle, content. For mindmap content must be {\"nodes\":[{\"id\":string,\"label\":string,\"summary\":string,\"source\":string}],\"edges\":[{\"from\":string,\"to\":string,\"label\":string}]}. You MUST first read the whole provided source text for each file (it may be a long PDF extract), reconstruct the document outline, then draw a NotebookLM-style product/knowledge mind map, not a sentence list. Required structure: exactly one root node with id=root; 5-8 first-level branches that are clear sections/modules; each important branch has 2-5 second-level child nodes; add third-level nodes only when the source has concrete details. Good first-level branch examples for product documents: 产品定位, 已落地功能, 核心优势, 技术架构, 业务场景, 规划路线, 竞争壁垒, 风险与缺口. Node labels must be clean Chinese phrases of 2-18 characters when possible; never use broken OCR fragments, truncated words, ellipses, file names, raw sentences, parse/index status, or meaningless snippets. Summaries may contain one concise sentence. Use stable ids like root, branch-1, branch-1-1. Cite sources using bracket numbers such as [1]. If the source contains an existing feature table or product architecture, preserve that sectional structure.\n")
	} else {
		b.WriteString("Return strict JSON only with keys: title, subtitle, content. For summary/faq/briefing content must be {\"sections\":[{\"heading\":string,\"body\":string,\"bullets\":[string]}]}. For mindmap content must be {\"nodes\":[{\"id\":string,\"label\":string,\"summary\":string,\"source\":string}],\"edges\":[{\"from\":string,\"to\":string,\"label\":string}]}. Cite sources using bracket numbers such as [1].")
	}
	return []services.Message{
		{Role: "system", Content: "You generate structured Notebook Studio artifacts. Return valid JSON only; no markdown fences."},
		{Role: "user", Content: b.String()},
	}
}

func buildNotebookMindmapAIMessages(notebookTitle string, sources []notebookGenerationSource, language string) []services.Message {
	var b strings.Builder
	fmt.Fprintf(&b, "Notebook: %s\n", fallbackText(notebookTitle, "未命名笔记本"))
	fmt.Fprintf(&b, "Artifact type: mindmap\nLanguage: %s\n\n", language)
	b.WriteString("Task:\n")
	b.WriteString("Read the COMPLETE provided PDF text below, infer the real document outline, and build a NotebookLM-style mind map. The output must look like a high-quality product/knowledge map, not an outline fragment, not numbered raw headings, and not a few quoted sentences.\n\n")
	b.WriteString("Quality target:\n")
	b.WriteString("- Root label should be the document/product theme, not the notebook test name when the source has a better title.\n")
	b.WriteString("- Create 5-7 first-level sections covering the whole document. For an AI/product whitepaper, prefer sections like 产品简介与定位, 核心优势, 技术架构特色, Workspace进化路径, 规划中稀缺能力, 已落地功能, 商业/部署能力 when supported by the source.\n")
	b.WriteString("- Under each important section create 2-5 concrete child nodes; create third-level nodes for feature lists, architecture details, roadmap stages, or plugin capabilities.\n")
	b.WriteString("- Use semantic labels, not source heading numbers: remove prefixes like '1 ', '2 ', '3 ', '一、', '1.1'.\n")
	b.WriteString("- Preserve concrete details from the full PDF, such as model names, tech stack, memory/code-size numbers, integrations, roadmap stages, and planned capabilities.\n")
	b.WriteString("- Do not output broken OCR fragments, unfinished sentences, file names, parse/index status, ellipses, or generic filler.\n\n")
	b.WriteString("Return strict JSON only with keys: title, subtitle, content. content must be {\"nodes\":[{\"id\":string,\"label\":string,\"summary\":string,\"source\":string}],\"edges\":[{\"from\":string,\"to\":string,\"label\":string}]}. Use exactly one root node id=root. Use stable ids like root, branch-1, branch-1-1, branch-1-1-1. Cite sources using bracket numbers such as [1].\n\n")
	b.WriteString("Sources with full available text:\n")
	for _, source := range sources {
		fmt.Fprintf(&b, "\n--- SOURCE [%d]: %s ---\nSummary: %s\nFullText:\n%s\n--- END SOURCE [%d] ---\n", source.Index, source.File.Filename, fallbackText(source.Summary, "无摘要"), fallbackText(source.Excerpt, "无正文"), source.Index)
	}
	return []services.Message{
		{Role: "system", Content: "You are an expert analyst creating dense NotebookLM-style mind maps from complete PDF text. Return valid JSON only; no markdown fences."},
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

func notebookArtifactAIModel(generationType string) string {
	if generationType == "table" || generationType == "mindmap" {
		return "gpt-5.5"
	}
	return "gpt-5.4-mini"
}

func notebookTableDraftLooksUseful(content json.RawMessage) bool {
	var payload struct {
		Rows []notebookStudioTableRow `json:"rows"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		return false
	}
	if len(payload.Rows) == 0 {
		return false
	}
	statusChecklistSignals := []string{"解析状态", "索引状态", "parse_status", "embedding_status", "已就绪", "处理完成后可参与", "文件状态", "资料源", "mime_type"}
	contentSignals := []string{"功能", "能力", "模块", "场景", "优势", "对标", "聊天", "问答", "生成", "检索", "导出", "部署", "产品", "用户"}
	contentRows := 0
	for _, row := range payload.Rows {
		combined := strings.Join([]string{row.Module, row.Capability, row.Status, row.Implementation, row.Value}, " ")
		if containsAnyNotebookText(combined, statusChecklistSignals) {
			return false
		}
		if containsAnyNotebookText(combined, contentSignals) {
			contentRows++
		}
	}
	return contentRows >= len(payload.Rows)/2+1
}

func notebookMindmapDraftLooksUseful(content json.RawMessage) bool {
	var payload struct {
		Nodes []notebookStudioMindmapNode `json:"nodes"`
		Edges []notebookStudioMindmapEdge `json:"edges"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		return false
	}
	if len(payload.Nodes) < 14 || len(payload.Edges) < 13 {
		return false
	}
	childrenByParent := map[string]int{}
	validNodeIDs := map[string]bool{}
	rootLabel := ""
	cleanLabels := 0
	for _, node := range payload.Nodes {
		id := strings.TrimSpace(node.ID)
		label := strings.TrimSpace(node.Label)
		if id == "root" {
			rootLabel = label
		}
		validNodeIDs[id] = true
		if id != "" && looksLikeCleanNotebookMindmapLabel(label) {
			cleanLabels++
		}
	}
	for _, edge := range payload.Edges {
		if validNodeIDs[edge.From] && validNodeIDs[edge.To] {
			childrenByParent[edge.From]++
		}
	}
	nestedBranches := 0
	for parent, count := range childrenByParent {
		if parent != "root" && count > 0 {
			nestedBranches++
		}
	}
	if !looksLikeCleanNotebookMindmapRootLabel(rootLabel) {
		return false
	}
	return childrenByParent["root"] >= 5 && nestedBranches >= 3 && cleanLabels >= len(payload.Nodes)*3/4
}

func looksLikeCleanNotebookMindmapRootLabel(label string) bool {
	label = strings.TrimSpace(label)
	if !looksLikeCleanNotebookMindmapLabel(label) {
		return false
	}
	badRootSignals := []string{"测试", "未命名", "知识库", "笔记本"}
	return !containsAnyNotebookText(label, badRootSignals)
}

func looksLikeCleanNotebookMindmapLabel(label string) bool {
	label = strings.TrimSpace(label)
	if label == "" {
		return false
	}
	runes := []rune(label)
	if len(runes) > 32 {
		return false
	}
	badSignals := []string{"�", "...", "…", "parse_status", "embedding_status", ".pdf", ".doc", "文件状态", "资料源", "暂无摘要"}
	if containsAnyNotebookText(label, badSignals) {
		return false
	}
	if hasNotebookMindmapHeadingNumberPrefix(label) {
		return false
	}
	letters := 0
	for _, r := range runes {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			letters++
		}
	}
	return letters >= 2
}

func hasNotebookMindmapHeadingNumberPrefix(label string) bool {
	label = strings.TrimSpace(label)
	if label == "" {
		return false
	}
	runes := []rune(label)
	if len(runes) >= 2 && unicode.IsDigit(runes[0]) && unicode.IsSpace(runes[1]) {
		return true
	}
	if len(runes) >= 3 && unicode.IsDigit(runes[0]) && (runes[1] == '.' || runes[1] == '、') && unicode.IsSpace(runes[2]) {
		return true
	}
	chinesePrefixes := []string{"一、", "二、", "三、", "四、", "五、", "六、", "七、", "八、", "九、", "十、"}
	return containsAnyNotebookPrefix(label, chinesePrefixes)
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

func selectNotebookGenerationSources(files []models.File, selectedFileIDs []uint, generationType string) []notebookGenerationSource {
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
		excerpt = truncateNotebookRunes(excerpt, notebookGenerationExcerptLimit(generationType), "")
		if summary == "" {
			summary = excerpt
			summary = truncateNotebookRunes(summary, 220, "")
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

func notebookGenerationExcerptLimit(generationType string) int {
	switch generationType {
	case "mindmap":
		return 60000
	case "table":
		return 16000
	default:
		return 10000
	}
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
	rows := make([]notebookStudioTableRow, 0, len(sources)*3)
	for _, source := range sources {
		rows = append(rows, extractNotebookTableRowsFromSource(source)...)
	}
	return rows
}

func extractNotebookTableRowsFromSource(source notebookGenerationSource) []notebookStudioTableRow {
	text := fallbackText(source.Excerpt, source.Summary)
	if rows := extractNotebookExistingTableRows(source, text); len(rows) > 0 {
		return rows
	}
	blocks := splitNotebookFeatureBlocks(text)
	rows := make([]notebookStudioTableRow, 0, len(blocks))
	for _, block := range blocks {
		row := notebookTableRowFromBlock(source, block.title, block.body)
		if strings.TrimSpace(row.Module) != "" && strings.TrimSpace(row.Capability) != "" {
			rows = append(rows, row)
		}
	}
	if len(rows) > 0 {
		return rows
	}
	return []notebookStudioTableRow{notebookTableRowFromBlock(source, notebookTableTopic(source), text)}
}

func extractNotebookExistingTableRows(source notebookGenerationSource, text string) []notebookStudioTableRow {
	if !strings.Contains(text, "模块") || !strings.Contains(text, "能力") {
		return nil
	}
	lines := strings.Split(strings.ReplaceAll(text, "\r", "\n"), "\n")
	rows := make([]notebookStudioTableRow, 0)
	var current *notebookStudioTableRow
	for _, raw := range lines {
		line := normalizeNotebookTableLine(raw)
		if line == "" {
			continue
		}
		if strings.Contains(line, "模块") && strings.Contains(line, "能力") {
			continue
		}
		module, rest, ok := splitNotebookTableFeatureLine(line)
		if ok {
			if current != nil {
				rows = append(rows, *current)
			}
			status := extractNotebookStatusToken(rest)
			capability := removeNotebookStatusTokens(rest)
			current = &notebookStudioTableRow{
				Module:         truncateNotebookTableCell(cleanNotebookModuleName(module), 42),
				Capability:     truncateNotebookTableCell(capability, 180),
				Status:         fallbackText(status, "资料要点"),
				Implementation: notebookTableAdvantageForModule(module, text),
				Value:          notebookTableBenchmarkForModule(module),
				Source:         fmt.Sprintf("[%d]", source.Index),
			}
			continue
		}
		if current != nil && looksLikeNotebookSectionHeading(line) {
			rows = append(rows, *current)
			current = nil
			if len(rows) >= 3 {
				break
			}
			continue
		}
		if current != nil {
			status := extractNotebookStatusToken(line)
			if status != "" && current.Status == "资料要点" {
				current.Status = status
				line = removeNotebookStatusTokens(line)
			}
			if line != "" && len([]rune(current.Capability)) < 170 {
				current.Capability = truncateNotebookTableCell(strings.TrimSpace(current.Capability+" "+line), 180)
			}
		}
	}
	if current != nil {
		rows = append(rows, *current)
	}
	if len(rows) < 3 {
		return nil
	}
	return rows
}

func normalizeNotebookTableLine(line string) string {
	line = regexp.MustCompile(`\s+`).ReplaceAllString(strings.TrimSpace(line), " ")
	line = strings.Trim(line, "│| ")
	return strings.TrimSpace(line)
}

func splitNotebookTableFeatureLine(line string) (string, string, bool) {
	clean := strings.TrimSpace(regexp.MustCompile(`^[\p{So}\p{Sk}\p{S}\p{P}]+\s*`).ReplaceAllString(line, ""))
	if clean == "" {
		return "", "", false
	}
	candidates := []string{"多模型聊天", "并列对比", "图片生成", "图片编辑", "技能系统", "PPT 生成", "PPT生成", "文件解析", "对话分享", "积分体系", "回答模板", "认证系统", "主题切换", "品牌标识", "品牌色系", "主题体系", "页面路由", "着陆页", "视频生成", "Notebook", "Studio 数据表格"}
	for _, candidate := range candidates {
		if strings.HasPrefix(clean, candidate) {
			return candidate, strings.TrimSpace(strings.TrimPrefix(clean, candidate)), true
		}
	}
	parts := strings.Fields(clean)
	if len(parts) < 2 {
		return "", "", false
	}
	module := parts[0]
	if len(parts) >= 3 && len([]rune(parts[0])) <= 4 && looksLikeNotebookFeatureTitle(parts[0]+parts[1]) {
		module = parts[0] + parts[1]
		return module, strings.Join(parts[2:], " "), true
	}
	if looksLikeNotebookFeatureTitle(module) {
		return module, strings.Join(parts[1:], " "), true
	}
	return "", "", false
}

func extractNotebookStatusToken(text string) string {
	for _, status := range []string{"✅ 成熟", "成熟", "建设中", "规划中", "需核查", "可用", "已上线"} {
		if strings.Contains(text, status) {
			return strings.TrimSpace(strings.TrimPrefix(status, "✅"))
		}
	}
	return ""
}

func removeNotebookStatusTokens(text string) string {
	for _, token := range []string{"✅ 成熟", "✅", "成熟", "建设中", "规划中", "需核查", "可用", "已上线"} {
		text = strings.ReplaceAll(text, token, "")
	}
	return strings.TrimSpace(text)
}

func cleanNotebookModuleName(module string) string {
	module = regexp.MustCompile(`^[\p{So}\p{Sk}\p{S}\p{P}\s]+`).ReplaceAllString(module, "")
	return strings.TrimSpace(strings.Trim(module, "✅️\ufe0f "))
}

func looksLikeNotebookSectionHeading(line string) bool {
	return regexp.MustCompile(`^\d+(?:\.\d+)?\s+`).MatchString(line) || strings.HasPrefix(line, "AI Space")
}

func notebookTableAdvantageForModule(module string, text string) string {
	if strings.Contains(module, "多模型") {
		return "统一接入多家主流模型，支持按任务切换和管理不同模型能力"
	}
	if strings.Contains(module, "并列对比") {
		return "同一问题可同时比较两个模型输出，便于选型和质量判断"
	}
	if strings.Contains(module, "图片") {
		return "把生成、编辑、质量控制集中在同一产品工作流中"
	}
	if strings.Contains(module, "文件解析") || strings.Contains(module, "Notebook") {
		return "将资料解析、分块、Embedding 和向量检索整合为可引用 RAG 流水线"
	}
	if strings.Contains(module, "白标") || strings.Contains(module, "品牌") || strings.Contains(module, "主题") {
		return "通过组件、CSS 变量和路由配置支持低成本品牌化定制"
	}
	if containsAnyNotebookText(text, []string{"差异化", "优势", "定制"}) {
		return "从资料中的产品优势和能力描述整理，可结合来源继续核查"
	}
	return "从资料正文抽取的功能能力，可用于后续对比和复核"
}

func notebookTableBenchmarkForModule(module string) string {
	if strings.Contains(module, "多模型") || strings.Contains(module, "并列") {
		return "ChatGPT、Poe、OpenRouter"
	}
	if strings.Contains(module, "图片") {
		return "ChatGPT Images、Midjourney、Adobe Firefly"
	}
	if strings.Contains(module, "文件解析") || strings.Contains(module, "Notebook") {
		return "NotebookLM、Claude Projects"
	}
	if strings.Contains(module, "PPT") {
		return "Gamma、Tome、Canva"
	}
	if strings.Contains(module, "品牌") || strings.Contains(module, "白标") {
		return "企业白标 AI 平台、定制化 SaaS"
	}
	return "按资料场景复核"
}

type notebookFeatureBlock struct {
	title string
	body  string
}

func splitNotebookFeatureBlocks(text string) []notebookFeatureBlock {
	text = strings.ReplaceAll(strings.TrimSpace(text), "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	if text == "" {
		return nil
	}

	headingRe := regexp.MustCompile(`(?m)^\s*(?:#{1,4}\s*|(?:\d+|[一二三四五六七八九十]+)[、.)．]\s*|[-*]\s*)?([^\n：:]{2,40})\s*$`)
	matches := headingRe.FindAllStringSubmatchIndex(text, -1)
	blocks := make([]notebookFeatureBlock, 0)
	for i, match := range matches {
		title := strings.TrimSpace(text[match[2]:match[3]])
		if !looksLikeNotebookFeatureTitle(title) {
			continue
		}
		bodyStart := match[1]
		bodyEnd := len(text)
		if i+1 < len(matches) {
			bodyEnd = matches[i+1][0]
		}
		body := strings.TrimSpace(text[bodyStart:bodyEnd])
		if body != "" {
			blocks = append(blocks, notebookFeatureBlock{title: title, body: body})
		}
	}
	if len(blocks) > 0 {
		return blocks
	}

	sentences := splitNotebookSentences(text)
	for _, sentence := range sentences {
		if !looksLikeNotebookFeatureSentence(sentence) {
			continue
		}
		blocks = append(blocks, notebookFeatureBlock{title: inferNotebookFeatureTitle(sentence), body: sentence})
	}
	return blocks
}

func looksLikeNotebookFeatureTitle(title string) bool {
	title = strings.TrimSpace(title)
	if len([]rune(title)) < 2 || len([]rune(title)) > 34 {
		return false
	}
	return containsAnyNotebookText(title, []string{"功能", "模块", "聊天", "问答", "表格", "Studio", "Notebook", "图片", "视频", "解析", "检索", "生成", "部署", "积分", "白标", "工作流", "搜索", "导出", "多模型"})
}

func looksLikeNotebookFeatureSentence(sentence string) bool {
	return containsAnyNotebookText(sentence, []string{"核心能力", "核心功能", "功能包括", "支持", "模块", "用户场景", "能力包括", "可用于", "输出", "导出"})
}

func inferNotebookFeatureTitle(sentence string) string {
	sentence = strings.TrimSpace(sentence)
	for _, separator := range []string{"：", ":", "包括", "支持", "是"} {
		if index := strings.Index(sentence, separator); index > 1 && index <= 30 {
			return truncateNotebookTableCell(sentence[:index], 42)
		}
	}
	return truncateNotebookTableCell(sentence, 42)
}

func notebookTableRowFromBlock(source notebookGenerationSource, title string, body string) notebookStudioTableRow {
	return notebookStudioTableRow{
		Module:         truncateNotebookTableCell(fallbackText(title, notebookTableTopic(source)), 42),
		Capability:     truncateNotebookTableCell(extractNotebookLabeledValue(body, []string{"核心功能", "核心能力", "具体能力", "功能"}, firstNotebookUsefulSentence(body)), 180),
		Status:         truncateNotebookTableCell(extractNotebookLabeledValue(body, []string{"当前状态", "状态", "成熟度"}, notebookTableStatus(body)), 60),
		Implementation: truncateNotebookTableCell(extractNotebookLabeledValue(body, []string{"差异化竞争优势", "差异化优势", "竞争优势", "优势", "价值"}, notebookTableMethod(body)), 180),
		Value:          truncateNotebookTableCell(extractNotebookLabeledValue(body, []string{"对标产品", "参照对象", "对标", "适用场景", "场景"}, notebookTableValue(body)), 160),
		Source:         fmt.Sprintf("[%d]", source.Index),
	}
}

func extractNotebookLabeledValue(text string, labels []string, fallback string) string {
	for _, label := range labels {
		pattern := regexp.MustCompile(regexp.QuoteMeta(label) + `\s*[：:]\s*([^。\n；;]+)`)
		if match := pattern.FindStringSubmatch(text); len(match) > 1 {
			return strings.TrimSpace(match[1])
		}
	}
	return fallback
}

func firstNotebookUsefulSentence(text string) string {
	for _, sentence := range splitNotebookSentences(text) {
		if strings.TrimSpace(sentence) != "" {
			return sentence
		}
	}
	return text
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

func containsAnyNotebookPrefix(text string, prefixes []string) bool {
	for _, prefix := range prefixes {
		if strings.HasPrefix(text, prefix) {
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
	nodes := []notebookStudioMindmapNode{{ID: "root", Label: truncateNotebookMindmapLabel(notebookTitle), Summary: fmt.Sprintf("基于 %d 个资料源生成的主题结构", len(sources))}}
	edges := make([]notebookStudioMindmapEdge, 0, len(sources)*4)
	seenTopics := map[string]bool{}
	for _, source := range sources {
		blocks := splitNotebookFeatureBlocks(fallbackText(source.Excerpt, source.Summary))
		if len(blocks) == 0 {
			blocks = []notebookFeatureBlock{{title: notebookTableTopic(source), body: fallbackText(source.Summary, source.Excerpt)}}
		}
		branchCount := 0
		for _, block := range blocks {
			if branchCount >= 6 {
				break
			}
			topic := cleanNotebookMindmapLabel(fallbackText(block.title, notebookTableTopic(source)))
			if topic == "" || seenTopics[topic] {
				continue
			}
			seenTopics[topic] = true
			branchCount++
			topicID := fmt.Sprintf("topic-%d-%d", source.Index, branchCount)
			nodes = append(nodes, notebookStudioMindmapNode{ID: topicID, Label: topic, Summary: truncateNotebookMindmapSummary(fallbackText(block.body, source.Summary)), Source: fmt.Sprintf("[%d]", source.Index)})
			edges = append(edges, notebookStudioMindmapEdge{From: "root", To: topicID, Label: "主题"})
			childCount := 0
			for _, sentence := range splitNotebookSentences(block.body) {
				if childCount >= 3 {
					break
				}
				if len([]rune(sentence)) < 8 {
					continue
				}
				childCount++
				childID := fmt.Sprintf("%s-%d", topicID, childCount)
				childLabel := cleanNotebookMindmapLabel(inferNotebookFeatureTitle(sentence))
				if childLabel == "" {
					continue
				}
				nodes = append(nodes, notebookStudioMindmapNode{ID: childID, Label: childLabel, Summary: truncateNotebookMindmapSummary(sentence), Source: fmt.Sprintf("[%d]", source.Index)})
				edges = append(edges, notebookStudioMindmapEdge{From: topicID, To: childID, Label: "要点"})
			}
		}
	}
	return map[string]any{"nodes": nodes, "edges": edges}
}

func truncateNotebookRunes(value string, limit int, suffix string) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if limit <= 0 || len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + suffix
}

func truncateNotebookMindmapLabel(value string) string {
	return truncateNotebookRunes(value, 36, "")
}

func cleanNotebookMindmapLabel(value string) string {
	value = truncateNotebookMindmapLabel(value)
	value = strings.Trim(value, " 	\r\n-—：:，,。；;·|[]（）()")
	if !looksLikeCleanNotebookMindmapLabel(value) {
		return ""
	}
	return value
}

func truncateNotebookMindmapSummary(value string) string {
	return truncateNotebookRunes(value, 120, "…")
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
