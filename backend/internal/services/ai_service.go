package services

import (
	"aipool-backend/internal/config"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type AIService struct {
	cfg      *config.Config
	adapters []ProviderAdapter
}

func NewAIService(cfg *config.Config) *AIService {
	service := &AIService{cfg: cfg}
	service.adapters = []ProviderAdapter{
		NewOpenAIAdapter(service),
		NewAnthropicAdapter(service),
		NewGeminiAdapter(service),
		NewDeepSeekAdapter(service),
		NewMoonshotAdapter(service),
	}
	return service
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	// Images 存储 base64 dataURI（多模态直传），不对应文件上传 RAG 路径。
	// 两条并行路径：
	//   路径A（文件上传 RAG）→ parseImage → Vision → image_caption chunk → <file_context> 注入，所有模型通用。
	//   路径B（内联多模态）  → Message.Images → 模型原生 vision API，仅支持 vision 的模型可用。
	// 未来两者会共存：文件通过路径A提供深度解析，内联图片通过路径B提供即时视觉理解。
	Images []string `json:"-"` // base64 dataURIs for multimodal (Path B), not serialized
}

type ChatRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`
	Stream   bool      `json:"stream"`
}

func (s *AIService) ChatCompletion(ctx context.Context, model string, messages []Message, stream bool, reasoning bool, reasoningEffort string, search bool) (*AICompletionResponse, error) {
	req := UnifiedAIRequest{
		Model:           model,
		Messages:        messages,
		Stream:          stream,
		Reasoning:       reasoning,
		ReasoningEffort: reasoningEffort,
		Search:          search,
	}
	adapter := s.adapterForModel(model)
	if adapter == nil {
		// 保持历史行为：未知模型默认回退到 OpenAI Responses mini。
		req.Model = "gpt-5.4-mini"
		adapter = NewOpenAIAdapter(s)
	}
	return adapter.ChatCompletion(ctx, req)
}

func (s *AIService) adapterForModel(model string) ProviderAdapter {
	for _, adapter := range s.adapters {
		if adapter.Supports(model) {
			return adapter
		}
	}
	return nil
}

func isOpenAI(model string) bool {
	return strings.HasPrefix(model, "gpt-5")
}

// IsOpenAIResponsesModel 公开判断——该模型使用 Responses API (/v1/responses)
func IsOpenAIResponsesModel(model string) bool {
	return isOpenAI(model)
}

// OpenAIUsesBackground 公开判断：聊天层需要在调用后把 response id 保存为后台任务。
func OpenAIUsesBackground(model string, reasoningEffort string) bool {
	return ShouldUseOpenAIBackground(model, reasoningEffort)
}

func ShouldUseOpenAIBackground(model string, reasoningEffort string) bool {
	model = strings.ToLower(strings.TrimSpace(model))
	effort := strings.ToLower(strings.TrimSpace(reasoningEffort))

	if model == "gpt-5.5-pro" || strings.HasPrefix(model, "gpt-5.5-pro-") {
		return true
	}
	if model == "gpt-5.5" || strings.HasPrefix(model, "gpt-5.5-") {
		switch effort {
		case "", "standard", "medium", "extended", "high", "heavy", "max", "xhigh":
			return true
		}
	}
	return false
}

func isAnthropic(model string) bool {
	return strings.HasPrefix(model, "claude-")
}

func isGemini(model string) bool {
	return strings.HasPrefix(model, "gemini-")
}

func isDeepSeek(model string) bool {
	return strings.HasPrefix(model, "deepseek-")
}

func normalizeDeepSeekModel(model string, reasoning bool) string {
	switch model {
	case "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat":
		if reasoning {
			return "deepseek-reasoner"
		}
		return "deepseek-chat"
	case "deepseek-reasoner":
		return "deepseek-reasoner"
	default:
		return model
	}
}

func isMoonshot(model string) bool {
	return strings.HasPrefix(model, "moonshot-") || strings.HasPrefix(model, "kimi")
}

func (s *AIService) callOpenAIResponses(ctx context.Context, model string, messages []Message, stream bool, reasoning bool, reasoningEffort string, search bool) (*AICompletionResponse, error) {
	apiKey := s.cfg.OpenAIOfficialKey
	if apiKey == "" {
		// 兼容旧部署：未配置官方 Key 时回退到旧 OPENAI_API_KEY。
		apiKey = s.cfg.OpenAIKey
	}
	if apiKey == "" {
		return nil, fmt.Errorf("未配置 OpenAI API Key")
	}

	// OpenAI 官方模型强制直连官方 API，不读取 OPENAI_BASE_URL，避免误走中转。
	baseURL := "https://api.openai.com"

	// 提取 system 消息到 instructions。注意：同一次请求可能同时包含模板、技能、图表渲染等多个 system prompt，
	// 不能只保留最后一个，否则前面的模板/功能指令会被覆盖。
	var systemInstructions []string
	var userMessages []Message
	for _, m := range messages {
		if m.Role == "system" {
			if strings.TrimSpace(m.Content) != "" {
				systemInstructions = append(systemInstructions, m.Content)
			}
		} else {
			userMessages = append(userMessages, m)
		}
	}
	systemInstruction := strings.Join(systemInstructions, "\n\n")

	// input 数组 — 把 user/assistant 消息按原样传入
	inputItems := make([]map[string]interface{}, 0, len(userMessages))
	for _, m := range userMessages {
		item := map[string]interface{}{
			"role": m.Role,
		}
		if len(m.Images) > 0 && m.Role == "user" {
			// [路径B] 内联多模态直传 — 将图片以 input_image 格式发送到 OpenAI Responses API。
			// 注意：这与文件上传 RAG 路径（路径A）完全独立，
			// 路径A的图片已通过 Vision → image_caption chunk → <file_context> 注入。
			// 未来两条路径可共存。
			contentParts := []map[string]interface{}{
				{"type": "input_text", "text": m.Content},
			}
			for _, img := range m.Images {
				contentParts = append(contentParts, map[string]interface{}{
					"type":      "input_image",
					"image_url": img,
				})
			}
			item["content"] = contentParts
		} else {
			item["content"] = m.Content
		}
		inputItems = append(inputItems, item)
	}

	useBackground := ShouldUseOpenAIBackground(model, reasoningEffort)
	reqBody := map[string]interface{}{
		"model":             model,
		"input":             inputItems,
		"stream":            stream,
		"max_output_tokens": s.cfg.OpenAIMaxOutputTokens,
		// 默认聊天禁用 Responses API 内置工具。
		"tool_choice": "none",
	}
	if useBackground {
		reqBody["background"] = true
	}

	// instructions 字段处理 system prompt
	if systemInstruction != "" {
		reqBody["instructions"] = systemInstruction
	}

	// Reasoning / thinking 配置 — Responses API 使用嵌套对象
	if reasoning {
		reasoningConfig := map[string]any{}
		if strings.HasPrefix(model, "gpt-5") {
			effort := "medium"
			switch reasoningEffort {
			case "light":
				effort = "low"
			case "standard":
				effort = "medium"
			case "extended", "high":
				effort = "high"
			case "heavy", "max", "xhigh":
				effort = "xhigh"
			case "":
				effort = "medium"
			default:
				effort = reasoningEffort
			}
			reasoningConfig["effort"] = effort
			reasoningConfig["summary"] = "detailed"
			reqBody["reasoning"] = reasoningConfig
		}
	}

	// web_search tools — 仅在用户显式开启搜索时允许 Responses API 原生工具调用。
	// 开启工具时必须把 tool_choice 从 none 调回 auto，否则 web_search 不会被调用。
	if search {
		reqBody["tools"] = []map[string]any{
			{"type": "web_search"},
		}
		reqBody["tool_choice"] = "auto"
	}

	if stream {
		// 防止长篇深度检索持续生成数分钟，前端只收到 ping/半截内容，最终被代理或浏览器超时。
		// 短问答仍可正常完成；超出预算时上游会返回 completed/incomplete，后端再向前端发 [DONE] 或统一错误。
		reqBody["max_output_tokens"] = s.streamMaxOutputTokens(search, reasoning)
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("序列化 OpenAI 请求失败: %w", err)
	}
	fmt.Printf("[OpenAI Responses] model=%s stream=%v reasoning=%v effort=%s search=%v background=%v max_output_tokens=%v tool_choice=%v tools=%v input_items=%d instructions_len=%d\n",
		model,
		stream,
		reasoning,
		reasoningEffort,
		search,
		useBackground,
		reqBody["max_output_tokens"],
		reqBody["tool_choice"],
		reqBody["tools"] != nil,
		len(inputItems),
		len(systemInstruction),
	)
	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/responses", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("创建 OpenAI 请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := DefaultAIHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("OpenAI Responses API 错误: %s", string(body))
	}

	return &AICompletionResponse{Body: resp.Body, ModelType: "openai_responses", Provider: "openai", Model: model, Background: useBackground}, nil
}

func (s *AIService) RetrieveOpenAIResponse(ctx context.Context, responseID string) (map[string]any, error) {
	if adapter, ok := s.adapterForModel("gpt-5.5").(ResponseRetriever); ok {
		return adapter.Retrieve(ctx, responseID)
	}
	return nil, fmt.Errorf("OpenAI adapter 不支持 retrieve")
}

func (s *AIService) retrieveOpenAIResponseHTTP(ctx context.Context, responseID string) (map[string]any, error) {
	apiKey := s.cfg.OpenAIOfficialKey
	if apiKey == "" {
		apiKey = s.cfg.OpenAIKey
	}
	if apiKey == "" {
		return nil, fmt.Errorf("未配置 OpenAI API Key")
	}
	if strings.TrimSpace(responseID) == "" {
		return nil, fmt.Errorf("response id 为空")
	}

	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.openai.com/v1/responses/"+url.PathEscape(responseID), nil)
	if err != nil {
		return nil, fmt.Errorf("创建 OpenAI retrieve 请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := DefaultAIHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("OpenAI retrieve 响应错误: %s", string(body))
	}

	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("解析 OpenAI retrieve 响应失败: %w", err)
	}
	return raw, nil
}

func ExtractOpenAIResponseText(raw map[string]any) string {
	if raw == nil {
		return ""
	}
	if v, ok := raw["output_text"].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	outputs, _ := raw["output"].([]any)
	var parts []string
	for _, item := range outputs {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		content, _ := itemMap["content"].([]any)
		for _, c := range content {
			contentMap, ok := c.(map[string]any)
			if !ok {
				continue
			}
			if text, ok := contentMap["text"].(string); ok && text != "" {
				parts = append(parts, text)
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func (s *AIService) streamMaxOutputTokens(search bool, reasoning bool) int {
	if search {
		return s.cfg.OpenAIMaxOutputTokensSearch
	}
	return s.cfg.OpenAIMaxOutputTokens
}

func (s *AIService) callAnthropic(ctx context.Context, model string, messages []Message, stream bool, reasoning bool) (*AICompletionResponse, error) {
	if s.cfg.AnthropicKey == "" {
		return nil, fmt.Errorf("未配置 Anthropic API Key")
	}

	baseURL := "https://api.anthropic.com"
	if s.cfg.AnthropicBaseURL != "" {
		baseURL = s.cfg.AnthropicBaseURL
	}

	// 提取 system 消息
	var systemMsg string
	var userMsgs []Message
	for _, m := range messages {
		if m.Role == "system" {
			systemMsg = m.Content
		} else {
			userMsgs = append(userMsgs, m)
		}
	}

	// 转换消息为 Anthropic 多模态格式
	anthropicMessages := make([]map[string]interface{}, 0, len(userMsgs))
	for _, m := range userMsgs {
		msg := map[string]interface{}{
			"role": m.Role,
		}
		if len(m.Images) > 0 && m.Role == "user" {
			// [路径B] 内联多模态直传 — Claude Messages API 原生支持 base64 image source。
			// 与文件上传 RAG 路径（路径A）完全独立，不会重复发送文件上传的图片。
			contentParts := []map[string]interface{}{
				{"type": "text", "text": m.Content},
			}
			for _, img := range m.Images {
				mediaType, b64Data := parseDataURI(img)
				contentParts = append(contentParts, map[string]interface{}{
					"type": "image",
					"source": map[string]interface{}{
						"type":       "base64",
						"media_type": mediaType,
						"data":       b64Data,
					},
				})
			}
			msg["content"] = contentParts
		} else {
			msg["content"] = m.Content
		}
		anthropicMessages = append(anthropicMessages, msg)
	}

	reqBody := map[string]interface{}{
		"model":      model,
		"messages":   anthropicMessages,
		"stream":     stream,
		"max_tokens": s.cfg.AnthropicMaxTokens,
	}
	if systemMsg != "" {
		reqBody["system"] = systemMsg
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("序列化 Anthropic 请求失败: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/messages", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("创建 Anthropic 请求失败: %w", err)
	}
	req.Header.Set("x-api-key", s.cfg.AnthropicKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")

	resp, err := DefaultAIHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("Anthropic API 错误: %s", string(body))
	}

	return &AICompletionResponse{Body: resp.Body, ModelType: "anthropic", Provider: "anthropic", Model: model}, nil
}

func (s *AIService) callGemini(ctx context.Context, model string, messages []Message, stream bool, reasoning bool, reasoningEffort string, search bool) (*AICompletionResponse, error) {
	if s.cfg.GeminiKey == "" {
		return nil, fmt.Errorf("未配置 Gemini API Key")
	}

	baseURL := "https://generativelanguage.googleapis.com"
	if s.cfg.GeminiBaseURL != "" {
		baseURL = strings.TrimRight(s.cfg.GeminiBaseURL, "/")
	}

	var systemParts []map[string]interface{}
	contents := make([]map[string]interface{}, 0, len(messages))
	for _, m := range messages {
		parts := geminiPartsFromMessage(m)
		if len(parts) == 0 {
			continue
		}
		if m.Role == "system" {
			systemParts = append(systemParts, parts...)
			continue
		}

		role := "user"
		if m.Role == "assistant" {
			role = "model"
		}
		contents = append(contents, map[string]interface{}{
			"role":  role,
			"parts": parts,
		})
	}
	if len(contents) == 0 {
		contents = append(contents, map[string]interface{}{
			"role":  "user",
			"parts": []map[string]interface{}{{"text": ""}},
		})
	}

	reqBody := map[string]interface{}{
		"contents": contents,
		"generationConfig": map[string]interface{}{
			"maxOutputTokens": 8192,
		},
	}
	if len(systemParts) > 0 {
		reqBody["systemInstruction"] = map[string]interface{}{"parts": systemParts}
	}
	if reasoning {
		thinkingLevel := "medium"
		switch strings.ToLower(reasoningEffort) {
		case "minimal":
			thinkingLevel = "minimal"
		case "low":
			thinkingLevel = "low"
		case "high":
			thinkingLevel = "high"
		}
		genConfig := reqBody["generationConfig"].(map[string]interface{})
		genConfig["thinkingLevel"] = thinkingLevel
		genConfig["thinkingSummaries"] = "auto"
		fmt.Printf("[Gemini] reasoning enabled, thinkingLevel=%s\n", thinkingLevel)
	}
	// Interactions API: 启用原生 Google Search 工具
	if search {
		reqBody["tools"] = []map[string]interface{}{
			{"type": "google_search"},
		}
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("序列化 Gemini 请求失败: %w", err)
	}

	method := "generateContent"
	if stream {
		method = "streamGenerateContent"
	}
	// 使用 Interactions API (v1alpha)
	u, err := url.Parse(fmt.Sprintf("%s/v1alpha/models/%s:%s", baseURL, url.PathEscape(model), method))
	if err != nil {
		return nil, fmt.Errorf("创建 Gemini URL 失败: %w", err)
	}
	q := u.Query()
	q.Set("key", s.cfg.GeminiKey)
	if stream {
		q.Set("alt", "sse")
	}
	u.RawQuery = q.Encode()

	fmt.Printf("[Gemini] model=%s stream=%v search=%v contents=%d body_len=%d\n", model, stream, search, len(contents), len(jsonBody))
	req, err := http.NewRequestWithContext(ctx, "POST", u.String(), bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("创建 Gemini 请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := DefaultAIHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("Gemini API 错误: %s", string(body))
	}

	if stream {
		return &AICompletionResponse{Body: resp.Body, ModelType: "gemini", Provider: "gemini", Model: model}, nil
	}

	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取 Gemini 响应失败: %w", err)
	}
	wrapped, err := wrapGeminiGenerateContentResponse(body, model)
	if err != nil {
		return nil, err
	}
	return &AICompletionResponse{Body: io.NopCloser(bytes.NewReader(wrapped)), ModelType: "gemini", Provider: "gemini", Model: model}, nil
}

func geminiPartsFromMessage(m Message) []map[string]interface{} {
	parts := make([]map[string]interface{}, 0, 1+len(m.Images))
	if strings.TrimSpace(m.Content) != "" {
		parts = append(parts, map[string]interface{}{"text": m.Content})
	}
	if m.Role == "user" {
		for _, img := range m.Images {
			mediaType, b64Data := parseDataURI(img)
			parts = append(parts, map[string]interface{}{
				"inlineData": map[string]interface{}{
					"mimeType": mediaType,
					"data":     b64Data,
				},
			})
		}
	}
	return parts
}

func wrapGeminiGenerateContentResponse(body []byte, model string) ([]byte, error) {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("解析 Gemini 响应失败: %w", err)
	}
	content := extractGeminiText(raw)
	// 追加引用来源
	if grounding := extractGeminiGrounding(raw); grounding != "" {
		content += grounding
	}
	thoughtText := extractGeminiThoughtText(raw)
	message := map[string]interface{}{
		"role":    "assistant",
		"content": content,
	}
	if thoughtText != "" {
		message["reasoning_content"] = thoughtText
	}
	wrapped := map[string]interface{}{
		"model": model,
		"choices": []map[string]interface{}{
			{
				"index":         0,
				"message":       message,
				"finish_reason": "stop",
			},
		},
	}
	if usage, ok := raw["usageMetadata"].(map[string]interface{}); ok {
		wrapped["usage"] = geminiUsageToOpenAIUsage(usage)
	}
	out, err := json.Marshal(wrapped)
	if err != nil {
		return nil, fmt.Errorf("包装 Gemini 响应失败: %w", err)
	}
	return out, nil
}

func extractGeminiGrounding(raw map[string]interface{}) string {
	candidates, _ := raw["candidates"].([]interface{})
	if len(candidates) == 0 {
		return ""
	}
	cand, _ := candidates[0].(map[string]interface{})
	gm, _ := cand["groundingMetadata"].(map[string]interface{})
	if gm == nil {
		return ""
	}
	chunks, _ := gm["groundingChunks"].([]interface{})
	if len(chunks) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\n---\n🔍 参考来源：\n")
	seen := make(map[string]bool)
	idx := 1
	for _, ch := range chunks {
		chunk, _ := ch.(map[string]interface{})
		if chunk == nil {
			continue
		}
		web, _ := chunk["web"].(map[string]interface{})
		if web == nil {
			continue
		}
		uri, _ := web["uri"].(string)
		if uri == "" || seen[uri] {
			continue
		}
		seen[uri] = true
		title, _ := web["title"].(string)
		if title == "" {
			title = uri
		}
		b.WriteString(fmt.Sprintf("%d. [%s](%s)\n", idx, title, uri))
		idx++
	}
	return b.String()
}

func extractGeminiText(raw map[string]interface{}) string {
	var b strings.Builder
	candidates, _ := raw["candidates"].([]interface{})
	for _, c := range candidates {
		cand, _ := c.(map[string]interface{})
		content, _ := cand["content"].(map[string]interface{})
		parts, _ := content["parts"].([]interface{})
		for _, p := range parts {
			part, _ := p.(map[string]interface{})
			if thought, ok := part["thought"].(bool); ok && thought {
				continue
			}
			if text, ok := part["text"].(string); ok {
				b.WriteString(text)
			}
		}
	}
	return b.String()
}

func extractGeminiThoughtText(raw map[string]interface{}) string {
	var b strings.Builder
	candidates, _ := raw["candidates"].([]interface{})
	for _, c := range candidates {
		cand, _ := c.(map[string]interface{})
		content, _ := cand["content"].(map[string]interface{})
		parts, _ := content["parts"].([]interface{})
		for _, p := range parts {
			part, _ := p.(map[string]interface{})
			if thought, ok := part["thought"].(bool); !ok || !thought {
				continue
			}
			if text, ok := part["text"].(string); ok {
				b.WriteString(text)
			}
		}
	}
	return b.String()
}

func geminiUsageToOpenAIUsage(usage map[string]interface{}) map[string]interface{} {
	prompt := geminiUsageInt(usage, "promptTokenCount")
	completion := geminiUsageInt(usage, "candidatesTokenCount")
	total := geminiUsageInt(usage, "totalTokenCount")
	if total == 0 {
		total = prompt + completion
	}
	return map[string]interface{}{
		"prompt_tokens":     prompt,
		"completion_tokens": completion,
		"total_tokens":      total,
		"gemini":            usage,
	}
}

func geminiUsageInt(usage map[string]interface{}, key string) int {
	switch v := usage[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case json.Number:
		i, _ := v.Int64()
		return int(i)
	default:
		return 0
	}
}

func (s *AIService) callDeepSeek(ctx context.Context, model string, messages []Message, stream bool, reasoning bool, reasoningEffort string) (*AICompletionResponse, error) {
	if s.cfg.DeepSeekKey == "" {
		return nil, fmt.Errorf("未配置 DeepSeek API Key")
	}
	apiModel := normalizeDeepSeekModel(model, reasoning)

	baseURL := "https://api.deepseek.com"
	if s.cfg.DeepSeekBaseURL != "" {
		baseURL = s.cfg.DeepSeekBaseURL
	}

	// 转换消息为 OpenAI 兼容格式
	// 注意：DeepSeek 不支持 vision/图片输入（路径B不可用），所以如果消息带了图片，
	// 我们只在文本中提示用户上传了图片，不发送 image_url content parts。
	// 路径B不可用时，路径A（文件上传 RAG → image_caption chunk → <file_context>）
	// 仍然有效——所有模型（包括 DeepSeek）都能从文本形式的图片描述中获得信息。
	deepSeekMessages := make([]map[string]interface{}, 0, len(messages))
	for _, m := range messages {
		msg := map[string]interface{}{
			"role": m.Role,
		}
		if len(m.Images) > 0 && m.Role == "user" {
			contentText := m.Content
			if contentText == "" {
				contentText = "用户上传了图片（共" + fmt.Sprintf("%d", len(m.Images)) + "张），但本模型是纯文本模型，无法查看图片内容。请告知用户当前模型不支持图片识别，建议切换到 GPT-5x 或 Claude 等支持多模态的模型。"
			} else {
				contentText += "\n\n（用户同时上传了 " + fmt.Sprintf("%d", len(m.Images)) + " 张图片，但本模型是纯文本模型，无法查看图片内容。请告知用户当前模型不支持图片识别，建议切换到 GPT-5x 或 Claude 等支持多模态的模型。）"
			}
			msg["content"] = contentText
		} else {
			msg["content"] = m.Content
		}
		deepSeekMessages = append(deepSeekMessages, msg)
	}

	reqBody := map[string]interface{}{
		"model":      apiModel,
		"messages":   deepSeekMessages,
		"stream":     stream,
		"max_tokens": s.cfg.DeepSeekMaxTokens,
	}

	// Streaming 时添加 stream_options 以含 usage 信息
	if stream {
		reqBody["stream_options"] = map[string]any{
			"include_usage": true,
		}
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("序列化 DeepSeek 请求失败: %w", err)
	}
	// 日志记录实际发送的参数，便于排查
	fmt.Printf("[DeepSeek] model=%s api_model=%s reasoning=%v effort=%s body_len=%d\n", model, apiModel, reasoning, reasoningEffort, len(jsonBody))
	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/chat/completions", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("创建 DeepSeek 请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.DeepSeekKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := DefaultAIHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("DeepSeek API 错误: %s", string(body))
	}

	return &AICompletionResponse{Body: resp.Body, ModelType: "deepseek", Provider: "deepseek", Model: model}, nil
}

func (s *AIService) callMoonshot(ctx context.Context, model string, messages []Message, stream bool, reasoning bool) (*AICompletionResponse, error) {
	// 如果未单独配置 Moonshot Key，复用 OpenAI 的 Key（共享中转代理）
	apiKey := s.cfg.MoonshotKey
	if apiKey == "" {
		apiKey = s.cfg.OpenAIKey
	}
	if apiKey == "" {
		return nil, fmt.Errorf("未配置 Moonshot (Kimi) / OpenAI API Key")
	}

	// 如果未单独配置 Moonshot Base URL，复用 OpenAI 的 Base URL（共享中转代理）
	baseURL := s.cfg.MoonshotBaseURL
	if baseURL == "" {
		baseURL = s.cfg.OpenAIBaseURL
	}
	if baseURL == "" {
		baseURL = "https://api.moonshot.cn"
	}

	// 判断当前模型是否支持 vision（Kimi K2.5 及更新版本支持多模态）
	supportsVision := isKimiVisionModel(model)

	// 转换消息为 OpenAI 兼容格式
	moonshotMessages := make([]map[string]interface{}, 0, len(messages))
	for _, m := range messages {
		msg := map[string]interface{}{
			"role": m.Role,
		}

		if len(m.Images) > 0 && m.Role == "user" && supportsVision {
			// [路径B] 内联多模态直传 — Kimi K2.5+ 支持多模态：构建 content array
			content := make([]map[string]interface{}, 0)
			if m.Content != "" {
				content = append(content, map[string]interface{}{
					"type": "text",
					"text": m.Content,
				})
			}
			for _, img := range m.Images {
				content = append(content, map[string]interface{}{
					"type":      "image_url",
					"image_url": map[string]string{"url": img},
				})
			}
			msg["content"] = content
		} else if len(m.Images) > 0 && m.Role == "user" {
			// 旧版 moonshot-v1 不支持 vision，提示用户
			contentText := m.Content
			if contentText == "" {
				contentText = "用户上传了图片（共" + fmt.Sprintf("%d", len(m.Images)) + "张），但当前模型不支持图片识别。请告知用户切换到支持多模态的模型（如 kimi-k2.5）。"
			} else {
				contentText += "\n\n（用户同时上传了 " + fmt.Sprintf("%d", len(m.Images)) + " 张图片，但当前模型不支持图片识别。）"
			}
			msg["content"] = contentText
		} else {
			msg["content"] = m.Content
		}

		moonshotMessages = append(moonshotMessages, msg)
	}

	reqBody := map[string]interface{}{
		"model":       model,
		"messages":    moonshotMessages,
		"stream":      stream,
		"temperature": 1.0,   // Kimi 官方推荐：思考模型使用 temperature=1.0；kimi-k2.6 固定使用 1.0
		"max_tokens":  16384, // Kimi 官方推荐 ≥ 16000，确保 reasoning_content + content 不会被截断
	}

	// Streaming 时添加 stream_options 以含 usage 信息
	if stream {
		reqBody["stream_options"] = map[string]any{
			"include_usage": true,
		}
	}

	// Kimi 思考模式控制
	// kimi-k2.6 默认开启思考能力；kimi-k2.5 也支持思考
	// 当用户未启用思考时，通过 thinking=disabled 关闭
	if strings.HasPrefix(model, "kimi-k2") && !reasoning {
		reqBody["thinking"] = map[string]string{"type": "disabled"}
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("序列化 Moonshot 请求失败: %w", err)
	}
	fmt.Printf("[Moonshot] model=%s reasoning=%v body_len=%d\n", model, reasoning, len(jsonBody))
	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/chat/completions", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("创建 Moonshot 请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := DefaultAIHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("Moonshot API 错误: %s", string(body))
	}

	return &AICompletionResponse{Body: resp.Body, ModelType: "moonshot", Provider: "moonshot", Model: model}, nil
}

// isKimiVisionModel 判断模型是否支持多模态图片理解
func isKimiVisionModel(model string) bool {
	// Kimi K2.5 系列支持 vision；moonshot-v1 系列不支持
	return strings.Contains(model, "kimi-k2.5") || strings.Contains(model, "kimi-k2.6")
}

// parseDataURI 从 data URI 中提取 MIME type 和 base64 数据
// 格式: data:image/jpeg;base64,/9j/4AAQ...
func parseDataURI(dataURI string) (mimeType string, data string) {
	const prefix = "data:"
	if !strings.HasPrefix(dataURI, prefix) {
		return "application/octet-stream", dataURI
	}
	afterPrefix := dataURI[len(prefix):]
	// 找到 ;base64, 分隔符
	idx := strings.Index(afterPrefix, ";base64,")
	if idx < 0 {
		return "application/octet-stream", afterPrefix
	}
	mimeType = afterPrefix[:idx]
	data = afterPrefix[idx+len(";base64,"):]
	return mimeType, data
}

// VisionUsage 记录 Vision API 的 token 消耗和费用
type VisionUsage struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
	CostRMB          float64 // 实际 RMB 花费
}

// ExtractImageContent 使用 Vision API 提取图片描述（支持 OpenAI/Qwen 等兼容接口）
func (s *AIService) ExtractImageContent(ctx context.Context, imageData []byte, mimeType string) (string, *VisionUsage, error) {
	// 确定 Vision 专用的 API Key 和 Base URL，为空则回退到 OpenAI 配置
	apiKey := s.cfg.VisionAPIKey
	if apiKey == "" {
		apiKey = s.cfg.OpenAIKey
	}
	baseURL := s.cfg.VisionBaseURL
	if baseURL == "" {
		baseURL = s.cfg.OpenAIBaseURL
	}
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}

	if apiKey == "" {
		return "", nil, fmt.Errorf("未配置 Vision API Key（VISION_API_KEY 或 OPENAI_API_KEY）")
	}

	base64Data := base64.StdEncoding.EncodeToString(imageData)
	dataURI := fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data)

	reqBody := map[string]interface{}{
		"model": s.cfg.VisionModel,
		"messages": []map[string]interface{}{
			{
				"role": "user",
				"content": []map[string]interface{}{
					{"type": "text", "text": "请详细描述这张图片的内容，包括文字、图表、布局等所有可见信息。如果图片主要是文字内容，请完整转录所有文字。"},
					{"type": "image_url", "image_url": map[string]string{"url": dataURI}},
				},
			},
		},
		"max_tokens": 4096,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", nil, fmt.Errorf("序列化 Vision 请求失败: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(baseURL, "/")+"/chat/completions", bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", nil, fmt.Errorf("创建 Vision 请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := DefaultAIHTTPClient.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", nil, fmt.Errorf("Vision API 错误: %s", string(body))
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", nil, err
	}

	choices, ok := result["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return "", nil, fmt.Errorf("Vision API 返回空结果")
	}

	choice, ok := choices[0].(map[string]interface{})
	if !ok {
		return "", nil, fmt.Errorf("Vision API 返回格式异常")
	}

	msg, ok := choice["message"].(map[string]interface{})
	if !ok {
		return "", nil, fmt.Errorf("Vision API 返回缺少 message")
	}

	content, _ := msg["content"].(string)

	// 解析 usage
	var usage *VisionUsage
	if usageRaw, ok := result["usage"].(map[string]interface{}); ok {
		usage = &VisionUsage{}
		if v, ok := usageRaw["prompt_tokens"].(float64); ok {
			usage.PromptTokens = int(v)
		}
		if v, ok := usageRaw["completion_tokens"].(float64); ok {
			usage.CompletionTokens = int(v)
		}
		if v, ok := usageRaw["total_tokens"].(float64); ok {
			usage.TotalTokens = int(v)
		}

		// 根据配置的单价计算实际 RMB 花费
		if s.cfg.VisionInputPrice > 0 || s.cfg.VisionOutputPrice > 0 {
			cost := (float64(usage.PromptTokens)*s.cfg.VisionInputPrice +
				float64(usage.CompletionTokens)*s.cfg.VisionOutputPrice) / 1000.0
			usage.CostRMB = cost
		}
	}

	return content, usage, nil
}
