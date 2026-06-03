package services

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
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
	Module         string
	Feature        string
	Operation      string
}

func NewUsageService(cfg *config.Config) *UsageService {
	return &UsageService{cfg: cfg}
}

func applyProductContext(log *models.APIUsageLog, ctx UsageContext, fallbackModule, fallbackFeature, fallbackOperation string) {
	if log == nil {
		return
	}
	log.Module = strings.TrimSpace(ctx.Module)
	if log.Module == "" {
		log.Module = fallbackModule
	}
	log.Feature = strings.TrimSpace(ctx.Feature)
	if log.Feature == "" {
		log.Feature = fallbackFeature
	}
	log.Operation = strings.TrimSpace(ctx.Operation)
	if log.Operation == "" {
		log.Operation = fallbackOperation
	}
}

func defaultChatProductContext(ctx UsageContext) (string, string, string) {
	if ctx.Module != "" || ctx.Feature != "" || ctx.Operation != "" {
		return "chat", "chat", "chat_completion"
	}
	if ctx.WorkspaceID > 0 {
		return "workspace", "chat", "workspace_chat_completion"
	}
	if ctx.NotebookID > 0 {
		return "work", "notebook", "notebook_chat_completion"
	}
	return "chat", "chat", "chat_completion"
}

// RecordUsage 通用记录 usage 方法
func (s *UsageService) RecordUsage(usage *models.APIUsageLog) error {
	if usage != nil {
		s.attachOriginalPriceSnapshot(usage)
	}
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

	price := s.getTokenPrice(provider, model)
	cost := models.CalculateTokenCost(usage.PromptTokens, usage.CompletionTokens, price.InputPriceRMB, price.OutputPriceRMB)

	status := "success"
	if usage.Estimated {
		status = "estimated"
	}

	rawJSON := ""
	if usage.Raw != nil {
		b, _ := json.Marshal(usage.Raw)
		rawJSON = string(b)
	}

	log := &models.APIUsageLog{
		UserID:             userID,
		Service:            "chat",
		Module:             "chat",
		Feature:            "chat",
		Operation:          "chat_completion",
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
		PricingUnit:        price.PricingUnit,
		UnitCount:          float64(usage.TotalTokens) / 1000.0,
		InputUnitPriceRMB:  price.InputPriceRMB,
		OutputUnitPriceRMB: price.OutputPriceRMB,
		Estimated:          usage.Estimated,
		RawUsageJSON:       rawJSON,
		CreatedAt:          time.Now(),
	}
	applyPriceSnapshot(log, price)
	return s.RecordUsage(log)
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

	price := s.getTokenPrice(provider, model)
	cost := models.CalculateTokenCost(usage.PromptTokens, usage.CompletionTokens, price.InputPriceRMB, price.OutputPriceRMB)

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

	log := &models.APIUsageLog{
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
		PricingUnit:        price.PricingUnit,
		UnitCount:          float64(usage.TotalTokens) / 1000.0,
		InputUnitPriceRMB:  price.InputPriceRMB,
		OutputUnitPriceRMB: price.OutputPriceRMB,
		Estimated:          usage.Estimated,
		RawUsageJSON:       rawJSON,
		LatencyMs:          ctx.LatencyMs,
		RequestID:          ctx.RequestID,
		CreatedAt:          time.Now(),
	}
	module, feature, operation := defaultChatProductContext(ctx)
	applyProductContext(log, ctx, module, feature, operation)
	applyPriceSnapshot(log, price)
	return s.RecordUsage(log)
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
	return s.RecordImageUsageWithContext(userID, model, imageCount, UsageContext{}, usage)
}

// RecordImageUsageWithContext 记录图片生成/编辑用量（带产品与业务上下文）。
func (s *UsageService) RecordImageUsageWithContext(userID uint, model string, imageCount int, ctx UsageContext, usage *TokenUsage) error {
	var promptTokens, completionTokens int
	if usage != nil {
		promptTokens = usage.PromptTokens
		completionTokens = usage.CompletionTokens
	}

	// 图片生成可能按图片张数计费或按 token 计费。模型级价格优先，provider 配置兜底。
	price := s.getImagePrice("openai", model)
	inputPrice := price.InputPriceRMB
	outputPrice := price.OutputPriceRMB
	unitPrice := price.ImageUnitPrice

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

	unitCount := float64(imageCount)
	if unitPrice <= 0 && (inputPrice > 0 || outputPrice > 0) {
		unitCount = float64(promptTokens+completionTokens) / 1000.0
	}

	log := &models.APIUsageLog{
		UserID:             userID,
		GuestID:            ctx.GuestID,
		Service:            "image_generation",
		Provider:           "openai",
		Model:              model,
		ModelType:          "gpt",
		ResourceType:       "image_generation",
		ResourceID:         ctx.ResourceID,
		ConversationID:     ctx.ConversationID,
		MessageID:          ctx.MessageID,
		TaskID:             ctx.TaskID,
		WorkspaceID:        ctx.WorkspaceID,
		NotebookID:         ctx.NotebookID,
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
		PricingUnit:        price.PricingUnit,
		UnitCount:          unitCount,
		InputUnitPriceRMB:  inputPrice,
		OutputUnitPriceRMB: outputPrice,
		Estimated:          estimated,
		RawUsageJSON:       rawJSON,
		LatencyMs:          ctx.LatencyMs,
		RequestID:          ctx.RequestID,
		CreatedAt:          time.Now(),
	}
	if ctx.ResourceType != "" {
		log.ResourceType = ctx.ResourceType
	}
	service := strings.TrimSpace(log.Service)
	operation := strings.TrimSpace(ctx.Operation)
	if operation == "" {
		operation = "text_to_image"
	}
	if operation == "image_edit" || operation == "inpaint" || operation == "region_brush" || operation == "replace_bg" {
		service = "image_edit"
	}
	log.Service = service
	applyProductContext(log, ctx, "creative", "image", operation)
	applyPriceSnapshot(log, price)
	return s.RecordUsage(log)
}

// RecordPPTUsage 记录文档生成（PPT）用量
func (s *UsageService) RecordPPTUsage(userID uint, model string, resourceID uint, usage *TokenUsage) error {
	return s.RecordPPTUsageWithContext(userID, model, resourceID, UsageContext{}, usage)
}

// RecordPPTUsageWithContext 记录文档生成（PPT）用量（带产品与业务上下文）。
func (s *UsageService) RecordPPTUsageWithContext(userID uint, model string, resourceID uint, ctx UsageContext, usage *TokenUsage) error {
	if usage == nil {
		return nil
	}

	price := s.getTokenPriceWithFallback("openai", model, s.cfg.DocGenInputPrice, s.cfg.DocGenOutputPrice)
	cost := models.CalculateTokenCost(usage.PromptTokens, usage.CompletionTokens, price.InputPriceRMB, price.OutputPriceRMB)

	status := "success"
	if usage.Estimated {
		status = "estimated"
	}

	rawJSON := ""
	if usage.Raw != nil {
		b, _ := json.Marshal(usage.Raw)
		rawJSON = string(b)
	}

	log := &models.APIUsageLog{
		UserID:             userID,
		GuestID:            ctx.GuestID,
		Service:            "document_generation",
		Provider:           "openai",
		Model:              model,
		ModelType:          "gpt",
		ResourceType:       "ppt_generation",
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
		PricingUnit:        price.PricingUnit,
		UnitCount:          float64(usage.TotalTokens) / 1000.0,
		InputUnitPriceRMB:  price.InputPriceRMB,
		OutputUnitPriceRMB: price.OutputPriceRMB,
		Estimated:          usage.Estimated,
		RawUsageJSON:       rawJSON,
		LatencyMs:          ctx.LatencyMs,
		RequestID:          ctx.RequestID,
		CreatedAt:          time.Now(),
	}
	if ctx.ResourceType != "" {
		log.ResourceType = ctx.ResourceType
	}
	if ctx.ResourceID > 0 {
		log.ResourceID = ctx.ResourceID
	}
	applyProductContext(log, ctx, "work", "ppt", "ppt_generation")
	applyPriceSnapshot(log, price)
	return s.RecordUsage(log)
}

// RecordVisionUsage 记录 Vision（图片解析）用量
func (s *UsageService) RecordVisionUsage(userID uint, guestID, model string, resourceID uint, usage *TokenUsage) error {
	return s.RecordVisionUsageWithContext(userID, model, resourceID, UsageContext{GuestID: guestID}, usage)
}

// RecordVisionUsageWithContext 记录 Vision 用量（带产品与业务上下文）。
func (s *UsageService) RecordVisionUsageWithContext(userID uint, model string, resourceID uint, ctx UsageContext, usage *TokenUsage) error {
	if usage == nil {
		return nil
	}

	price := s.getTokenPriceWithFallback("openai", model, s.cfg.VisionInputPrice, s.cfg.VisionOutputPrice)
	cost := models.CalculateTokenCost(usage.PromptTokens, usage.CompletionTokens, price.InputPriceRMB, price.OutputPriceRMB)

	status := "success"
	if usage.Estimated {
		status = "estimated"
	}

	rawJSON := ""
	if usage.Raw != nil {
		b, _ := json.Marshal(usage.Raw)
		rawJSON = string(b)
	}

	log := &models.APIUsageLog{
		UserID:             userID,
		GuestID:            ctx.GuestID,
		Service:            "vision",
		Provider:           "openai",
		Model:              model,
		ModelType:          "gpt",
		ResourceType:       "file",
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
		PricingUnit:        price.PricingUnit,
		UnitCount:          float64(usage.TotalTokens) / 1000.0,
		InputUnitPriceRMB:  price.InputPriceRMB,
		OutputUnitPriceRMB: price.OutputPriceRMB,
		Estimated:          usage.Estimated,
		RawUsageJSON:       rawJSON,
		LatencyMs:          ctx.LatencyMs,
		RequestID:          ctx.RequestID,
		CreatedAt:          time.Now(),
	}
	if ctx.ResourceType != "" {
		log.ResourceType = ctx.ResourceType
	}
	if ctx.ResourceID > 0 {
		log.ResourceID = ctx.ResourceID
	}
	applyProductContext(log, ctx, "work", "document_reader", "file_vision_parse")
	applyPriceSnapshot(log, price)
	return s.RecordUsage(log)
}

// RecordEmbeddingUsage 记录 Embedding 用量
func (s *UsageService) RecordEmbeddingUsage(userID uint, model string, resourceID uint, inputTokens int) error {
	return s.RecordEmbeddingUsageWithContext(userID, model, resourceID, inputTokens, UsageContext{})
}

// RecordEmbeddingUsageWithContext 记录 Embedding 用量（带产品与业务上下文）。
func (s *UsageService) RecordEmbeddingUsageWithContext(userID uint, model string, resourceID uint, inputTokens int, ctx UsageContext) error {
	price := s.getTokenPriceWithFallback("openai", model, s.cfg.EmbeddingInputPrice, 0)
	cost := models.CalculateEmbeddingCost(inputTokens, price.InputPriceRMB)

	totalTokens := inputTokens
	log := &models.APIUsageLog{
		UserID:            userID,
		GuestID:           ctx.GuestID,
		Service:           "embedding",
		Provider:          "openai",
		Model:             model,
		ModelType:         "embedding",
		ResourceType:      "embedding_job",
		ResourceID:        resourceID,
		ConversationID:    ctx.ConversationID,
		MessageID:         ctx.MessageID,
		TaskID:            ctx.TaskID,
		WorkspaceID:       ctx.WorkspaceID,
		NotebookID:        ctx.NotebookID,
		PromptTokens:      inputTokens,
		CompletionTokens:  0,
		TotalTokens:       totalTokens,
		InputCostRMB:      cost,
		OutputCostRMB:     0,
		TotalCostRMB:      cost,
		Currency:          "RMB",
		Status:            "success",
		PricingUnit:       price.PricingUnit,
		UnitCount:         float64(totalTokens) / 1000.0,
		InputUnitPriceRMB: price.InputPriceRMB,
		LatencyMs:         ctx.LatencyMs,
		RequestID:         ctx.RequestID,
		CreatedAt:         time.Now(),
	}
	if ctx.ResourceType != "" {
		log.ResourceType = ctx.ResourceType
	}
	if ctx.ResourceID > 0 {
		log.ResourceID = ctx.ResourceID
	}
	applyProductContext(log, ctx, "work", "document_reader", "file_embedding")
	applyPriceSnapshot(log, price)
	return s.RecordUsage(log)
}

// TranslationUsageInput contains character-based usage for dedicated translation APIs.
type TranslationUsageInput struct {
	UserID             uint
	GuestID            string
	Provider           string
	Model              string
	SourceLanguage     string
	TargetLanguage     string
	InputCharacters    int
	OutputCharacters   int
	DetectedSourceLang string
	LatencyMs          int
	RequestID          string
	Raw                map[string]any
}

// RecordTranslationUsage records Google Cloud Translation usage. Google Translate is billed by
// characters, not tokens: NMT charges source text characters; Translation LLM charges input and output characters.
func (s *UsageService) RecordTranslationUsage(input TranslationUsageInput) error {
	provider := strings.TrimSpace(input.Provider)
	if provider == "" {
		provider = "google-cloud-translate-v3"
	}
	model := normalizeTranslationUsageModel(input.Model)
	if model == "" {
		model = "general/nmt"
	}
	price := s.getCharacterPrice(provider, model)
	inputChars := maxInt(input.InputCharacters, 0)
	outputChars := maxInt(input.OutputCharacters, 0)
	inputCost := float64(inputChars) * price.InputPriceRMB / 1_000_000.0
	outputCost := 0.0
	if price.OutputPriceRMB > 0 {
		outputCost = float64(outputChars) * price.OutputPriceRMB / 1_000_000.0
	}

	raw := map[string]any{
		"source_language":          input.SourceLanguage,
		"target_language":          input.TargetLanguage,
		"detected_source_language": input.DetectedSourceLang,
		"input_characters":         inputChars,
		"output_characters":        outputChars,
	}
	for k, v := range input.Raw {
		raw[k] = v
	}
	rawJSON := ""
	if b, err := json.Marshal(raw); err == nil {
		rawJSON = string(b)
	}

	log := &models.APIUsageLog{
		UserID:             input.UserID,
		GuestID:            input.GuestID,
		Service:            "translation",
		Provider:           strings.ToLower(provider),
		Model:              strings.ToLower(model),
		ModelType:          "translation",
		Module:             "work",
		Feature:            "translator",
		Operation:          "translate_text",
		CharacterCount:     inputChars,
		InputCostRMB:       inputCost,
		OutputCostRMB:      outputCost,
		TotalCostRMB:       inputCost + outputCost,
		Currency:           "RMB",
		Status:             "success",
		PricingUnit:        price.PricingUnit,
		UnitCount:          float64(inputChars) / 1_000_000.0,
		InputUnitPriceRMB:  price.InputPriceRMB,
		OutputUnitPriceRMB: price.OutputPriceRMB,
		LatencyMs:          input.LatencyMs,
		RequestID:          input.RequestID,
		RawUsageJSON:       rawJSON,
		CreatedAt:          time.Now(),
	}
	applyPriceSnapshot(log, price)
	return s.RecordUsage(log)
}

// VideoUsageInput contains the dimensions needed to price a completed video generation task.
type VideoUsageInput struct {
	UserID              uint
	GuestID             string
	Model               string
	ResourceID          uint
	ChatID              uint
	MessageID           uint
	TaskID              string
	DurationSeconds     int
	Resolution          string
	ReferenceVideoCount int
	CompletionTokens    int
	Estimated           bool
	Raw                 map[string]any
}

// RecordVideoUsage records Volcengine Seedance video usage. Seedance 2.0/2.0 Fast are billed by
// usage.completion_tokens and official per-1M-token prices, not by request count or fixed seconds.
func (s *UsageService) RecordVideoUsage(input VideoUsageInput) error {
	if input.Model == "" {
		return nil
	}
	if models.DB != nil {
		query := models.DB.Model(&models.APIUsageLog{}).Where("service = ?", "video_generation")
		if input.ResourceID > 0 {
			query = query.Where("resource_type = ? AND resource_id = ?", "video_generation", input.ResourceID)
		} else if input.TaskID != "" {
			query = query.Where("request_id = ?", input.TaskID)
		}
		var existing int64
		if err := query.Count(&existing).Error; err == nil && existing > 0 {
			return nil
		}
	}

	price := s.getVideoPrice("volcengine", input.Model, input.Resolution, input.ReferenceVideoCount > 0)
	completionTokens := input.CompletionTokens
	totalTokens := completionTokens
	outputCost := float64(completionTokens) * price.OutputPriceRMB / 1000.0
	status := "success"
	if completionTokens <= 0 {
		status = "missing_usage"
		input.Estimated = true
		outputCost = 0
	}

	raw := map[string]any{}
	for k, v := range input.Raw {
		raw[k] = v
	}
	if len(raw) == 0 {
		raw["completion_tokens"] = completionTokens
	}
	raw["resolution"] = input.Resolution
	raw["reference_video_count"] = input.ReferenceVideoCount
	raw["duration_seconds"] = input.DurationSeconds
	rawJSON := ""
	if b, err := json.Marshal(raw); err == nil {
		rawJSON = string(b)
	}

	log := &models.APIUsageLog{
		UserID:             input.UserID,
		GuestID:            input.GuestID,
		Service:            "video_generation",
		Module:             "creative",
		Feature:            "video",
		Operation:          "video_generation",
		Provider:           "volcengine",
		Model:              input.Model,
		ModelType:          "video",
		ResourceType:       "video_generation",
		ResourceID:         input.ResourceID,
		ConversationID:     input.ChatID,
		MessageID:          input.MessageID,
		PromptTokens:       0,
		CompletionTokens:   completionTokens,
		TotalTokens:        totalTokens,
		VideoSeconds:       input.DurationSeconds,
		InputCostRMB:       0,
		OutputCostRMB:      outputCost,
		TotalCostRMB:       outputCost,
		Currency:           "RMB",
		Status:             status,
		PricingUnit:        price.PricingUnit,
		UnitCount:          float64(totalTokens) / 1000.0,
		InputUnitPriceRMB:  0,
		OutputUnitPriceRMB: price.OutputPriceRMB,
		Estimated:          input.Estimated,
		RawUsageJSON:       rawJSON,
		RequestID:          input.TaskID,
		CreatedAt:          time.Now(),
	}
	applyPriceSnapshot(log, price)
	return s.RecordUsage(log)
}

// getTokenPrice 获取 token 型模型价格：模型级价格优先，provider 级价格兜底。
func (s *UsageService) getTokenPrice(provider, model string) config.ModelPrice {
	fallbackInput, fallbackOutput := s.getProviderChatPrice(provider)
	return s.getTokenPriceWithFallback(provider, model, fallbackInput, fallbackOutput)
}

func (s *UsageService) getTokenPriceWithFallback(provider, model string, fallbackInput, fallbackOutput float64) config.ModelPrice {
	if price, ok := s.getModelPrice(provider, model); ok && hasTokenPrice(price) {
		if price.PricingUnit == "" {
			price.PricingUnit = "token_1k"
		}
		return resolveModelPrice(price)
	}
	return config.ModelPrice{Provider: strings.ToLower(provider), Model: strings.ToLower(model), PricingUnit: "token_1k", InputPriceRMB: fallbackInput, OutputPriceRMB: fallbackOutput, SourceCurrency: "CNY", SourceUnit: "per_1k_tokens", SourceInputPrice: fallbackInput, SourceOutputPrice: fallbackOutput, ExchangeRateToRMB: 1}
}

func (s *UsageService) getImagePrice(provider, model string) config.ModelPrice {
	if price, ok := s.getModelPrice(provider, model); ok && hasImagePrice(price) {
		if price.PricingUnit == "" {
			if price.SourceImagePrice > 0 || price.ImageUnitPrice > 0 {
				price.PricingUnit = "image"
			} else {
				price.PricingUnit = "token_1k"
			}
		}
		return resolveModelPrice(price)
	}
	unit := "image"
	if s.cfg.ImageGenUnitPrice <= 0 && (s.cfg.ImageGenInputPrice > 0 || s.cfg.ImageGenOutputPrice > 0) {
		unit = "token_1k"
	}
	return config.ModelPrice{Provider: strings.ToLower(provider), Model: strings.ToLower(model), PricingUnit: unit, InputPriceRMB: s.cfg.ImageGenInputPrice, OutputPriceRMB: s.cfg.ImageGenOutputPrice, ImageUnitPrice: s.cfg.ImageGenUnitPrice, SourceCurrency: "CNY", SourceUnit: "per_1k_tokens", SourceInputPrice: s.cfg.ImageGenInputPrice, SourceOutputPrice: s.cfg.ImageGenOutputPrice, SourceImagePrice: s.cfg.ImageGenUnitPrice, ExchangeRateToRMB: 1}
}

func (s *UsageService) getVideoPrice(provider, model, resolution string, inputContainsVideo bool) config.ModelPrice {
	if price, ok := s.getModelPrice(provider, model); ok {
		if selected, matched := selectVideoPricingRule(price, resolution, inputContainsVideo); matched {
			price.SourceOutputPrice = selected.SourceOutputPrice
			if selected.PricingBasis != "" {
				price.PricingBasis = selected.PricingBasis
			}
		}
		if price.PricingUnit == "" {
			price.PricingUnit = "token_1k"
		}
		return resolveModelPrice(price)
	}
	return config.ModelPrice{Provider: strings.ToLower(provider), Model: strings.ToLower(model), PricingUnit: "request", RequestUnitPrice: s.cfg.VideoGenUnitPrice, SourceCurrency: "CNY", SourceUnit: "per_request", SourceRequestPrice: s.cfg.VideoGenUnitPrice, ExchangeRateToRMB: 1}
}

func (s *UsageService) getCharacterPrice(provider, model string) config.ModelPrice {
	if price, ok := s.getModelPrice(provider, model); ok && hasCharacterPrice(price) {
		if price.PricingUnit == "" {
			price.PricingUnit = "character_1m"
		}
		return resolveModelPrice(price)
	}
	return config.ModelPrice{Provider: strings.ToLower(provider), Model: strings.ToLower(model), PricingUnit: "character_1m", SourceCurrency: "CNY", SourceUnit: "per_1m_characters", ExchangeRateToRMB: 1}
}

func selectVideoPricingRule(price config.ModelPrice, resolution string, inputContainsVideo bool) (config.VideoPricingRule, bool) {
	resolution = strings.ToLower(strings.TrimSpace(resolution))
	if resolution == "" || resolution == "adaptive" {
		resolution = "720p"
	}
	var fallback config.VideoPricingRule
	fallbackSet := false
	for _, rule := range price.VideoPricingRules {
		ruleResolution := strings.ToLower(strings.TrimSpace(rule.Resolution))
		resolutionMatches := ruleResolution == "" || ruleResolution == resolution
		if !resolutionMatches {
			continue
		}
		if rule.InputContainsVideo != nil && *rule.InputContainsVideo != inputContainsVideo {
			continue
		}
		if rule.InputContainsVideo != nil {
			return rule, true
		}
		if !fallbackSet {
			fallback = rule
			fallbackSet = true
		}
	}
	return fallback, fallbackSet
}

func applyPriceSnapshot(log *models.APIUsageLog, price config.ModelPrice) {
	if log == nil {
		return
	}
	log.SourceCurrency = price.SourceCurrency
	log.SourceUnit = price.SourceUnit
	log.SourceInputPrice = price.SourceInputPrice
	log.SourceInputCacheHitPrice = price.SourceInputCacheHitPrice
	log.SourceInputCacheMissPrice = price.SourceInputCacheMissPrice
	log.SourceOutputPrice = price.SourceOutputPrice
	log.SourceImagePrice = price.SourceImagePrice
	log.SourceRequestPrice = price.SourceRequestPrice
	log.ExchangeRateToRMB = price.ExchangeRateToRMB
}

func hasTokenPrice(price config.ModelPrice) bool {
	return price.InputPriceRMB > 0 || price.OutputPriceRMB > 0 || price.SourceInputPrice > 0 || price.SourceInputCacheMissPrice > 0 || price.SourceOutputPrice > 0
}

func hasImagePrice(price config.ModelPrice) bool {
	return hasTokenPrice(price) || price.ImageUnitPrice > 0 || price.SourceImagePrice > 0
}

func hasCharacterPrice(price config.ModelPrice) bool {
	return price.PricingUnit == "character_1m" || strings.Contains(strings.ToLower(price.SourceUnit), "character")
}

func resolveModelPrice(price config.ModelPrice) config.ModelPrice {
	rate := exchangeRateToRMB(price.SourceCurrency)
	if rate <= 0 {
		return price
	}
	price.ExchangeRateToRMB = rate
	if price.SourceCurrency == "" && (price.InputPriceRMB > 0 || price.OutputPriceRMB > 0 || price.ImageUnitPrice > 0 || price.RequestUnitPrice > 0) {
		price.SourceCurrency = "CNY"
	}
	inputSource := price.SourceInputPrice
	if price.SourceInputCacheMissPrice > 0 {
		inputSource = price.SourceInputCacheMissPrice
	}
	if inputSource > 0 {
		price.InputPriceRMB = convertSourceUnitToRMB(price.SourceUnit, inputSource, rate)
	}
	if price.SourceOutputPrice > 0 {
		price.OutputPriceRMB = convertSourceUnitToRMB(price.SourceUnit, price.SourceOutputPrice, rate)
	}
	if price.SourceImagePrice > 0 {
		price.ImageUnitPrice = convertSourceUnitToRMB(price.SourceUnit, price.SourceImagePrice, rate)
	}
	if price.SourceRequestPrice > 0 {
		price.RequestUnitPrice = convertSourceUnitToRMB(price.SourceUnit, price.SourceRequestPrice, rate)
	}
	return price
}

func convertSourceUnitToRMB(sourceUnit string, price, rate float64) float64 {
	switch strings.ToLower(strings.TrimSpace(sourceUnit)) {
	case "per_1m_tokens":
		return price * rate / 1000.0
	case "per_1m_characters_source", "per_1m_characters_input_output", "per_1m_characters", "per_1m_chars":
		return price * rate
	case "per_1k_tokens", "per_image", "per_request", "per_video_second":
		return price * rate
	default:
		return price * rate
	}
}

func normalizeTranslationUsageModel(model string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return ""
	}
	if idx := strings.LastIndex(model, "/models/"); idx >= 0 {
		return model[idx+len("/models/"):]
	}
	return model
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func exchangeRateToRMB(currency string) float64 {
	switch strings.ToUpper(strings.TrimSpace(currency)) {
	case "", "CNY", "RMB":
		return 1
	case "USD":
		return fetchUSDCNYRate()
	default:
		return 0
	}
}

func fetchUSDCNYRate() float64 {
	if override := strings.TrimSpace(os.Getenv("USD_CNY_RATE")); override != "" {
		if rate, err := strconv.ParseFloat(override, 64); err == nil && rate > 0 {
			return rate
		}
	}
	client := &http.Client{Timeout: 3 * time.Second}
	if rate := fetchUSDCNYRateFromFrankfurter(client); rate > 0 {
		return rate
	}
	if rate := fetchUSDCNYRateFromOpenExchange(client); rate > 0 {
		return rate
	}
	if fallback := strings.TrimSpace(os.Getenv("USD_CNY_FALLBACK")); fallback != "" {
		if rate, err := strconv.ParseFloat(fallback, 64); err == nil && rate > 0 {
			return rate
		}
	}
	return 0
}

func fetchUSDCNYRateFromFrankfurter(client *http.Client) float64 {
	req, err := http.NewRequest("GET", "https://api.frankfurter.app/latest?from=USD&to=CNY", nil)
	if err != nil {
		return 0
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	var payload struct {
		Rates map[string]float64 `json:"rates"`
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 && json.NewDecoder(resp.Body).Decode(&payload) == nil {
		return payload.Rates["CNY"]
	}
	return 0
}

func fetchUSDCNYRateFromOpenExchange(client *http.Client) float64 {
	req, err := http.NewRequest("GET", "https://open.er-api.com/v6/latest/USD", nil)
	if err != nil {
		return 0
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	var payload struct {
		Result string             `json:"result"`
		Rates  map[string]float64 `json:"rates"`
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 && json.NewDecoder(resp.Body).Decode(&payload) == nil && payload.Result == "success" {
		return payload.Rates["CNY"]
	}
	return 0
}

func (s *UsageService) attachOriginalPriceSnapshot(usage *models.APIUsageLog) {
	if usage == nil || usage.SourceCurrency != "" {
		return
	}
	price, ok := s.getModelPrice(usage.Provider, usage.Model)
	if !ok {
		return
	}
	price = resolveModelPrice(price)
	usage.SourceCurrency = price.SourceCurrency
	usage.SourceUnit = price.SourceUnit
	usage.SourceInputPrice = price.SourceInputPrice
	usage.SourceInputCacheHitPrice = price.SourceInputCacheHitPrice
	usage.SourceInputCacheMissPrice = price.SourceInputCacheMissPrice
	usage.SourceOutputPrice = price.SourceOutputPrice
	usage.SourceImagePrice = price.SourceImagePrice
	usage.SourceRequestPrice = price.SourceRequestPrice
	usage.ExchangeRateToRMB = price.ExchangeRateToRMB
}

func (s *UsageService) getModelPrice(provider, model string) (config.ModelPrice, bool) {
	if s.cfg == nil || len(s.cfg.ModelPrices) == 0 {
		return config.ModelPrice{}, false
	}
	key := strings.ToLower(strings.TrimSpace(provider)) + ":" + strings.ToLower(strings.TrimSpace(model))
	price, ok := s.cfg.ModelPrices[key]
	return price, ok
}

func (s *UsageService) getProviderChatPrice(provider string) (inputPrice, outputPrice float64) {
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
