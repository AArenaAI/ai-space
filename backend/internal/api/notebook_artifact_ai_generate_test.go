package api

import (
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"io"
	"strings"
	"testing"
	"time"
)

type fakeNotebookAIService struct {
	response          string
	err               error
	background        bool
	retrieveResponses []map[string]any
	retrieveCalls     int
	calls             int
	model             string
	messages          []services.Message
}

func (f *fakeNotebookAIService) ChatCompletion(ctx context.Context, model string, messages []services.Message, stream bool, reasoning bool, reasoningEffort services.ReasoningEffort, search bool, textFormat map[string]any) (*services.AICompletionResponse, error) {
	f.calls++
	f.model = model
	f.messages = messages
	if f.err != nil {
		return nil, f.err
	}
	return &services.AICompletionResponse{
		Body:       io.NopCloser(strings.NewReader(f.response)),
		ModelType:  "test",
		Provider:   "test",
		Model:      model,
		Background: f.background,
	}, nil
}

func (f *fakeNotebookAIService) RetrieveOpenAIResponse(ctx context.Context, responseID string) (map[string]any, error) {
	f.retrieveCalls++
	if len(f.retrieveResponses) == 0 {
		return map[string]any{"status": "completed", "output_text": ""}, nil
	}
	idx := f.retrieveCalls - 1
	if idx >= len(f.retrieveResponses) {
		idx = len(f.retrieveResponses) - 1
	}
	return f.retrieveResponses[idx], nil
}

func TestBuildAINotebookArtifactDraftUsesAIJSON(t *testing.T) {
	files := []models.File{
		{ID: 1, Filename: "产品方案.md", ParseStatus: "done", EmbeddingStatus: "done", Summary: "产品定位", Content: "AI Space 是知识工作台。"},
	}
	ai := &fakeNotebookAIService{response: `{"title":"AI 摘要标题","subtitle":"AI 副标题","content":{"sections":[{"heading":"AI 结论","body":"来自模型的结构化摘要"}]}}`}

	draft, err := buildAINotebookArtifactDraft(context.Background(), ai, "summary", "知识库", files, []uint{1}, "zh-CN")
	if err != nil {
		t.Fatalf("buildAINotebookArtifactDraft returned error: %v", err)
	}
	if ai.calls != 1 {
		t.Fatalf("AI service calls = %d, want 1", ai.calls)
	}
	if draft.Title != "AI 摘要标题" || draft.Subtitle != "AI 副标题" {
		t.Fatalf("draft title/subtitle should come from AI, got %q / %q", draft.Title, draft.Subtitle)
	}
	if !strings.Contains(string(draft.Content), "来自模型的结构化摘要") {
		t.Fatalf("draft content should come from AI JSON, got %s", string(draft.Content))
	}
	if draft.SourceCount != 1 || draft.Type != "summary" {
		t.Fatalf("unexpected draft metadata: type=%s sourceCount=%d", draft.Type, draft.SourceCount)
	}
	if ai.model == "" {
		t.Fatalf("AI generation should select a model")
	}
	joined := ""
	for _, msg := range ai.messages {
		joined += msg.Content + "\n"
	}
	if !strings.Contains(joined, "产品方案.md") || !strings.Contains(joined, "AI Space 是知识工作台") {
		t.Fatalf("prompt should include selected source context, got %s", joined)
	}
}

func TestBuildAINotebookArtifactDraftFallsBackWhenAIInvalid(t *testing.T) {
	files := []models.File{
		{ID: 1, Filename: "产品方案.md", ParseStatus: "done", EmbeddingStatus: "done", Summary: "产品定位", Content: "AI Space 是知识工作台。"},
	}
	ai := &fakeNotebookAIService{response: `not json`}

	draft, err := buildAINotebookArtifactDraft(context.Background(), ai, "summary", "知识库", files, []uint{1}, "zh-CN")
	if err != nil {
		t.Fatalf("buildAINotebookArtifactDraft should fall back instead of failing: %v", err)
	}
	if ai.calls != 1 {
		t.Fatalf("AI service calls = %d, want 1", ai.calls)
	}
	if draft.Title == "" || strings.Contains(draft.Title, "AI 摘要标题") {
		t.Fatalf("fallback draft should have generated local title, got %q", draft.Title)
	}
	if !strings.Contains(string(draft.Content), "产品方案.md") {
		t.Fatalf("fallback content should include source names, got %s", string(draft.Content))
	}
}

func TestBuildAINotebookArtifactDraftDeduplicatesAIReturnedTableRows(t *testing.T) {
	files := []models.File{
		{ID: 1, Filename: "产品方案.md", ParseStatus: "done", EmbeddingStatus: "done", Summary: "产品定位", Content: "AI Space 是知识工作台。"},
	}
	ai := &fakeNotebookAIService{response: `{"title":"AI 表格","subtitle":"AI 副标题","content":{"rows":[{"module":"多模型聊天","capability":"统一接入多个模型并支持对话","status":"成熟","implementation":"统一管理模型","value":"ChatGPT、Poe","source":"[1]"},{"module":"多模型聊天","capability":"统一接入多个模型并支持对话","status":"成熟","implementation":"统一管理模型","value":"ChatGPT、Poe","source":"[1]"},{"module":"Notebook资料问答","capability":"资料解析、问答和引用核查","status":"成熟","implementation":"RAG 流水线","value":"NotebookLM","source":"[1]"}]}}`}

	draft, err := buildAINotebookArtifactDraft(context.Background(), ai, "table", "知识库", files, []uint{1}, "zh-CN")
	if err != nil {
		t.Fatalf("table AI draft should succeed: %v", err)
	}
	if strings.Count(string(draft.Content), "多模型聊天") != 1 {
		t.Fatalf("AI table rows should be deduplicated before saving, got %s", string(draft.Content))
	}
}

func TestBuildAINotebookArtifactDraftCleansAIReturnedFlashcards(t *testing.T) {
	files := []models.File{
		{ID: 1, Filename: "产品方案.md", ParseStatus: "done", EmbeddingStatus: "done", Summary: "产品定位", Content: "AI Space 技能系统预设了 9 种角色。"},
	}
	ai := &fakeNotebookAIService{response: `{"title":"AI 闪卡","subtitle":"AI 副标题","content":{"cards":[{"front":"【1】1.3 技能系统的核心内容是什么？","back":"[1] AI Space 技能系统预设了 9 种角色，包括 CEO 策略师、代码审查和翻译。插件架构支持运行时热加载。后续还会继续补充更多角色，用于不同工作场景。","source":"[1]"}]}}`}

	draft, err := buildAINotebookArtifactDraft(context.Background(), ai, "flashcards", "知识库", files, []uint{1}, "zh-CN")
	if err != nil {
		t.Fatalf("flashcard AI draft should succeed: %v", err)
	}
	encoded := string(draft.Content)
	if strings.Contains(encoded, "[1]") || strings.Contains(encoded, "【1】") || strings.Contains(encoded, "1.3") {
		t.Fatalf("AI flashcards should be cleaned before saving, got %s", encoded)
	}
	if !strings.Contains(encoded, "9 种角色") || !strings.Contains(encoded, "技能系统") {
		t.Fatalf("AI flashcards should preserve concise facts, got %s", encoded)
	}
}

func TestBuildAINotebookArtifactDraftKeepsFlashcardTitleWhenAIReturnsSummaryTitle(t *testing.T) {
	files := []models.File{
		{ID: 1, Filename: "产品方案.md", ParseStatus: "done", EmbeddingStatus: "done", Summary: "产品定位", Content: "AI Space 技能系统预设了 9 种角色。"},
	}
	ai := &fakeNotebookAIService{response: `{"title":"摘要","subtitle":"AI 副标题","content":{"cards":[{"front":"技能系统预设了多少种角色？","back":"技能系统预设了 9 种角色。","source":""}]}}`}

	draft, err := buildAINotebookArtifactDraft(context.Background(), ai, "flashcards", "测试 1", files, []uint{1}, "zh-CN")
	if err != nil {
		t.Fatalf("flashcard AI draft should succeed: %v", err)
	}
	if draft.Title == "摘要" || strings.Contains(draft.Title, "摘要") {
		t.Fatalf("flashcards should not use a generic AI summary title, got %q", draft.Title)
	}
	if !strings.Contains(draft.Title, "闪卡") {
		t.Fatalf("flashcards should keep a flashcard-specific title, got %q", draft.Title)
	}
}

func TestBuildAINotebookMindmapRejectsInvalidAIInsteadOfFallback(t *testing.T) {
	files := []models.File{
		{ID: 1, Filename: "产品方案.md", ParseStatus: "done", EmbeddingStatus: "done", Summary: "产品定位", Content: "AI Space 是企业级多模型 AI 聚合平台。"},
	}
	ai := &fakeNotebookAIService{response: `not json`}

	_, err := buildAINotebookArtifactDraft(context.Background(), ai, "mindmap", "测试1", files, []uint{1}, "zh-CN")
	if err == nil {
		t.Fatalf("mindmap should reject invalid AI output instead of saving fallback pseudo-map")
	}
}

func TestBuildAINotebookMindmapWaitsForBackgroundResponse(t *testing.T) {
	oldSleep := generationRetrySleep
	generationRetrySleep = func(d time.Duration) {}
	defer func() { generationRetrySleep = oldSleep }()

	files := []models.File{
		{ID: 1, Filename: "AI Space.pdf", ParseStatus: "done", EmbeddingStatus: "done", Summary: "产品定位", Content: "AI Space 是企业级多模型 AI 聚合平台。"},
	}
	ai := &fakeNotebookAIService{
		response:   `{"id":"resp_test","status":"queued"}`,
		background: true,
		retrieveResponses: []map[string]any{
			{"status": "queued"},
			{"status": "completed", "output_text": validNotebookMindmapAIJSON()},
		},
	}

	draft, err := buildAINotebookArtifactDraft(context.Background(), ai, "mindmap", "测试1", files, []uint{1}, "zh-CN")
	if err != nil {
		t.Fatalf("background mindmap should wait for completed output: %v", err)
	}
	if ai.retrieveCalls < 2 {
		t.Fatalf("expected polling retrieve calls, got %d", ai.retrieveCalls)
	}
	if !strings.Contains(string(draft.Content), "Workspace进化路径") {
		t.Fatalf("draft should use completed background output, got %s", string(draft.Content))
	}
}

func validNotebookMindmapAIJSON() string {
	return `{"title":"AI Space 思维导图","subtitle":"完整模型分析","content":{"nodes":[{"id":"root","label":"AI Space平台"},{"id":"branch-1","label":"产品定位"},{"id":"branch-1-1","label":"多模型聚合"},{"id":"branch-1-2","label":"知识工作台"},{"id":"branch-2","label":"已落地功能"},{"id":"branch-2-1","label":"图片生成编辑"},{"id":"branch-2-2","label":"技能系统"},{"id":"branch-2-3","label":"文件RAG解析"},{"id":"branch-3","label":"核心优势"},{"id":"branch-3-1","label":"品牌白标能力"},{"id":"branch-3-2","label":"稳定技术底座"},{"id":"branch-4","label":"技术架构特色"},{"id":"branch-4-1","label":"Go单二进制"},{"id":"branch-4-2","label":"Next前端"},{"id":"branch-5","label":"Workspace进化路径"},{"id":"branch-5-1","label":"结构化项目"}],"edges":[{"from":"root","to":"branch-1"},{"from":"branch-1","to":"branch-1-1"},{"from":"branch-1","to":"branch-1-2"},{"from":"root","to":"branch-2"},{"from":"branch-2","to":"branch-2-1"},{"from":"branch-2","to":"branch-2-2"},{"from":"branch-2","to":"branch-2-3"},{"from":"root","to":"branch-3"},{"from":"branch-3","to":"branch-3-1"},{"from":"branch-3","to":"branch-3-2"},{"from":"root","to":"branch-4"},{"from":"branch-4","to":"branch-4-1"},{"from":"branch-4","to":"branch-4-2"},{"from":"root","to":"branch-5"},{"from":"branch-5","to":"branch-5-1"}]}}`
}
