package services

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// UsageService 统一 API 用量/费用记录服务
type UsageService struct {
	cfg *config.Config
}

// UsageContext carries optional business dimensions for precise admin usage drill-downs.
type UsageContext struct {
	GuestID        string
	ResourceType   string
	ResourceID     uint
	ConversationID uint
	MessageID      uint
	TaskID         uint
	WorkspaceID    uint
	NotebookID     uint
	RequestID      string
	LatencyMs      int
}

func NewUsageService(cfg *config.Config) *UsageService {
	return &UsageService{cfg: cfg}
}

// RecordUsage 通用记录 usage 方法
func (s *UsageService) RecordUsage(usage *models.APIUsageLog) error {
	if models.DB == nil {
		return nil
	}
	return models.DB.Create(usage).Error
}

// RecordChatUsage 记录 Chat 用量
func (s *UsageService) RecordChatUsage(userID uint, provider, model, modelType string, usage *TokenUsage) error {
	if usage == nil {
		return nil
	}

	inputPrice, outputPrice := s.getChatPrice(provider)
	cost := models.CalculateTokenCost(usage.PromptTokens, usage.CompletionTokens, inputPrice, outputPrice)

	status := "success"
	if usage.Estimated {
		status = "estimated"
	}

	rawJSON := ""
	if usage.Raw != nil {
		b, _ := json.Marshal(usage.Raw)
		rawJSON = string(b)
	}

	return s.RecordUsage(&models.APIUsageLog{
		UserID:             userID,
		Service:            "chat",
		Provider:           provider,
		Model:              model,
		ModelType:          modelType,
		ResourceType:       "message",
		PromptTokens:       usage.PromptTokens,
		CompletionTokens:   usage.CompletionTokens,
		TotalTokens:        usage.TotalTokens,
		InputCostRMB:       cost.InputCost,
		OutputCostRMB:      cost.OutputCost,
		TotalCostRMB:       cost.TotalCost,
		Currency:           "RMB",
		Status:             status,
		PricingUnit:        "token_1k",
		UnitCount:          float64(usage.TotalTokens) / 1000.0,
		InputUnitPriceRMB:  inputPrice,
		OutputUnitPriceRMB: outputPrice,
		Estimated:          usage.Estimated,
		RawUsageJSON:       rawJSON,
		CreatedAt:          time.Now(),
	})
}

// RecordChatUsageWithResourceID 记录 Chat 用量（带 resource_id）。旧调用中 resourceID 历史上多为 conversation_id。
func (s *UsageService) RecordChatUsageWithResourceID(userID uint, guestID, provider, model, modelType string, resourceID uint, usage *TokenUsage) error {
	ctx := UsageContext{GuestID: guestID, ResourceType: "message", ResourceID: resourceID, ConversationID: resourceID, MessageID: resourceID}
	return s.RecordChatUsageWithContext(userID, provider, model, modelType, ctx, usage)
}

// RecordChatUsageWithContext 记录 Chat 用量（带对话/消息/任务上下文）。
func (s *UsageService) RecordChatUsageWithContext(userID uint, provider, model, modelType string, ctx UsageContext, usage *TokenUsage) error {
	if usage == nil {
		return nil
	}

	inputPrice, outputPrice := s.getChatPrice(provider)
	cost := models.CalculateTokenCost(usage.PromptTokens, usage.CompletionTokens, inputPrice, outputPrice)

	status := "success"
	if usage.Estimated {
		status = "estimated"
	}

	rawJSON := ""
	if usage.Raw != nil {
		b, _ := json.Marshal(usage.Raw)
		rawJSON = string(b)
	}

	resourceType := ctx.ResourceType
	if resourceType == "" {
		resourceType = "message"
	}
	resourceID := ctx.ResourceID
	if resourceID == 0 {
		resourceID = ctx.MessageID
	}
	if ctx.MessageID == 0 {
		ctx.MessageID = resourceID
	}

	return s.RecordUsage(&models.APIUsageLog{
		UserID:             userID,
		GuestID:            ctx.GuestID,
		Service:            "chat",
		Provider:           provider,
		Model:              model,
		ModelType:          modelType,
		ResourceType:       resourceType,
		ResourceID:         resourceID,
		ConversationID:     ctx.ConversationID,
		MessageID:          ctx.MessageID,
		TaskID:             ctx.TaskID,
		WorkspaceID:        ctx.WorkspaceID,
		NotebookID:         ctx.NotebookID,
		PromptTokens:       usage.PromptTokens,
		CompletionTokens:   usage.CompletionTokens,
		TotalTokens:        usage.TotalTokens,
		InputCostRMB:       cost.InputCost,
		OutputCostRMB:      cost.OutputCost,
		TotalCostRMB:       cost.TotalCost,
		Currency:           "RMB",
		Status:             status,
		PricingUnit:        "token_1k",
		UnitCount:          float64(usage.TotalTokens) / 1000.0,
		InputUnitPriceRMB:  inputPrice,
		OutputUnitPriceRMB: outputPrice,
		Estimated:          usage.Estimated,
		RawUsageJSON:       rawJSON,
		LatencyMs:          ctx.LatencyMs,
		RequestID:          ctx.RequestID,
		CreatedAt:          time.Now(),
	})
}

// GetGuestDailyChatCost 获取匿名用户今日 chat 请求的金额汇总
func (s *UsageService) GetGuestDailyChatCost(guestID string) (float64, error) {
	if models.DB == nil || guestID == "" {
		return 0, nil
	}
	var total float64
	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	err := models.DB.Model(&models.APIUsageLog{}).
		Where("guest_id = ? AND service = 'chat' AND created_at >= ?", guestID, startOfDay).
		Select("COALESCE(SUM(total_cost_rmb), 0)").
		Scan(&total).Error
	return total, err
}

// GetGuestDailyChatCount 获取匿名用户今日 chat 请求次数
func (s *UsageService) GetGuestDailyChatCount(guestID string) (int64, error) {
	if models.DB == nil || guestID == "" {
		return 0, nil
	}
	var count int64
	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	err := models.DB.Model(&models.APIUsageLog{}).
		Where("guest_id = ? AND service = 'chat' AND created_at >= ?", guestID, startOfDay).
		Count(&count).Error
	return count, err
}

// RecordImageUsage 记录图片生成用量
func (s *UsageService) RecordImageUsage(userID uint, model string, imageCount int, usage *TokenUsage) error {
	var promptTokens, completionTokens int
	if usage != nil {
		promptTokens = usage.PromptTokens
		completionTokens = usage.CompletionTokens
	}

	// 图片生成可能按图片张数计费或按 token 计费
	inputPrice := s.cfg.ImageGenInputPrice
	outputPrice := s.cfg.ImageGenOutputPrice
	unitPrice := s.cfg.ImageGenUnitPrice

	var totalCost float64
	var inputCost, outputCost float64

	if unitPrice > 0 {
		// 按张计费
		totalCost = models.CalculateImageCost(imageCount, unitPrice)
		// 同时也计算 token 费用，如果有
		if inputPrice > 0 || outputPrice > 0 {
			tokenCost := models.CalculateTokenCost(promptTokens, completionTokens, inputPrice, outputPrice)
			inputCost = tokenCost.InputCost
			outputCost = tokenCost.OutputCost
			totalCost += tokenCost.TotalCost
		}
	} else {
		// 按 token 计费
		tokenCost := models.CalculateTokenCost(promptTokens, completionTokens, inputPrice, outputPrice)
		inputCost = tokenCost.InputCost
		outputCost = tokenCost.OutputCost
		totalCost = tokenCost.TotalCost
	}

	status := "success"
	if imageCount == 0 {
		status = "failed"
	} else if usage != nil && usage.Estimated {
		status = "estimated"
	}

	estimated := false
	if imageCount == 0 {
		estimated = true
	} else if usage == nil {
		estimated = true
	} else if usage.Estimated {
		estimated = true
	}

	rawJSON := ""
	if usage != nil && usage.Raw != nil {
		b, _ := json.Marshal(usage.Raw)
		rawJSON = string(b)
	}

	return s.RecordUsage(&models.APIUsageLog{
		UserID:             userID,
		Service:            "image_generation",
		Provider:           "openai",
		Model:              model,
		ModelType:          "gpt",
		ResourceType:       "image_generation",
		PromptTokens:       promptTokens,
		CompletionTokens:   completionTokens,
		TotalTokens:        promptTokens + completionTokens,
		InputCostRMB:       inputCost,
		OutputCostRMB:      outputCost,
		TotalCostRMB:       totalCost,
		Currency:           "RMB",
		Status:             status,
		ImageCount:         imageCount,
		ImageUnitPrice:     unitPrice,
		ImageUnitPriceRMB:  unitPrice,
		PricingUnit:        "image",
		UnitCount:          float64(imageCount),
		InputUnitPriceRMB:  inputPrice,
		OutputUnitPriceRMB: outputPrice,
		Estimated:          estimated,
		RawUsageJSON:       rawJSON,
		CreatedAt:          time.Now(),
	})
}

// RecordPPTUsage 记录文档生成（PPT）用量
func (s *UsageService) RecordPPTUsage(userID uint, model string, resourceID uint, usage *TokenUsage) error {
	if usage == nil {
		return nil
	}

	inputPrice := s.cfg.DocGenInputPrice
	outputPrice := s.cfg.DocGenOutputPrice
	cost := models.CalculateTokenCost(usage.PromptTokens, usage.CompletionTokens, inputPrice, outputPrice)

	status := "success"
	if usage.Estimated {
		status = "estimated"
	}

	rawJSON := ""
	if usage.Raw != nil {
		b, _ := json.Marshal(usage.Raw)
		rawJSON = string(b)
	}

	return s.RecordUsage(&models.APIUsageLog{
		UserID:             userID,
		Service:            "document_generation",
		Provider:           "openai",
		Model:              model,
		ModelType:          "gpt",
		ResourceType:       "ppt_generation",
		ResourceID:         resourceID,
		PromptTokens:       usage.PromptTokens,
		CompletionTokens:   usage.CompletionTokens,
		TotalTokens:        usage.TotalTokens,
		InputCostRMB:       cost.InputCost,
		OutputCostRMB:      cost.OutputCost,
		TotalCostRMB:       cost.TotalCost,
		Currency:           "RMB",
		Status:             status,
		PricingUnit:        "token_1k",
		UnitCount:          float64(usage.TotalTokens) / 1000.0,
		InputUnitPriceRMB:  inputPrice,
		OutputUnitPriceRMB: outputPrice,
		Estimated:          usage.Estimated,
		RawUsageJSON:       rawJSON,
		CreatedAt:          time.Now(),
	})
}

// RecordVisionUsage 记录 Vision（图片解析）用量
func (s *UsageService) RecordVisionUsage(userID uint, guestID, model string, resourceID uint, usage *TokenUsage) error {
	if usage == nil {
		return nil
	}

	inputPrice := s.cfg.VisionInputPrice
	outputPrice := s.cfg.VisionOutputPrice
	cost := models.CalculateTokenCost(usage.PromptTokens, usage.CompletionTokens, inputPrice, outputPrice)

	status := "success"
	if usage.Estimated {
		status = "estimated"
	}

	rawJSON := ""
	if usage.Raw != nil {
		b, _ := json.Marshal(usage.Raw)
		rawJSON = string(b)
	}

	return s.RecordUsage(&models.APIUsageLog{
		UserID:             userID,
		GuestID:            guestID,
		Service:            "vision",
		Provider:           "openai",
		Model:              model,
		ModelType:          "gpt",
		ResourceType:       "file",
		ResourceID:         resourceID,
		PromptTokens:       usage.PromptTokens,
		CompletionTokens:   usage.CompletionTokens,
		TotalTokens:        usage.TotalTokens,
		InputCostRMB:       cost.InputCost,
		OutputCostRMB:      cost.OutputCost,
		TotalCostRMB:       cost.TotalCost,
		Currency:           "RMB",
		Status:             status,
		PricingUnit:        "token_1k",
		UnitCount:          float64(usage.TotalTokens) / 1000.0,
		InputUnitPriceRMB:  inputPrice,
		OutputUnitPriceRMB: outputPrice,
		Estimated:          usage.Estimated,
		RawUsageJSON:       rawJSON,
		CreatedAt:          time.Now(),
	})
}

// RecordEmbeddingUsage 记录 Embedding 用量
func (s *UsageService) RecordEmbeddingUsage(userID uint, model string, resourceID uint, inputTokens int) error {
	inputPrice := s.cfg.EmbeddingInputPrice
	cost := models.CalculateEmbeddingCost(inputTokens, inputPrice)

	totalTokens := inputTokens
	return s.RecordUsage(&models.APIUsageLog{
		UserID:            userID,
		Service:           "embedding",
		Provider:          "openai",
		Model:             model,
		ModelType:         "embedding",
		ResourceType:      "embedding_job",
		ResourceID:        resourceID,
		PromptTokens:      inputTokens,
		CompletionTokens:  0,
		TotalTokens:       totalTokens,
		InputCostRMB:      cost,
		OutputCostRMB:     0,
		TotalCostRMB:      cost,
		Currency:          "RMB",
		Status:            "success",
		PricingUnit:       "token_1k",
		UnitCount:         float64(totalTokens) / 1000.0,
		InputUnitPriceRMB: inputPrice,
		CreatedAt:         time.Now(),
	})
}

// getChatPrice 获取对话模型的价格
func (s *UsageService) getChatPrice(provider string) (inputPrice, outputPrice float64) {
	switch strings.ToLower(provider) {
	case "openai":
		return s.cfg.OpenAIInputPrice, s.cfg.OpenAIOutputPrice
	case "anthropic":
		return s.cfg.AnthropicInputPrice, s.cfg.AnthropicOutputPrice
	case "gemini":
		return s.cfg.GeminiInputPrice, s.cfg.GeminiOutputPrice
	case "deepseek":
		return s.cfg.DeepSeekInputPrice, s.cfg.DeepSeekOutputPrice
	case "moonshot":
		return s.cfg.MoonshotInputPrice, s.cfg.MoonshotOutputPrice
	default:
		return 0, 0
	}
}

// GetUsageByUser 查询用户的 API 用量统计
func (s *UsageService) GetUsageByUser(userID uint, startTime, endTime time.Time) ([]models.APIUsageLog, error) {
	var logs []models.APIUsageLog
	err := models.DB.Where("user_id = ? AND created_at BETWEEN ? AND ?", userID, startTime, endTime).
		Order("created_at DESC").Find(&logs).Error
	return logs, err
}

// GetUserTotalCost 获取用户总费用
func (s *UsageService) GetUserTotalCost(userID uint) (float64, error) {
	var total float64
	err := models.DB.Model(&models.APIUsageLog{}).
		Where("user_id = ?", userID).
		Select("COALESCE(SUM(total_cost_rmb), 0)").
		Scan(&total).Error
	return total, err
}

// GetServiceCostBreakdown 获取用户各服务的费用拆分
func (s *UsageService) GetServiceCostBreakdown(userID uint) (map[string]float64, error) {
	var results []struct {
		Service   string
		TotalCost float64
	}
	err := models.DB.Model(&models.APIUsageLog{}).
		Where("user_id = ?", userID).
		Select("service, COALESCE(SUM(total_cost_rmb), 0) as total_cost").
		Group("service").
		Scan(&results).Error
	if err != nil {
		return nil, err
	}

	breakdown := make(map[string]float64)
	for _, r := range results {
		breakdown[r.Service] = r.TotalCost
	}
	return breakdown, nil
}

// TokenUsage 统一 token 使用量结构体
// 用于各 provider 解析后的统一输出格式
type TokenUsage struct {
	PromptTokens     int            `json:"prompt_tokens"`     // 输入 token 数
	CompletionTokens int            `json:"completion_tokens"` // 输出 token 数
	TotalTokens      int            `json:"total_tokens"`      // 总 token 数
	Raw              map[string]any `json:"raw"`               // API 原始返回的 usage 数据
	Estimated        bool           `json:"estimated"`         // 是否为估算值
}

// ParseOpenAIUsage 解析 OpenAI Chat Completions / Responses API 的 usage 字段
func ParseOpenAIUsage(raw map[string]any) *TokenUsage {
	if raw == nil {
		return nil
	}

	promptTokens := 0
	completionTokens := 0
	totalTokens := 0

	if v, ok := raw["prompt_tokens"].(float64); ok {
		promptTokens = int(v)
	} else if v, ok := raw["prompt_tokens"].(int); ok {
		promptTokens = v
	}
	if v, ok := raw["completion_tokens"].(float64); ok {
		completionTokens = int(v)
	} else if v, ok := raw["completion_tokens"].(int); ok {
		completionTokens = v
	}
	if v, ok := raw["total_tokens"].(float64); ok {
		totalTokens = int(v)
	} else if v, ok := raw["total_tokens"].(int); ok {
		totalTokens = v
	}

	if totalTokens == 0 {
		totalTokens = promptTokens + completionTokens
	}

	return &TokenUsage{
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      totalTokens,
		Raw:              raw,
	}
}

// ParseAnthropicUsage 解析 Anthropic Messages API 的 usage 字段
func ParseAnthropicUsage(raw map[string]any) *TokenUsage {
	if raw == nil {
		return nil
	}

	promptTokens := 0
	completionTokens := 0
	totalTokens := 0

	if v, ok := raw["input_tokens"].(float64); ok {
		promptTokens = int(v)
	} else if v, ok := raw["input_tokens"].(int); ok {
		promptTokens = v
	}
	if v, ok := raw["output_tokens"].(float64); ok {
		completionTokens = int(v)
	} else if v, ok := raw["output_tokens"].(int); ok {
		completionTokens = v
	}

	// Anthropic 有时也返回 total_tokens
	if v, ok := raw["total_tokens"].(float64); ok {
		totalTokens = int(v)
	} else if v, ok := raw["total_tokens"].(int); ok {
		totalTokens = v
	}

	if totalTokens == 0 {
		totalTokens = promptTokens + completionTokens
	}

	return &TokenUsage{
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      totalTokens,
		Raw:              raw,
	}
}

// ExtractUsageFromEvent 从流式事件中提取 usage 信息
// 支持格式: OpenAI streaming chunks 中的 usage 字段
func ExtractUsageFromEvent(event map[string]any) *TokenUsage {
	if event == nil {
		return nil
	}

	// OpenAI streaming usage 通常在响应的 usage 字段中
	if usageRaw, ok := event["usage"].(map[string]any); ok {
		return ParseOpenAIUsage(usageRaw)
	}

	// Anthropic 流式中的事件类型
	// message_delta 事件可能包含 usage
	if usageRaw, ok := event["usage"].(map[string]any); ok {
		return ParseAnthropicUsage(usageRaw)
	}

	return nil
}

// EstimateTokens 用 tiktoken 估算文本的 token 数
// 这是一个简单的估算：每个汉字约 2 token，每个英文单词约 1.3 token
// 生产环境建议使用 github.com/pkoukk/tiktoken-go 库
func EstimateTokens(text string) int {
	tokenCount := 0
	for _, r := range text {
		if r > 127 {
			tokenCount += 2 // 非 ASCII 字符大约 2-3 tokens
		} else if r == ' ' || r == '\n' || r == '	' {
			tokenCount++
		} else {
			tokenCount++
		}
	}
	// 优化：英文文本的实际 token 数比字符数略少
	// 但这个估算对中文比较准确
	return tokenCount
}

// FormatTokenCost 格式化 token 费用，保留 6 位小数
func FormatTokenCost(cost float64) float64 {
	return float64(int(cost*1e6)) / 1e6
}

// String 返回 TokenUsage 的字符串表示
func (u *TokenUsage) String() string {
	return fmt.Sprintf("TokenUsage(prompt=%d, completion=%d, total=%d, estimated=%v)",
		u.PromptTokens, u.CompletionTokens, u.TotalTokens, u.Estimated)
}
