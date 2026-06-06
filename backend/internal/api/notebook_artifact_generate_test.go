package api

import (
	"aipool-backend/internal/models"
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildGeneratedNotebookArtifactDraftUsesSelectedReadySources(t *testing.T) {
	files := []models.File{
		{ID: 1, Filename: "产品方案.md", ParseStatus: "done", EmbeddingStatus: "done", Summary: "产品定位与核心能力", Content: "AI Space 是一个面向知识工作的 AI 工作台，支持资料上传、问答和结构化输出。"},
		{ID: 2, Filename: "失败资料.pdf", ParseStatus: "error", EmbeddingStatus: "pending", Summary: "不应进入生成范围", Content: "失败内容"},
		{ID: 3, Filename: "技术说明.md", ParseStatus: "done", EmbeddingStatus: "skipped", Summary: "技术架构", Content: "系统通过 Notebook 组织资料，并通过 Studio 输出摘要、FAQ 和表格。"},
	}

	draft, err := buildGeneratedNotebookArtifactDraft("summary", "知识库", files, []uint{3, 1}, "zh-CN")
	if err != nil {
		t.Fatalf("buildGeneratedNotebookArtifactDraft returned error: %v", err)
	}
	if draft.Type != "summary" {
		t.Fatalf("draft.Type = %q, want summary", draft.Type)
	}
	if draft.SourceCount != 2 {
		t.Fatalf("draft.SourceCount = %d, want 2", draft.SourceCount)
	}
	if draft.Title == "" || draft.Subtitle == "" {
		t.Fatalf("title/subtitle should be populated, got title=%q subtitle=%q", draft.Title, draft.Subtitle)
	}
	var content struct {
		Sections []struct {
			Heading string   `json:"heading"`
			Body    string   `json:"body"`
			Bullets []string `json:"bullets"`
		} `json:"sections"`
	}
	if err := json.Unmarshal(draft.Content, &content); err != nil {
		t.Fatalf("draft content should be valid JSON: %v", err)
	}
	if len(content.Sections) < 2 {
		t.Fatalf("expected multiple summary sections, got %d", len(content.Sections))
	}
	encoded := string(draft.Content)
	if !containsAll(encoded, []string{"技术说明.md", "产品方案.md"}) {
		t.Fatalf("content should include selected ready source names, got %s", encoded)
	}
	if containsAll(encoded, []string{"失败资料.pdf"}) {
		t.Fatalf("content should exclude failed source, got %s", encoded)
	}
}

func TestBuildGeneratedNotebookArtifactDraftBuildsDataTableFromSourceContent(t *testing.T) {
	files := []models.File{
		{ID: 1, Filename: "AI Space 产品方案.md", ParseStatus: "done", EmbeddingStatus: "done", Summary: "AI Space 功能与优势", Content: "## 多模型聊天\n核心功能：流式对话、多模型切换、历史管理。当前状态：成熟。差异化竞争优势：统一接入 OpenAI、Claude、Gemini、DeepSeek 等模型，适合不同任务选型。对标产品：ChatGPT、Poe。\n## Notebook 资料问答\n核心功能：PDF/Office/网页资料解析、Embedding、向量检索、引用核查。当前状态：成熟。差异化竞争优势：全自研 RAG 流水线，资料可跨对话复用。对标产品：NotebookLM、Claude Projects。\n## Studio 数据表格\n核心功能：阅读选中资料后按功能模块整理为结构化表格。当前状态：建设中。差异化竞争优势：把文档内容直接转成可导出、可复核的表格。对标产品：Notion AI、NotebookLM。"},
		{ID: 2, Filename: "投研报告.pdf", ParseStatus: "done", EmbeddingStatus: "skipped", Summary: "市场结论：知识工作用户需要资料整理、引用核查和表格化对比。", Content: "用户场景包括上传报告、按来源整理关键观点、输出表格并导出。商业价值是减少人工整理时间。"},
	}

	draft, err := buildGeneratedNotebookArtifactDraft("table", "AI Space 调研", files, nil, "zh-CN")
	if err != nil {
		t.Fatalf("table generation should succeed: %v", err)
	}
	if draft.Type != "data-table" {
		t.Fatalf("draft.Type = %q, want data-table", draft.Type)
	}
	var content struct {
		Rows []notebookStudioTableRow `json:"rows"`
	}
	if err := json.Unmarshal(draft.Content, &content); err != nil {
		t.Fatalf("table content should be valid JSON: %v", err)
	}
	if len(content.Rows) < 4 {
		t.Fatalf("expected multiple function rows extracted from source content, got %d content=%s", len(content.Rows), string(draft.Content))
	}
	encoded := string(draft.Content)
	if !containsAll(encoded, []string{"多模型聊天", "Notebook 资料问答", "Studio 数据表格", "统一接入", "ChatGPT", "NotebookLM", "[1]", "[2]"}) {
		t.Fatalf("table should organize source facts and citations, got %s", encoded)
	}
	if strings.Contains(encoded, "解析状态") || strings.Contains(encoded, "索引状态") || strings.Contains(encoded, "已就绪") {
		t.Fatalf("table should not be a parsing/indexing status checklist, got %s", encoded)
	}
}

func TestBuildGeneratedNotebookArtifactDraftSupportsMindmapAndRejectsSlides(t *testing.T) {
	readyFiles := []models.File{
		{ID: 1, Filename: "产品方案.md", ParseStatus: "done", EmbeddingStatus: "done", Summary: "产品定位", Content: "AI Space 是知识工作台。"},
		{ID: 2, Filename: "技术架构.md", ParseStatus: "done", EmbeddingStatus: "skipped", Summary: "技术架构", Content: "Notebook 通过资料、问答和 Studio 输出组织知识。"},
	}
	draft, err := buildGeneratedNotebookArtifactDraft("mindmap", "知识库", readyFiles, nil, "zh-CN")
	if err != nil {
		t.Fatalf("mindmap generation should be supported: %v", err)
	}
	if draft.Type != "mindmap" {
		t.Fatalf("draft.Type = %q, want mindmap", draft.Type)
	}
	var content struct {
		Nodes []struct {
			ID    string `json:"id"`
			Label string `json:"label"`
		} `json:"nodes"`
		Edges []struct {
			From string `json:"from"`
			To   string `json:"to"`
		} `json:"edges"`
	}
	if err := json.Unmarshal(draft.Content, &content); err != nil {
		t.Fatalf("mindmap content should be valid JSON: %v", err)
	}
	if len(content.Nodes) < 3 || len(content.Edges) < 2 {
		t.Fatalf("mindmap should include root, topic nodes and edges, got nodes=%d edges=%d content=%s", len(content.Nodes), len(content.Edges), string(draft.Content))
	}
	encoded := string(draft.Content)
	if !strings.Contains(encoded, `"from":"root"`) || !strings.Contains(encoded, `"label":"主题"`) || !strings.Contains(encoded, `[1]`) {
		t.Fatalf("mindmap should organize source content into cited topic branches, got %s", encoded)
	}
	if _, err := buildGeneratedNotebookArtifactDraft("slides", "知识库", readyFiles, nil, "zh-CN"); err == nil {
		t.Fatalf("slides generation should remain unsupported")
	}
}

func TestBuildGeneratedNotebookArtifactDraftRejectsEmptySources(t *testing.T) {
	failedFiles := []models.File{{ID: 2, Filename: "失败.pdf", ParseStatus: "error", EmbeddingStatus: "pending", Content: "失败"}}
	if _, err := buildGeneratedNotebookArtifactDraft("summary", "知识库", failedFiles, nil, "zh-CN"); err == nil {
		t.Fatalf("generation without ready sources should fail")
	}
}

func containsAll(text string, parts []string) bool {
	for _, part := range parts {
		if !stringsContains(text, part) {
			return false
		}
	}
	return true
}

func stringsContains(text string, part string) bool {
	return strings.Contains(text, part)
}
