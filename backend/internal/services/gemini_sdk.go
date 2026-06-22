package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"google.golang.org/genai"
)

func (s *AIService) geminiClient(ctx context.Context) (*genai.Client, error) {
	if s.cfg.GeminiKey == "" {
		return nil, fmt.Errorf("未配置 Gemini API Key")
	}

	clientConfig := &genai.ClientConfig{
		APIKey:     s.cfg.GeminiKey,
		Backend:    genai.BackendGeminiAPI,
		HTTPClient: DefaultAIHTTPClient,
		HTTPOptions: genai.HTTPOptions{
			APIVersion: "v1beta",
		},
	}
	if strings.TrimSpace(s.cfg.GeminiBaseURL) != "" {
		clientConfig.HTTPOptions.BaseURL = strings.TrimRight(s.cfg.GeminiBaseURL, "/") + "/"
	}
	return genai.NewClient(ctx, clientConfig)
}

func (s *AIService) callGeminiSDK(ctx context.Context, model string, messages []Message, stream bool, reasoning bool, reasoningEffort ReasoningEffort, search bool) (*AICompletionResponse, error) {
	client, err := s.geminiClient(ctx)
	if err != nil {
		return nil, err
	}

	contents, config := s.buildGeminiGenerateContentRequest(model, messages, stream, reasoning, reasoningEffort, search)
	fmt.Printf("[Gemini SDK] model=%s stream=%v reasoning=%v effort=%s search=%v max_output_tokens=%d contents=%d\n", model, stream, reasoning, reasoningEffort, search, config.MaxOutputTokens, len(contents))

	if stream {
		seq := client.Models.GenerateContentStream(ctx, model, contents, config)
		return &AICompletionResponse{
			Body:      geminiSDKStreamBody{},
			Decoder:   NewGeminiSDKStreamDecoder(ctx, seq),
			ModelType: "gemini",
			Provider:  "gemini",
			Model:     model,
		}, nil
	}

	resp, err := client.Models.GenerateContent(ctx, model, contents, config)
	if err != nil {
		return nil, err
	}
	body, err := geminiSDKResponseToOpenAICompatibleBody(resp, model)
	if err != nil {
		return nil, err
	}
	return &AICompletionResponse{Body: body, ModelType: "gemini", Provider: "gemini", Model: model}, nil
}

func (s *AIService) buildGeminiGenerateContentRequest(model string, messages []Message, stream bool, reasoning bool, reasoningEffort ReasoningEffort, search bool) ([]*genai.Content, *genai.GenerateContentConfig) {
	var systemParts []*genai.Part
	contents := make([]*genai.Content, 0, len(messages))

	for _, m := range messages {
		parts := geminiSDKPartsFromMessage(m)
		if len(parts) == 0 {
			continue
		}
		if m.Role == "system" {
			systemParts = append(systemParts, parts...)
			continue
		}

		var role genai.Role = genai.RoleUser
		if m.Role == "assistant" {
			role = genai.RoleModel
		}
		contents = append(contents, genai.NewContentFromParts(parts, role))
	}
	if len(contents) == 0 {
		contents = append(contents, genai.NewContentFromText("", genai.RoleUser))
	}

	maxOutputTokens := s.cfg.OpenAIMaxOutputTokens
	if stream {
		maxOutputTokens = s.streamMaxOutputTokens(search, reasoning)
	} else if reasoning && search {
		maxOutputTokens = s.cfg.OpenAIMaxOutputTokensDeepSearch
	} else if reasoning {
		maxOutputTokens = s.cfg.OpenAIMaxOutputTokensDeep
	} else if search {
		maxOutputTokens = s.cfg.OpenAIMaxOutputTokensSearch
	}
	config := &genai.GenerateContentConfig{
		MaxOutputTokens: int32(maxOutputTokens),
	}
	if len(systemParts) > 0 {
		config.SystemInstruction = genai.NewContentFromParts(systemParts, genai.RoleUser)
	}
	if reasoning {
		config.ThinkingConfig = geminiThinkingConfigForModel(model, reasoningEffort)
		if config.ThinkingConfig.ThinkingBudget != nil {
			fmt.Printf("[Gemini SDK] reasoning enabled, thinkingBudget=%d\n", *config.ThinkingConfig.ThinkingBudget)
		} else {
			fmt.Printf("[Gemini SDK] reasoning enabled, thinkingLevel=%s\n", config.ThinkingConfig.ThinkingLevel)
		}
	}
	if search {
		config.Tools = []*genai.Tool{{GoogleSearch: &genai.GoogleSearch{}}}
	}
	return contents, config
}

func geminiThinkingConfigForModel(model string, reasoningEffort ReasoningEffort) *genai.ThinkingConfig {
	cfg := &genai.ThinkingConfig{IncludeThoughts: true}
	if isGemini25Model(model) {
		budget := reasoningEffort.ToGemini25ThinkingBudget()
		cfg.ThinkingBudget = &budget
		return cfg
	}
	cfg.ThinkingLevel = reasoningEffort.ToGeminiValue()
	return cfg
}

func isGemini25Model(model string) bool {
	model = strings.ToLower(strings.TrimSpace(model))
	return strings.HasPrefix(model, "gemini-2.5-")
}

func geminiSDKPartsFromMessage(m Message) []*genai.Part {
	parts := make([]*genai.Part, 0, 1+len(m.Images)+len(m.Files))
	if strings.TrimSpace(m.Content) != "" {
		parts = append(parts, genai.NewPartFromText(m.Content))
	}
	if m.Role == "user" {
		for _, img := range m.Images {
			mediaType, b64Data := parseDataURI(img)
			data, err := decodeGeminiInlineData(b64Data)
			if err != nil {
				continue
			}
			parts = append(parts, genai.NewPartFromBytes(data, mediaType))
		}
		for _, file := range m.Files {
			mediaType, b64Data := parseDataURI(file.DataURI)
			if strings.TrimSpace(file.MimeType) != "" {
				mediaType = file.MimeType
			}
			data, err := decodeGeminiInlineData(b64Data)
			if err != nil {
				continue
			}
			parts = append(parts, genai.NewPartFromBytes(data, mediaType))
		}
	}
	return parts
}

func decodeGeminiInlineData(data string) ([]byte, error) {
	if strings.TrimSpace(data) == "" {
		return nil, fmt.Errorf("空图片数据")
	}
	decoded, err := base64StdDecode(data)
	if err == nil {
		return decoded, nil
	}
	return base64RawDecode(data)
}

func base64StdDecode(data string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(data)
}

func base64RawDecode(data string) ([]byte, error) {
	return base64.RawStdEncoding.DecodeString(data)
}

func geminiSDKResponseToOpenAICompatibleBody(resp *genai.GenerateContentResponse, model string) (io.ReadCloser, error) {
	if resp == nil {
		return nil, fmt.Errorf("Gemini SDK 返回空响应")
	}
	wrapped := geminiSDKResponseToOpenAICompatibleMap(resp, model)
	out, err := json.Marshal(wrapped)
	if err != nil {
		return nil, fmt.Errorf("包装 Gemini SDK 响应失败: %w", err)
	}
	return io.NopCloser(bytes.NewReader(out)), nil
}

func geminiSDKResponseToOpenAICompatibleMap(resp *genai.GenerateContentResponse, model string) map[string]any {
	content, thoughtText := geminiSDKExtractText(resp)
	if grounding := geminiSDKGroundingText(resp); grounding != "" {
		content += grounding
	}

	message := map[string]any{
		"role":    "assistant",
		"content": content,
	}
	if thoughtText != "" {
		message["reasoning_content"] = thoughtText
	}
	wrapped := map[string]any{
		"model": model,
		"choices": []map[string]any{
			{
				"index":         0,
				"message":       message,
				"finish_reason": "stop",
			},
		},
	}
	if usage := geminiSDKUsageToOpenAIUsage(resp.UsageMetadata); usage != nil {
		wrapped["usage"] = usage
	}
	return wrapped
}

func geminiSDKExtractText(resp *genai.GenerateContentResponse) (string, string) {
	var content strings.Builder
	var thought strings.Builder
	for _, cand := range resp.Candidates {
		if cand == nil || cand.Content == nil {
			continue
		}
		for _, part := range cand.Content.Parts {
			if part == nil || part.Text == "" {
				continue
			}
			if part.Thought {
				thought.WriteString(part.Text)
			} else {
				content.WriteString(part.Text)
			}
		}
	}
	return content.String(), thought.String()
}

func geminiSDKGroundingText(resp *genai.GenerateContentResponse) string {
	var citations []geminiCitation
	for _, cand := range resp.Candidates {
		if cand == nil || cand.GroundingMetadata == nil {
			continue
		}
		for _, chunk := range cand.GroundingMetadata.GroundingChunks {
			if chunk == nil || chunk.Web == nil || chunk.Web.URI == "" {
				continue
			}
			citations = append(citations, geminiCitation{Title: chunk.Web.Title, URI: chunk.Web.URI})
		}
	}
	if len(citations) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\n---\n🔍 参考来源：\n")
	seen := make(map[string]bool)
	idx := 1
	for _, c := range citations {
		if c.URI == "" || seen[c.URI] {
			continue
		}
		seen[c.URI] = true
		title := c.Title
		if title == "" {
			title = c.URI
		}
		b.WriteString(fmt.Sprintf("%d. [%s](%s)\n", idx, title, c.URI))
		idx++
	}
	if idx == 1 {
		return ""
	}
	return b.String()
}

func geminiSDKUsageToOpenAIUsage(usage *genai.GenerateContentResponseUsageMetadata) map[string]any {
	if usage == nil {
		return nil
	}
	prompt := int(usage.PromptTokenCount)
	completion := int(usage.CandidatesTokenCount)
	total := int(usage.TotalTokenCount)
	if total == 0 {
		total = prompt + completion
	}
	if prompt == 0 && completion == 0 && total == 0 {
		return nil
	}
	return map[string]any{
		"prompt_tokens":     prompt,
		"completion_tokens": completion,
		"total_tokens":      total,
		"gemini": map[string]any{
			"promptTokenCount":     prompt,
			"candidatesTokenCount": completion,
			"totalTokenCount":      total,
		},
	}
}

type geminiSDKStreamBody struct{}

func (geminiSDKStreamBody) Read(_ []byte) (int, error) { return 0, io.EOF }
func (geminiSDKStreamBody) Close() error               { return nil }
