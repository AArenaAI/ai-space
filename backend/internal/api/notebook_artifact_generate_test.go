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

func TestBuildGeneratedNotebookArtifactDraftRejectsUnsupportedTypesAndEmptySources(t *testing.T) {
	readyFiles := []models.File{{ID: 1, Filename: "资料.md", ParseStatus: "done", EmbeddingStatus: "done", Content: "有效内容"}}
	if _, err := buildGeneratedNotebookArtifactDraft("mindmap", "知识库", readyFiles, nil, "zh-CN"); err == nil {
		t.Fatalf("unsupported generation type should fail")
	}
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
