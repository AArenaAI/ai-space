package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ChatHandler struct {
	db            *gorm.DB
	cfg           *config.Config
	aiService     *services.AIService
	searchService *services.SearchService
}

func NewChatHandler(db *gorm.DB, cfg *config.Config, aiService *services.AIService, searchService *services.SearchService) *ChatHandler {
	return &ChatHandler{db: db, cfg: cfg, aiService: aiService, searchService: searchService}
}

type ChatRequest struct {
	Model            string   `json:"model" binding:"required"`
	Messages         []services.Message `json:"messages" binding:"required"`
	ConversationID   uint     `json:"conversation_id"`
	Stream           bool     `json:"stream"`
	Reasoning        bool     `json:"reasoning"`
	ReasoningEffort  string   `json:"reasoning_effort"`
	Search           bool     `json:"search"`
	TemplateID       uint     `json:"template_id,omitempty"`
	SkipSaveUserMsg  bool     `json:"skip_save_user_msg,omitempty"` // 对比模式后续模型调用不重复保存用户消息
}

type CompareRequest struct {
	Query            string   `json:"query" binding:"required"`
	ModelIDs         []string `json:"models" binding:"required,min=2,max=4"`
	TemplateID       uint     `json:"template_id,omitempty"`
	ConversationID   uint     `json:"conversation_id,omitempty"`
	Reasoning        bool     `json:"reasoning"`
	ReasoningEffort  string   `json:"reasoning_effort"`
	Search           bool     `json:"search"`
}

type CompareResult struct {
	ModelID   string `json:"model_id"`
	ModelName string `json:"model_name"`
	Content   string `json:"content"`
	Error     string `json:"error,omitempty"`
	ElapsedMs int64  `json:"elapsed_ms"`
}

// 从 model_id 查找模型显示名（从 models_handler.go 的 SupportedModels）
func findModelName(modelID string) string {
	for _, m := range SupportedModels {
		if m.ID == modelID {
			return m.Name
		}
	}
	return modelID
}

func (h *ChatHandler) Chat(c *gin.Context) {
	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 如果有模板 ID，加载模板前缀并注入到 messages 开头
	if req.TemplateID > 0 {
		var tpl services.Template
		if err := h.db.First(&tpl, req.TemplateID).Error; err == nil && tpl.Prefix != "" {
			// 在 messages 最前面插入 system 消息
			systemMsg := services.Message{Role: "system", Content: tpl.Prefix}
			req.Messages = append([]services.Message{systemMsg}, req.Messages...)
		}
	}

	// 如果有 conversation_id，保存消息
	if req.ConversationID > 0 {
		// 保存用户消息（除非标记了跳过）
		if !req.SkipSaveUserMsg {
			userMsg := req.Messages[len(req.Messages)-1]
			if userMsg.Role == "user" {
				h.db.Create(&models.Message{
					ConversationID: req.ConversationID,
					Role:           "user",
					Content:        userMsg.Content,
					Model:          req.Model,
					CreatedAt:      time.Now(),
				})
			}
		}
	}

	// 判断当前模型是否为 GPT-5x（Responses API 原生支持工具调用）
	isGPT5x := strings.HasPrefix(req.Model, "gpt-5")

	// 联网搜索：GPT-5x 用模型内置工具调用，其他模型用 API 搜索注入
	var searchSources []services.SearchResult
	var useSearchTool bool

	if req.Search {
		if isGPT5x {
			// GPT-5x 系列：跳过搜索注入，由 Responses API 的 tools 参数处理
			useSearchTool = true
		} else {
			// 非 OpenAI 模型：保持原有搜索注入流程
			var query string
			var lastUserIdx int = -1
			for i := len(req.Messages) - 1; i >= 0; i-- {
				if req.Messages[i].Role == "user" {
					query = req.Messages[i].Content
					lastUserIdx = i
					break
				}
			}
			if query != "" && lastUserIdx >= 0 {
				clientIP := c.ClientIP()
				timezone := services.GetUserTimezoneByIP(clientIP)
				searchResult, sources, err := h.searchService.Search(query, timezone)
				if err == nil && searchResult != "" {
					searchSources = sources
					originalContent := req.Messages[lastUserIdx].Content
					req.Messages[lastUserIdx].Content = originalContent + "\n\n---\n" + searchResult + "\n---"

					noCitationMsg := services.Message{Role: "system", Content: "直接回答用户的问题，回答中不要出现任何引用来源编号（如[1][2][3]等格式），不要在末尾列出引用来源或参考链接列表。"}
					req.Messages = append([]services.Message{noCitationMsg}, req.Messages...)
				} else if err != nil {
					fmt.Printf("[Chat] 搜索失败: %v\n", err)
				}
			}
		}
	}

	// 深度思考的语言指令：按模板要求 → 如果没模板则按用户语言
	if req.Reasoning && req.TemplateID == 0 {
		// 获取用户最后一条消息的语言来判断（简单检测有无中文字符）
		langInstruct := "请使用简体中文进行思考和回答。"
		if len(req.Messages) > 0 {
			lastMsg := req.Messages[len(req.Messages)-1].Content
			hasChinese := false
			for _, r := range lastMsg {
				if r >= 0x4e00 && r <= 0x9fff {
					hasChinese = true
					break
				}
			}
			if !hasChinese {
				langInstruct = "Please think and respond in English."
			}
		}
		langMsg := services.Message{Role: "system", Content: langInstruct}
		req.Messages = append([]services.Message{langMsg}, req.Messages...)
	}

	// 调用 AI 服务（reasoning 参数控制是否启用思考模式，search 控制 GPT-5x 工具调用）
	body, err := h.aiService.ChatCompletion(c.Request.Context(), req.Model, req.Messages, req.Stream, req.Reasoning, req.ReasoningEffort, useSearchTool)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.Stream {
		// SSE 流式响应
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")

		// 如果有搜索结果，先发送搜索元数据
		if len(searchSources) > 0 {
			meta := map[string]interface{}{
				"choices": []map[string]interface{}{
					{"delta": map[string]string{"content": ""}},
				},
				"_search_meta": map[string]interface{}{
					"status":        "completed",
					"sources_count": len(searchSources),
					"sources":       searchSources,
				},
			}
			out, _ := json.Marshal(meta)
			c.Writer.WriteString("data: " + string(out) + "\n\n")
			c.Writer.Flush()
		}

	var fullContent string
	var isOpenAIResponses bool = services.IsOpenAIResponsesModel(req.Model)

	if isOpenAIResponses {
		// OpenAI Responses API (GPT/o系列) 使用 Responses SSE 格式
		content, err := h.aiService.StreamOpenAIResponses(body, c.Writer, req.Reasoning)
		if err != nil {
			fmt.Printf("[Chat] StreamOpenAIResponses error: %v\n", err)
		}
		fullContent = content
		c.Writer.Flush()
	} else {
		// 非 OpenAI 模型走原有的 Chat Completions SSE 格式
		scanner := bufio.NewScanner(body)
		inThink := false

		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				continue
			}

			if !bytes.HasPrefix([]byte(line), []byte("data: ")) {
				continue
			}

			data := line[6:]
			if data == "[DONE]" {
				if inThink {
					c.Writer.WriteString("data: {\"choices\":[{\"delta\":{\"content\":\"</think>\"}}]}\n\n")
					c.Writer.Flush()
				}
				c.Writer.WriteString("data: [DONE]\n\n")
				c.Writer.Flush()
				continue
			}

			var resp map[string]interface{}
			if err := json.Unmarshal([]byte(data), &resp); err != nil {
				c.Writer.WriteString("data: " + data + "\n\n")
				c.Writer.Flush()
				continue
			}

			choices, ok := resp["choices"].([]interface{})
			if !ok || len(choices) == 0 {
				c.Writer.WriteString("data: " + data + "\n\n")
				c.Writer.Flush()
				continue
			}

			choice, ok := choices[0].(map[string]interface{})
			if !ok {
				c.Writer.WriteString("data: " + data + "\n\n")
				c.Writer.Flush()
				continue
			}

			delta, ok := choice["delta"].(map[string]interface{})
			if !ok {
				c.Writer.WriteString("data: " + data + "\n\n")
				c.Writer.Flush()
				continue
			}

			reasoning, hasReasoning := delta["reasoning_content"].(string)
			content, hasContent := delta["content"].(string)

			var newContent string
			// 只有当用户启用了深度思考时，才包装 <think> 标签
			if req.Reasoning && hasReasoning && reasoning != "" {
				if !inThink {
					newContent += "<think>"
					inThink = true
				}
				newContent += reasoning
			}
			// 重要：只有当 reasoning_content 已经完全停止时，才关闭 <think> 标签
			// DeepSeek V4 Pro 可能在 thinking 途中就发非空 content，不能提前关闭
			if hasContent && content != "" {
				// reasoning_content 完全停止：要么 map 里没有这个 key，要么值为空字符串
				reasoningStopped := !hasReasoning || reasoning == ""
				if inThink && reasoningStopped {
					newContent += "</think>"
					inThink = false
				}
				newContent += content
			}

			if newContent != "" {
				delta["content"] = newContent
				delete(delta, "reasoning_content")
				out, _ := json.Marshal(resp)
				c.Writer.WriteString("data: " + string(out) + "\n\n")
				c.Writer.Flush()
				fullContent += newContent
			} else {
				// 尝试从普通 content 中提取
				if contentVal, ok := delta["content"].(string); ok && contentVal != "" {
					fullContent += contentVal
				}
				c.Writer.WriteString("data: " + data + "\n\n")
				c.Writer.Flush()
			}
		}
	}

		// 保存 AI 响应
		if req.ConversationID > 0 && fullContent != "" {
			h.db.Create(&models.Message{
				ConversationID: req.ConversationID,
				Role:           "assistant",
				Content:        fullContent,
				Model:          req.Model,
				CreatedAt:      time.Now(),
			})
		}

		body.Close()
	} else {
		// 非流式响应
		defer body.Close()
		c.Header("Content-Type", "application/json")
		io.Copy(c.Writer, body)
	}
}

// ---- 辅助方法：非流式调用 AI 并返回完整内容 ----

func (h *ChatHandler) callModel(ctx context.Context, modelID string, messages []services.Message, reasoning bool, reasoningEffort string, search bool) (string, error) {
	body, err := h.aiService.ChatCompletion(ctx, modelID, messages, false, reasoning, reasoningEffort, search)
	if err != nil {
		return "", err
	}
	defer body.Close()

	if services.IsOpenAIResponsesModel(modelID) {
		// Responses API 非流式响应
		var result map[string]interface{}
		if err := json.NewDecoder(body).Decode(&result); err != nil {
			return "", err
		}
		output, ok := result["output"].([]interface{})
		if !ok || len(output) == 0 {
			return "", fmt.Errorf("Responses API 返回空 output")
		}

		var reasoningSummary string
		var finalContent string

		for _, o := range output {
			item, ok := o.(map[string]interface{})
			if !ok {
				continue
			}
			itemType, _ := item["type"].(string)

			if itemType == "reasoning" {
				// 提取 reasoning summary（如果有）
				if summaries, ok := item["summary"].([]interface{}); ok && len(summaries) > 0 {
					if firstSummary, ok := summaries[0].(map[string]interface{}); ok {
						if text, ok := firstSummary["text"].(string); ok && text != "" {
							reasoningSummary = text
						}
					}
				}
			} else if itemType == "message" {
				// 提取 message content
				contentItems, ok := item["content"].([]interface{})
				if !ok || len(contentItems) == 0 {
					continue
				}
				firstContent, ok := contentItems[0].(map[string]interface{})
				if !ok {
					continue
				}
				content, _ := firstContent["text"].(string)
				finalContent += content
			}
		}

		// 如果有 reasoning summary，包装为 <think> 标签格式
		if reasoningSummary != "" {
			finalContent = "<think>" + reasoningSummary + "</think>" + finalContent
		}

		if finalContent == "" {
			return "", fmt.Errorf("Responses API 返回空文本")
		}
		return finalContent, nil
	}

	// Chat Completions 非流式响应：choices[0].message.content
	var result map[string]interface{}
	if err := json.NewDecoder(body).Decode(&result); err != nil {
		return "", err
	}

	choices, ok := result["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return "", fmt.Errorf("AI 返回空结果")
	}

	choice, ok := choices[0].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("AI 返回格式异常")
	}

	msg, ok := choice["message"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("AI 返回缺少 message")
	}

	content, _ := msg["content"].(string)
	return content, nil
}

// CompareChat 并列对比问答
func (h *ChatHandler) CompareChat(c *gin.Context) {
	var req CompareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := getUserID(c)

	// 构建基础 messages
	messages := []services.Message{
		{Role: "user", Content: req.Query},
	}

	// 如果有模板 ID，加载模板前缀
	if req.TemplateID > 0 {
		var tpl services.Template
		if err := h.db.Where("id = ? AND user_id = ?", req.TemplateID, userID).First(&tpl).Error; err == nil && tpl.Prefix != "" {
			systemMsg := services.Message{Role: "system", Content: tpl.Prefix}
			messages = append([]services.Message{systemMsg}, messages...)
		}
	}

	// 并行调用多个模型
	type resultChan struct {
		index int
		res   CompareResult
	}

	results := make(chan resultChan, len(req.ModelIDs))
	ctx := c.Request.Context()

	for i, modelID := range req.ModelIDs {
		go func(idx int, modelID string) {
			start := time.Now()
			content, err := h.callModel(ctx, modelID, messages, req.Reasoning, req.ReasoningEffort, req.Search)
			elapsed := time.Since(start).Milliseconds()

			res := CompareResult{
				ModelID:   modelID,
				ModelName: findModelName(modelID),
				ElapsedMs: elapsed,
			}
			if err != nil {
				res.Error = err.Error()
			} else {
				res.Content = content
			}
			results <- resultChan{index: idx, res: res}
		}(i, modelID)
	}

	// 收集结果（保持顺序）
	ordered := make([]CompareResult, len(req.ModelIDs))
	for range req.ModelIDs {
		r := <-results
		ordered[r.index] = r.res
	}

	// 保存为用户对话
	var conversationID uint
	if userID > 0 {
		if req.ConversationID > 0 {
			// 已有对比对话，追加消息
			var conv models.Conversation
			if err := h.db.Where("id = ? AND user_id = ?", req.ConversationID, userID).First(&conv).Error; err == nil {
				conversationID = conv.ID

				// 保存用户消息
				h.db.Create(&models.Message{
					ConversationID: conv.ID,
					Role:           "user",
					Content:        req.Query,
					Model:          req.ModelIDs[0],
					CreatedAt:      time.Now(),
				})

				// 保存每个模型的回答作为独立消息
				now := time.Now()
				for i, res := range ordered {
					content := res.Content
					if res.Error != "" {
						content = "❌ " + res.Error
					}
					h.db.Create(&models.Message{
						ConversationID: conv.ID,
						Role:           "assistant",
						Content:        content,
						Model:          res.ModelID,
						CreatedAt:      now.Add(time.Duration(i) * time.Millisecond),
					})
				}

				// 更新对话时间和标题
				h.db.Model(&conv).Updates(map[string]interface{}{
					"updated_at": time.Now(),
				})
			}
		} else {
			// 新建对比对话
			conv := models.Conversation{
				UserID:        userID,
				Title:         req.Query,
				Model:         req.ModelIDs[0],
				Compare:       true,
				CompareModels: marshalJSON(req.ModelIDs),
				CreatedAt:     time.Now(),
				UpdatedAt:     time.Now(),
			}
			if err := h.db.Create(&conv).Error; err == nil {
				conversationID = conv.ID

				// 保存用户消息
				h.db.Create(&models.Message{
					ConversationID: conv.ID,
					Role:           "user",
					Content:        req.Query,
					Model:          req.ModelIDs[0],
					CreatedAt:      time.Now(),
				})

				// 保存每个模型的回答作为独立消息
				now := time.Now()
				for i, res := range ordered {
					content := res.Content
					if res.Error != "" {
						content = "❌ " + res.Error
					}
					h.db.Create(&models.Message{
						ConversationID: conv.ID,
						Role:           "assistant",
						Content:        content,
						Model:          res.ModelID,
						CreatedAt:      now.Add(time.Duration(i) * time.Millisecond),
					})
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"results":         ordered,
		"conversation_id": conversationID,
	})
}

func marshalJSON(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}
