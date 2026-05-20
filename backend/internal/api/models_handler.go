package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type ModelInfo struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Provider     string   `json:"provider"`
	Description  string   `json:"description"`
	Color        string   `json:"color"`
	Capabilities []string `json:"capabilities"` // "chat" | "image" | "search"
}

var SupportedModels = []ModelInfo{
	// OpenAI
	{ID: "gpt-5.4", Name: "GPT 5.4", Provider: "OpenAI", Description: "旗舰通用模型，综合能力强", Color: "#10a37f", Capabilities: []string{"chat", "search", "reasoning"}},
	{ID: "gpt-5.4-mini", Name: "GPT 5.4 Mini", Provider: "OpenAI", Description: "快速、经济，日常任务首选", Color: "#10a37f", Capabilities: []string{"chat", "search", "reasoning"}},
	{ID: "gpt-5.5", Name: "GPT 5.5", Provider: "OpenAI", Description: "第五代增强版，更强推理能力", Color: "#10a37f", Capabilities: []string{"chat", "search", "reasoning"}},
	{ID: "gpt-5.5-pro", Name: "GPT 5.5 Pro", Provider: "OpenAI", Description: "旗舰级专业模型，最强的多模态能力", Color: "#10a37f", Capabilities: []string{"chat", "search", "reasoning"}},
	{ID: "gpt-image-2", Name: "GPT Image 2", Provider: "OpenAI", Description: "原生多模态模型，可生成图片", Color: "#10a37f", Capabilities: []string{"image"}},
	// Anthropic
	// {ID: "claude-3-5-sonnet-20241022", Name: "Claude 3.5 Sonnet", Provider: "Anthropic", Description: "代码和逻辑推理专家", Color: "#cc785c", Capabilities: []string{"chat"}},
	// Google
	{ID: "gemini-3.1-pro-preview", Name: "Gemini 3.1 Pro", Provider: "Google", Description: "新一代旗舰推理模型，更强多模态", Color: "#4285f4", Capabilities: []string{"chat", "reasoning", "search"}},
	{ID: "gemini-3.5-flash", Name: "Gemini 3.5 Flash", Provider: "Google", Description: "新一代高速模型，响应更快更稳", Color: "#4285f4", Capabilities: []string{"chat", "search"}},
	{ID: "gemini-3.1-flash-lite-preview", Name: "Gemini 3.1 Flash", Provider: "Google", Description: "新一代快速模型，日常问答首选", Color: "#4285f4", Capabilities: []string{"chat", "search"}},
	// DeepSeek
	{ID: "deepseek-v4-pro", Name: "DeepSeek-V4 Pro", Provider: "DeepSeek", Description: "V4 Pro 增强版，最强推理能力", Color: "#4d6bfa", Capabilities: []string{"chat"}},
	{ID: "deepseek-v4-flash", Name: "DeepSeek-V4 Flash", Provider: "DeepSeek", Description: "V4 轻量版，极速响应", Color: "#6366f1", Capabilities: []string{"chat"}},
	// Moonshot / Kimi
	{ID: "kimi-k2.5", Name: "Kimi K2.5", Provider: "Moonshot", Description: "旗舰多模态，支持图片理解+256K上下文", Color: "#00b96b", Capabilities: []string{"chat"}},
	{ID: "kimi-k2.6", Name: "Kimi K2.6", Provider: "Moonshot", Description: "最新旗舰版，更强多模态+推理能力", Color: "#00b96b", Capabilities: []string{"chat"}},
}

// ChatModels 返回支持对话的模型
func ChatModels() []ModelInfo {
	return ModelsByCapability("chat")
}

// ImageModels 返回支持画图的模型
func ImageModels() []ModelInfo {
	return ModelsByCapability("image")
}

// ModelsByCapability 返回支持指定能力的模型
func ModelsByCapability(capability string) []ModelInfo {
	var result []ModelInfo
	for _, m := range SupportedModels {
		if ModelHasCapability(m, capability) {
			result = append(result, m)
		}
	}
	return result
}

func ModelHasCapability(model ModelInfo, capability string) bool {
	for _, c := range model.Capabilities {
		if c == capability {
			return true
		}
	}
	return false
}

func FindModelInfo(modelID string) (ModelInfo, bool) {
	for _, m := range SupportedModels {
		if m.ID == modelID {
			return m, true
		}
	}
	return ModelInfo{}, false
}

func SupportsModelCapability(modelID string, capability string) bool {
	model, ok := FindModelInfo(modelID)
	if !ok {
		return false
	}
	return ModelHasCapability(model, capability)
}

func SupportsSearch(modelID string) bool {
	return SupportsModelCapability(modelID, "search")
}

func GetModelsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, SupportedModels)
}

func GetChatModelsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, ChatModels())
}

func GetImageModelsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, ImageModels())
}
