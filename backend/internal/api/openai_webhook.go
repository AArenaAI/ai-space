package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/webhooks"
	"gorm.io/gorm"
)

type OpenAIWebhookHandler struct {
	db           *gorm.DB
	cfg          *config.Config
	aiService    *services.AIService
	usageService *services.UsageService
}

func NewOpenAIWebhookHandler(db *gorm.DB, cfg *config.Config, aiService *services.AIService, usageService *services.UsageService) *OpenAIWebhookHandler {
	return &OpenAIWebhookHandler{db: db, cfg: cfg, aiService: aiService, usageService: usageService}
}

type openAIWebhookEvent struct {
	ID     string         `json:"id"`
	Object string         `json:"object"`
	Type   string         `json:"type"`
	Data   map[string]any `json:"data"`
}

func (h *OpenAIWebhookHandler) Handle(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "读取 webhook body 失败"})
		return
	}

	if err := h.verifySignature(c.Request.Header, body); err != nil {
		fmt.Printf("[OpenAI Webhook] 签名验证失败: %v\n", err)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
		return
	}

	var event openAIWebhookEvent
	if err := json.Unmarshal(body, &event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "解析 webhook event 失败"})
		return
	}

	responseID := extractResponseID(event.Data)
	fmt.Printf("[OpenAI Webhook] type=%s response_id=%s event_id=%s\n", event.Type, responseID, event.ID)
	if responseID == "" {
		c.JSON(http.StatusOK, gin.H{"ok": true, "ignored": "missing response id"})
		return
	}

	switch event.Type {
	case "response.completed":
		if err := h.handleCompleted(c.Request.Context(), responseID); err != nil {
			fmt.Printf("[OpenAI Webhook] completed 处理失败 response_id=%s: %v\n", responseID, err)
			// 返回 200，避免 OpenAI 因业务处理错误反复重试打爆；失败已落库。
		}
	case "response.failed", "response.cancelled", "response.incomplete":
		status := strings.TrimPrefix(event.Type, "response.")
		msg := extractEventError(event.Data)
		if err := h.markTaskFinished(responseID, status, "", msg, nil); err != nil {
			fmt.Printf("[OpenAI Webhook] 标记任务失败 response_id=%s status=%s: %v\n", responseID, status, err)
		}
	default:
		// 其他事件先忽略，保留日志即可。
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *OpenAIWebhookHandler) verifySignature(header http.Header, body []byte) error {
	secret := strings.TrimSpace(h.cfg.OpenAIWebhookSecret)
	if secret == "" {
		fmt.Printf("[OpenAI Webhook SDK] OPENAI_WEBHOOK_SECRET 未配置，跳过签名验证，仅用于本地调试\n")
		return nil
	}

	webhookService := webhooks.NewWebhookService(option.WithWebhookSecret(secret))
	return webhookService.VerifySignature(body, header)
}

func (h *OpenAIWebhookHandler) handleCompleted(ctx context.Context, responseID string) error {
	raw, err := h.aiService.RetrieveOpenAIResponse(ctx, responseID)
	if err != nil {
		_ = h.markTaskFinished(responseID, "failed", "", err.Error(), nil)
		return err
	}

	text := services.ExtractOpenAIResponseText(raw)
	usage := parseUsageFromResponse(raw)
	if strings.TrimSpace(text) == "" {
		text = "任务已完成，但未返回可展示文本。"
	}
	return h.markTaskFinished(responseID, "completed", text, "", usage)
}

func (h *OpenAIWebhookHandler) markTaskFinished(responseID, status, result, errorMessage string, usage *services.TokenUsage) error {
	now := time.Now()
	return h.db.Transaction(func(tx *gorm.DB) error {
		var task models.AIBackgroundTask
		if err := tx.Where("response_id = ?", responseID).First(&task).Error; err != nil {
			return err
		}

		updates := map[string]any{
			"status":        status,
			"result":        result,
			"error_message": errorMessage,
			"completed_at":  &now,
			"updated_at":    now,
		}
		if err := tx.Model(&task).Updates(updates).Error; err != nil {
			return err
		}

		if task.AssistantMessageID > 0 {
			content := result
			if content == "" && errorMessage != "" {
				content = "❌ 后台任务失败：" + errorMessage
			}
			if content != "" {
				if err := tx.Model(&models.Message{}).Where("id = ?", task.AssistantMessageID).Update("content", content).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(&models.Conversation{}).Where("id = ?", task.ConversationID).Update("updated_at", now).Error; err != nil {
				return err
			}
		}

		if h.usageService != nil && usage != nil && usage.TotalTokens > 0 {
			if err := h.usageService.RecordChatUsageWithResourceID(task.UserID, task.GuestID, "openai", task.Model, "openai_responses", task.ConversationID, usage); err != nil {
				fmt.Printf("[OpenAI Webhook] 记录 usage 失败 response_id=%s: %v\n", responseID, err)
			}
		}
		return nil
	})
}

func extractResponseID(data map[string]any) string {
	if data == nil {
		return ""
	}
	if id, ok := data["id"].(string); ok {
		return id
	}
	if response, ok := data["response"].(map[string]any); ok {
		if id, ok := response["id"].(string); ok {
			return id
		}
	}
	return ""
}

func extractEventError(data map[string]any) string {
	if data == nil {
		return ""
	}
	if errMap, ok := data["error"].(map[string]any); ok {
		if msg, ok := errMap["message"].(string); ok {
			return msg
		}
		if code, ok := errMap["code"].(string); ok {
			return code
		}
	}
	if msg, ok := data["message"].(string); ok {
		return msg
	}
	return ""
}

func parseUsageFromResponse(raw map[string]any) *services.TokenUsage {
	if raw == nil {
		return nil
	}
	usageRaw, ok := raw["usage"].(map[string]any)
	if !ok {
		return nil
	}
	usage := services.ParseOpenAIUsage(usageRaw)
	if usage != nil && usage.TotalTokens > 0 {
		return usage
	}
	return nil
}
