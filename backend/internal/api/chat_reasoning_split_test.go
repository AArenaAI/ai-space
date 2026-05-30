package api

import "testing"

func TestSplitGeminiReasoningTextDelta(t *testing.T) {
	tests := []struct {
		name          string
		delta         string
		wantReasoning string
		wantAnswer    string
	}{
		{
			name:          "splits thought style prefix from final answer",
			delta:         "思考过程：分析测试指令，确认仅需输出指定文本。\n\nOK 42",
			wantReasoning: "思考过程：分析测试指令，确认仅需输出指定文本。",
			wantAnswer:    "OK 42",
		},
		{
			name:          "splits analysis prefix",
			delta:         "分析：先理解问题，然后给出最终答案。\n\n最终答案。",
			wantReasoning: "分析：先理解问题，然后给出最终答案。",
			wantAnswer:    "最终答案。",
		},
		{
			name:          "keeps ordinary text unchanged",
			delta:         "这是正文里的普通分析说明。\n\nOK 42",
			wantReasoning: "",
			wantAnswer:    "这是正文里的普通分析说明。\n\nOK 42",
		},
		{
			name:          "keeps prefix without final answer unchanged",
			delta:         "思考过程：还没有最终答案",
			wantReasoning: "",
			wantAnswer:    "思考过程：还没有最终答案",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotReasoning, gotAnswer := splitGeminiReasoningTextDelta(tt.delta)
			if gotReasoning != tt.wantReasoning || gotAnswer != tt.wantAnswer {
				t.Fatalf("splitGeminiReasoningTextDelta() = (%q, %q), want (%q, %q)", gotReasoning, gotAnswer, tt.wantReasoning, tt.wantAnswer)
			}
		})
	}
}
