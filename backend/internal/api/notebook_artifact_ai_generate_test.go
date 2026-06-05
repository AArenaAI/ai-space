package api

import (
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"io"
	"strings"
	"testing"
)

type fakeNotebookAIService struct {
	response string
	err      error
	calls    int
	model    string
	messages []services.Message
}

func (f *fakeNotebookAIService) ChatCompletion(ctx context.Context, model string, messages []services.Message, stream bool, reasoning bool, reasoningEffort services.ReasoningEffort, search bool, textFormat map[string]any) (*services.AICompletionResponse, error) {
	f.calls++
	f.model = model
	f.messages = messages
	if f.err != nil {
		return nil, f.err
	}
	return &services.AICompletionResponse{
		Body:      io.NopCloser(strings.NewReader(f.response)),
		ModelType: "test",
		Provider:  "test",
		Model:     model,
	}, nil
}

func (f *fakeNotebookAIService) RetrieveOpenAIResponse(ctx context.Context, responseID string) (map[string]any, error) {
	return nil, nil
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
