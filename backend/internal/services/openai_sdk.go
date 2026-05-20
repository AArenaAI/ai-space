package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	openai "github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/responses"
)

type sdkResponseBody struct {
	reader *io.PipeReader
}

func (b sdkResponseBody) Read(p []byte) (int, error) { return b.reader.Read(p) }
func (b sdkResponseBody) Close() error               { return b.reader.Close() }

func openAIRequestOptionsFromBody(reqBody map[string]any) []option.RequestOption {
	opts := make([]option.RequestOption, 0, len(reqBody))
	for k, v := range reqBody {
		opts = append(opts, option.WithJSONSet(k, v))
	}
	return opts
}

func openAIResponseToBody(resp *responses.Response) (io.ReadCloser, error) {
	if resp == nil {
		return nil, fmt.Errorf("OpenAI SDK 返回空响应")
	}
	payload, err := json.Marshal(resp)
	if err != nil {
		return nil, fmt.Errorf("序列化 OpenAI SDK 响应失败: %w", err)
	}
	return io.NopCloser(strings.NewReader(string(payload))), nil
}

func openAIResponseToMap(resp *responses.Response) (map[string]any, error) {
	body, err := openAIResponseToBody(resp)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	var decoded map[string]any
	decoder := json.NewDecoder(body)
	decoder.UseNumber()
	if err := decoder.Decode(&decoded); err != nil {
		return nil, fmt.Errorf("解析 OpenAI SDK 响应失败: %w", err)
	}
	return decoded, nil
}

func (s *AIService) openAIClient() (openai.Client, error) {
	apiKey := s.cfg.OpenAIOfficialKey
	if apiKey == "" {
		// 兼容旧部署：未配置官方 Key 时回退到旧 OPENAI_API_KEY。
		apiKey = s.cfg.OpenAIKey
	}
	if apiKey == "" {
		return openai.Client{}, fmt.Errorf("未配置 OpenAI API Key")
	}

	// 官方 OpenAI 聊天强制直连官方 API，不读取 OPENAI_BASE_URL，避免误走中转。
	return openai.NewClient(
		option.WithAPIKey(apiKey),
		option.WithBaseURL("https://api.openai.com/v1/"),
		option.WithHTTPClient(DefaultAIHTTPClient),
	), nil
}

func (s *AIService) buildOpenAIResponsesBody(model string, messages []Message, stream bool, reasoning bool, reasoningEffort string, search bool) (map[string]any, bool, int, int) {
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
	inputItems := make([]map[string]any, 0, len(userMessages))
	for _, m := range userMessages {
		item := map[string]any{
			"role": m.Role,
		}
		if len(m.Images) > 0 && m.Role == "user" {
			// [路径B] 内联多模态直传 — 将图片以 input_image 格式发送到 OpenAI Responses API。
			// 注意：这与文件上传 RAG 路径（路径A）完全独立，
			// 路径A的图片已通过 Vision → image_caption chunk → <file_context> 注入。
			contentParts := []map[string]any{
				{"type": "input_text", "text": m.Content},
			}
			for _, img := range m.Images {
				contentParts = append(contentParts, map[string]any{
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
	maxOutputTokens := s.openAIMaxOutputTokens(model, search, reasoning)
	reqBody := map[string]any{
		"model":             model,
		"input":             inputItems,
		"stream":            stream,
		"max_output_tokens": maxOutputTokens,
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
			// OpenAI Responses API 不暴露原始 CoT；summary=auto 显式请求 reasoning summary，
			// 由流式 decoder 映射为 reasoning_content，前端作为思考块展示。
			reasoningConfig["summary"] = "auto"
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

	return reqBody, useBackground, len(inputItems), len(systemInstruction)
}

func (s *AIService) callOpenAIResponsesSDK(ctx context.Context, model string, messages []Message, stream bool, reasoning bool, reasoningEffort string, search bool) (*AICompletionResponse, error) {
	client, err := s.openAIClient()
	if err != nil {
		return nil, err
	}
	reqBody, useBackground, inputCount, instructionsLen := s.buildOpenAIResponsesBody(model, messages, stream, reasoning, reasoningEffort, search)
	fmt.Printf("[OpenAI Responses SDK] model=%s stream=%v reasoning=%v effort=%s search=%v background=%v max_output_tokens=%v tool_choice=%v tools=%v input_items=%d instructions_len=%d\n",
		model,
		stream,
		reasoning,
		reasoningEffort,
		search,
		useBackground,
		reqBody["max_output_tokens"],
		reqBody["tool_choice"],
		reqBody["tools"] != nil,
		inputCount,
		instructionsLen,
	)

	var release func()
	if isGPT55Pro(model) {
		limiter := openAIModelLimiterFor(model, s.cfg.OpenAIGPT55ProMaxConcurrency)
		release, err = limiter.acquire(ctx)
		if err != nil {
			return nil, err
		}
		if pe := limiter.reserveTPM(model, estimateOpenAIRequestedTokens(messages, maxOutputTokensFromBody(reqBody)), s.cfg.OpenAIGPT55ProTPMSoftLimit); pe != nil {
			release()
			return nil, pe
		}
		defer func() {
			if !stream && release != nil {
				release()
			}
		}()
	}

	opts := openAIRequestOptionsFromBody(reqBody)
	if stream {
		params := responses.ResponseNewParams{}
		streamResp := client.Responses.NewStreaming(ctx, params, opts...)
		return &AICompletionResponse{
			Body:       sdkStreamBody{stream: streamResp, release: release},
			Decoder:    NewOpenAIResponsesTypedDecoder(streamResp, model),
			ModelType:  "openai_responses",
			Provider:   "openai",
			Model:      model,
			Background: useBackground,
		}, nil
	}

	resp, err := client.Responses.New(ctx, responses.ResponseNewParams{}, opts...)
	if err != nil {
		if pe := ParseOpenAIProviderError(err, model); pe != nil {
			return nil, pe
		}
		return nil, err
	}
	body, err := openAIResponseToBody(resp)
	if err != nil {
		return nil, err
	}

	return &AICompletionResponse{Body: body, ModelType: "openai_responses", Provider: "openai", Model: model, Background: useBackground}, nil
}

func (s *AIService) retrieveOpenAIResponseSDK(ctx context.Context, responseID string) (map[string]any, error) {
	if strings.TrimSpace(responseID) == "" {
		return nil, fmt.Errorf("response id 为空")
	}
	client, err := s.openAIClient()
	if err != nil {
		return nil, err
	}

	resp, err := client.Responses.Get(ctx, responseID, responses.ResponseGetParams{})
	if err != nil {
		if pe := ParseOpenAIProviderError(err, "gpt-5.5"); pe != nil {
			return nil, pe
		}
		return nil, err
	}
	return openAIResponseToMap(resp)
}
