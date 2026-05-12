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
	Capabilities []string `json:"capabilities"` // "chat" | "image"
}

var SupportedModels = []ModelInfo{
	// OpenAI
	{ID: "gpt-5.4", Name: "GPT 5.4", Provider: "OpenAI", Description: "旗舰通用模型，综合能力强", Color: "#10a37f", Capabilities: []string{"chat"}},
	{ID: "gpt-5.4-mini", Name: "GPT 5.4 Mini", Provider: "OpenAI", Description: "快速、经济，日常任务首选", Color: "#10a37f", Capabilities: []string{"chat"}},
	{ID: "gpt-5.5", Name: "GPT 5.5", Provider: "OpenAI", Description: "第五代增强版，更强推理能力", Color: "#10a37f", Capabilities: []string{"chat"}},
	{ID: "gpt-5.5-pro", Name: "GPT 5.5 Pro", Provider: "OpenAI", Description: "旗舰级专业模型，最强的多模态能力", Color: "#10a37f", Capabilities: []string{"chat"}},
	{ID: "gpt-image-2", Name: "GPT Image 2", Provider: "OpenAI", Description: "原生多模态模型，可对话也可生成图片", Color: "#10a37f", Capabilities: []string{"chat", "image"}},
	// Anthropic
	{ID: "claude-3-5-sonnet-20241022", Name: "Claude 3.5 Sonnet", Provider: "Anthropic", Description: "代码和逻辑推理专家", Color: "#cc785c", Capabilities: []string{"chat"}},
	// Google
	{ID: "gemini-2.0-flash-exp", Name: "Gemini 2.0 Flash", Provider: "Google", Description: "超快响应速度", Color: "#4285f4", Capabilities: []string{"chat"}},
	// DeepSeek
	{ID: "deepseek-v4-pro", Name: "DeepSeek-V4 Pro", Provider: "DeepSeek", Description: "V4 Pro 增强版，最强推理能力", Color: "#4d6bfa", Capabilities: []string{"chat"}},
	{ID: "deepseek-reasoner", Name: "DeepSeek-R1", Provider: "DeepSeek", Description: "深度思考模型，展示完整推理过程", Color: "#8b5cf6", Capabilities: []string{"chat"}},
	{ID: "deepseek-v4-flash", Name: "DeepSeek-V4 Flash", Provider: "DeepSeek", Description: "V4 轻量版，极速响应", Color: "#6366f1", Capabilities: []string{"chat"}},
	// Moonshot
	{ID: "moonshot-v1-8k", Name: "Kimi k1.5", Provider: "Moonshot", Description: "超长上下文，文档处理专家", Color: "#00b96b", Capabilities: []string{"chat"}},
}

// ChatModels 返回支持对话的模型
func ChatModels() []ModelInfo {
	var result []ModelInfo
	for _, m := range SupportedModels {
		for _, c := range m.Capabilities {
			if c == "chat" {
				result = append(result, m)
				break
			}
		}
	}
	return result
}

// ImageModels 返回支持画图的模型
func ImageModels() []ModelInfo {
	var result []ModelInfo
	for _, m := range SupportedModels {
		for _, c := range m.Capabilities {
			if c == "image" {
				result = append(result, m)
				break
			}
		}
	}
	return result
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
