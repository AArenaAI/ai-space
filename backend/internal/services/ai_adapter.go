package services

import "context"

// UnifiedAIRequest 是业务层唯一需要理解的统一请求结构。
// Provider 差异（SDK/HTTP、Responses/ChatCompletions、native Gemini 等）必须关在 Adapter 内部。
type UnifiedAIRequest struct {
	Model           string
	Messages        []Message
	Stream          bool
	Reasoning       bool
	ReasoningEffort ReasoningEffort
	Search          bool
	// TextFormat 用于 OpenAI Responses API 的 text.format 结构化输出，仅当非空时生效。
	TextFormat map[string]any
}

// ProviderAdapter 是所有模型厂商的统一适配器接口。
// Provider 差异（SDK/HTTP、Responses/ChatCompletions、native Gemini 等）必须关在 Adapter 内部，不动 ChatHandler/业务层。
type ProviderAdapter interface {
	Name() string
	Supports(model string) bool
	ChatCompletion(ctx context.Context, req UnifiedAIRequest) (*AICompletionResponse, error)
}

// ResponseRetriever 表示该 Provider 支持后台任务 retrieve。
type ResponseRetriever interface {
	Retrieve(ctx context.Context, taskID string) (map[string]any, error)
}

type OpenAIAdapter struct{ service *AIService }

func NewOpenAIAdapter(service *AIService) *OpenAIAdapter { return &OpenAIAdapter{service: service} }
func (a *OpenAIAdapter) Name() string                    { return "openai" }
func (a *OpenAIAdapter) Supports(model string) bool      { return isOpenAI(model) }
func (a *OpenAIAdapter) ChatCompletion(ctx context.Context, req UnifiedAIRequest) (*AICompletionResponse, error) {
	return a.service.callOpenAIResponsesSDK(ctx, req.Model, req.Messages, req.Stream, req.Reasoning, req.ReasoningEffort, req.Search, req.TextFormat)
}
func (a *OpenAIAdapter) Retrieve(ctx context.Context, taskID string) (map[string]any, error) {
	return a.service.retrieveOpenAIResponseSDK(ctx, taskID)
}

type AnthropicAdapter struct{ service *AIService }

func NewAnthropicAdapter(service *AIService) *AnthropicAdapter {
	return &AnthropicAdapter{service: service}
}
func (a *AnthropicAdapter) Name() string               { return "anthropic" }
func (a *AnthropicAdapter) Supports(model string) bool { return isAnthropic(model) }
func (a *AnthropicAdapter) ChatCompletion(ctx context.Context, req UnifiedAIRequest) (*AICompletionResponse, error) {
	return a.service.callAnthropic(ctx, req.Model, req.Messages, req.Stream, req.Reasoning)
}

type GeminiAdapter struct{ service *AIService }

func NewGeminiAdapter(service *AIService) *GeminiAdapter { return &GeminiAdapter{service: service} }
func (a *GeminiAdapter) Name() string                    { return "gemini" }
func (a *GeminiAdapter) Supports(model string) bool      { return isGemini(model) }
func (a *GeminiAdapter) ChatCompletion(ctx context.Context, req UnifiedAIRequest) (*AICompletionResponse, error) {
	return a.service.callGeminiSDK(ctx, req.Model, req.Messages, req.Stream, req.Reasoning, req.ReasoningEffort, req.Search)
}

type DeepSeekAdapter struct{ service *AIService }

func NewDeepSeekAdapter(service *AIService) *DeepSeekAdapter {
	return &DeepSeekAdapter{service: service}
}
func (a *DeepSeekAdapter) Name() string               { return "deepseek" }
func (a *DeepSeekAdapter) Supports(model string) bool { return isDeepSeek(model) }
func (a *DeepSeekAdapter) ChatCompletion(ctx context.Context, req UnifiedAIRequest) (*AICompletionResponse, error) {
	return a.service.callDeepSeek(ctx, req.Model, req.Messages, req.Stream, req.Reasoning, req.ReasoningEffort)
}

type MoonshotAdapter struct{ service *AIService }

func NewMoonshotAdapter(service *AIService) *MoonshotAdapter {
	return &MoonshotAdapter{service: service}
}
func (a *MoonshotAdapter) Name() string               { return "moonshot" }
func (a *MoonshotAdapter) Supports(model string) bool { return isMoonshot(model) }
func (a *MoonshotAdapter) ChatCompletion(ctx context.Context, req UnifiedAIRequest) (*AICompletionResponse, error) {
	return a.service.callMoonshot(ctx, req.Model, req.Messages, req.Stream, req.Reasoning)
}
