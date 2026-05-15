package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"aipool-backend/internal/skills"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ChatHandler struct {
	db             *gorm.DB
	cfg            *config.Config
	aiService      *services.AIService
	searchService  *services.SearchService
	fileService    *services.FileService
	retrievalSvc   *services.RetrievalService
	contextBuilder *services.ContextBuilder
}

func NewChatHandler(db *gorm.DB, cfg *config.Config, aiService *services.AIService, searchService *services.SearchService, fileService *services.FileService, retrievalSvc *services.RetrievalService, contextBuilder *services.ContextBuilder) *ChatHandler {
	return &ChatHandler{db: db, cfg: cfg, aiService: aiService, searchService: searchService, fileService: fileService, retrievalSvc: retrievalSvc, contextBuilder: contextBuilder}
}

type ChatRequest struct {
	Model           string             `json:"model" binding:"required"`
	Messages        []services.Message `json:"messages" binding:"required"`
	ConversationID  uint               `json:"conversation_id"`
	Stream          bool               `json:"stream"`
	Reasoning       bool               `json:"reasoning"`
	ReasoningEffort string             `json:"reasoning_effort"`
	Search          bool               `json:"search"`
	TemplateID      uint               `json:"template_id,omitempty"`
	SkipSaveUserMsg bool               `json:"skip_save_user_msg,omitempty"` // 对比模式后续模型调用不重复保存用户消息
	SkillKey        string             `json:"skill_key,omitempty"`          // 指定技能 key
	FileIDs         []string           `json:"file_ids,omitempty"`           // 关联文件的 PublicID 列表
}

type CompareRequest struct {
	Query           string   `json:"query" binding:"required"`
	ModelIDs        []string `json:"models" binding:"required,min=2,max=4"`
	TemplateID      uint     `json:"template_id,omitempty"`
	ConversationID  uint     `json:"conversation_id,omitempty"`
	Reasoning       bool     `json:"reasoning"`
	ReasoningEffort string   `json:"reasoning_effort"`
	Search          bool     `json:"search"`
	FileIDs         []string `json:"file_ids,omitempty"`
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
	if model, ok := FindModelInfo(modelID); ok {
		return model.Name
	}
	return modelID
}

func (h *ChatHandler) preprocessSearch(messages []services.Message, modelID string, searchEnabled bool, clientIP string) ([]services.Message, []services.SearchResult, bool) {
	if !searchEnabled {
		return messages, nil, false
	}

	if SupportsSearch(modelID) {
		return messages, nil, true
	}

	processed := append([]services.Message(nil), messages...)
	var query string
	lastUserIdx := -1
	for i := len(processed) - 1; i >= 0; i-- {
		if processed[i].Role == "user" {
			query = processed[i].Content
			lastUserIdx = i
			break
		}
	}

	if query == "" || lastUserIdx < 0 || h.searchService == nil {
		return processed, nil, false
	}

	timezone := services.GetUserTimezoneByIP(clientIP)
	searchResult, sources, err := h.searchService.Search(query, timezone)
	if err != nil {
		fmt.Printf("[Search] 搜索失败 model=%s: %v\n", modelID, err)
		return processed, nil, false
	}
	if searchResult == "" {
		return processed, nil, false
	}

	originalContent := processed[lastUserIdx].Content
	processed[lastUserIdx].Content = originalContent + "\n\n---\n" + searchResult + "\n---"

	noCitationMsg := services.Message{Role: "system", Content: "直接回答用户的问题，回答中不要出现任何引用来源编号（如[1][2][3]等格式），不要在末尾列出引用来源或参考链接列表。"}
	processed = append([]services.Message{noCitationMsg}, processed...)

	return processed, sources, false
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

	// ========== Skill 技能注入 ==========
	// 只有当前端明确传递了 skill_key 时才注入，不做自动匹配（避免普通聊天被意外注入）
	if req.SkillKey != "" {
		injector := skills.NewInjector(skills.GetLoader())
		var err error
		req.Messages, err = injector.InjectSkillPrompt(req.Messages, req.SkillKey)
		if err != nil {
			fmt.Printf("[Chat] Skill 注入失败: %v\n", err)
		}
	}
	// ========== Skill 注入结束 ==========

	// ========== 图表渲染指令 ==========
	// 前端只会把 ```echarts 代码块解析成真实图表。普通 js/text 代码块只会显示为代码，
	// 所以当用户明确要求画图表时，追加一个轻量 system prompt，要求模型输出可 JSON.parse 的 ECharts option。
	if shouldRenderChart(req.Messages) {
		chartMsg := services.Message{Role: "system", Content: chartRenderInstruction}
		req.Messages = append([]services.Message{chartMsg}, req.Messages...)
	}
	// ========== 图表渲染指令结束 ==========

	// ========== 文件上下文注入 ==========
	var resolvedFileIDs []uint
	var resolvedFileNames = make(map[uint]string)

	if len(req.FileIDs) > 0 && h.fileService != nil {
		userID := getUserID(c)

		// 逐个解析 PublicID，验证权限
		for _, publicID := range req.FileIDs {
			file, err := h.fileService.ResolveFileByPublicID(publicID, userID)
			if err != nil {
				fmt.Printf("[Chat] 文件解析失败 public_id=%s: %v\n", publicID, err)
				continue
			}
			resolvedFileIDs = append(resolvedFileIDs, file.ID)
			resolvedFileNames[file.ID] = file.Filename
		}

		// 分离图片文件和普通文档
		var imageFileIDs []uint
		var docFileIDs []uint
		for _, fileID := range resolvedFileIDs {
			isImg, err := h.fileService.IsImageFile(fileID)
			if err == nil && isImg {
				imageFileIDs = append(imageFileIDs, fileID)
			} else {
				docFileIDs = append(docFileIDs, fileID)
			}
		}

		// 处理图片：读取 base64 并附加到最后一条 user message
		if len(imageFileIDs) > 0 {
			var images []string
			for _, fileID := range imageFileIDs {
				dataURI, _, err := h.fileService.GetFileBase64DataURI(fileID)
				if err == nil {
					images = append(images, dataURI)
				} else {
					fmt.Printf("[Chat] 图片 base64 转换失败: %v\n", err)
				}
			}
			for i := len(req.Messages) - 1; i >= 0; i-- {
				if req.Messages[i].Role == "user" {
					req.Messages[i].Images = images
					break
				}
			}
		}

		// 处理普通文档：走新的 RAG 流程（语义检索 + 关键词 fallback）
		if len(docFileIDs) > 0 && h.retrievalSvc != nil {
			var query string
			for i := len(req.Messages) - 1; i >= 0; i-- {
				if req.Messages[i].Role == "user" {
					query = req.Messages[i].Content
					break
				}
			}

			topK := services.DynamicTopK(req.Model)
			results, err := h.retrievalSvc.Search(docFileIDs, query, topK, false)
			if err == nil && len(results) > 0 {
				// 按文件分组构造上下文
				fileContexts := services.ExtractFileContexts(results, resolvedFileNames)

				// 动态调整最大 token
				maxTokens := 0
				if strings.Contains(req.Model, "flash") || strings.Contains(req.Model, "8k") {
					maxTokens = 8000
				} else if strings.Contains(req.Model, "opus") || strings.Contains(req.Model, "200k") {
					maxTokens = 12000
				}

				fileContext := h.contextBuilder.Build(fileContexts, query, maxTokens)
				if fileContext != "" {
					fileMsg := services.Message{Role: "system", Content: fileContext}
					req.Messages = append([]services.Message{fileMsg}, req.Messages...)
				}
			} else if err != nil {
				fmt.Printf("[Chat] 文件检索失败: %v\n", err)
			}
		}

		// 保存文件与对话的关联（使用内部 ID）
		if req.ConversationID > 0 {
			for _, fileID := range resolvedFileIDs {
				var existing models.ConversationFile
				if err := h.db.Where("conversation_id = ? AND file_id = ?", req.ConversationID, fileID).First(&existing).Error; err != nil {
					h.db.Create(&models.ConversationFile{
						ConversationID: req.ConversationID,
						FileID:         fileID,
					})
				}
			}
		}
	}
	// ========== 文件上下文注入结束 ==========

	// 如果有 conversation_id，保存消息
	if req.ConversationID > 0 {
		// 保存用户消息（除非标记了跳过）
		if !req.SkipSaveUserMsg {
			userMsg := req.Messages[len(req.Messages)-1]
			if userMsg.Role == "user" {
				msg := models.Message{
					ConversationID: req.ConversationID,
					Role:           "user",
					Content:        userMsg.Content,
					Model:          req.Model,
					CreatedAt:      time.Now(),
				}
				h.db.Create(&msg)

				// 保存消息-文件关联
				if len(resolvedFileIDs) > 0 {
					for i, fileID := range resolvedFileIDs {
						var file models.File
						if err := h.db.First(&file, fileID).Error; err != nil {
							continue
						}
						// 判断文件类型
						ftype := "document"
						if isImg, _ := h.fileService.IsImageFile(fileID); isImg {
							ftype = "image"
						}
						// 保存关联
						if i < len(req.FileIDs) {
							h.db.Create(&models.MessageFile{
								MessageID: msg.ID,
								FileID:    fileID,
								PublicID:  req.FileIDs[i],
								Type:      ftype,
								Filename:  file.Filename,
							})
						}
					}
				}
			}
		}
	}

	var searchSources []services.SearchResult
	var useSearchTool bool
	req.Messages, searchSources, useSearchTool = h.preprocessSearch(req.Messages, req.Model, req.Search, c.ClientIP())

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

	// 调用 AI 服务（reasoning 参数控制是否启用思考模式，search 控制模型原生搜索工具调用）
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
		c.Header("X-Accel-Buffering", "no")

		c.Writer.WriteHeaderNow()

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
			// OpenAI Responses API (GPT) 使用 Responses SSE 格式
			content, err := h.aiService.StreamOpenAIResponses(body, c.Writer, req.Reasoning)
			if err != nil {
				fmt.Printf("[Chat] StreamOpenAIResponses error: %v\n", err)
			}
			fullContent = content
			c.Writer.Flush()
		} else {
			// 非 OpenAI 模型走 Chat Completions SSE 格式，统一使用 SSEParser
			parser := services.NewSSEParser(body)
			inThink := false

			for {
				ev, err := parser.Next()
				if err != nil {
					if errors.Is(err, io.EOF) {
						break
					}
					// 解析失败：向前端发送错误，不发 [DONE]
					errOut, _ := json.Marshal(map[string]interface{}{
						"choices": []map[string]interface{}{
							{"delta": map[string]string{"content": fmt.Sprintf("❌ 上游流式响应解析失败: %v", err)}},
						},
					})
					c.Writer.WriteString("data: " + string(errOut) + "\n\n")
					c.Writer.Flush()
					break
				}

				data := bytes.TrimSpace(ev.Data)
				if len(data) == 0 {
					continue
				}

				if bytes.Equal(data, []byte("[DONE]")) {
					if inThink {
						c.Writer.WriteString("data: {\"choices\":[{\"delta\":{\"content\":\"</think>\"}}]}\n\n")
						c.Writer.Flush()
					}
					c.Writer.WriteString("data: [DONE]\n\n")
					c.Writer.Flush()
					continue
				}

				var resp map[string]interface{}
				if err := json.Unmarshal(data, &resp); err != nil {
					c.Writer.WriteString("data: " + string(data) + "\n\n")
					c.Writer.Flush()
					continue
				}

				choices, ok := resp["choices"].([]interface{})
				if !ok || len(choices) == 0 {
					c.Writer.WriteString("data: " + string(data) + "\n\n")
					c.Writer.Flush()
					continue
				}

				choice, ok := choices[0].(map[string]interface{})
				if !ok {
					c.Writer.WriteString("data: " + string(data) + "\n\n")
					c.Writer.Flush()
					continue
				}

				delta, ok := choice["delta"].(map[string]interface{})
				if !ok {
					c.Writer.WriteString("data: " + string(data) + "\n\n")
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
				// 重要：只有当 reasoning_content 完全停止时，才关闭 <think> 标签
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
					c.Writer.WriteString("data: " + string(data) + "\n\n")
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

	// ========== 文件上下文注入（对比模式强制走关键词检索，确保所有模型使用相同上下文） ==========
	var resolvedFileIDs []uint
	var resolvedFileNames = make(map[uint]string)

	if len(req.FileIDs) > 0 && h.fileService != nil {
		userID := getUserID(c)

		for _, publicID := range req.FileIDs {
			file, err := h.fileService.ResolveFileByPublicID(publicID, userID)
			if err != nil {
				fmt.Printf("[Compare] 文件解析失败 public_id=%s: %v\n", publicID, err)
				continue
			}
			resolvedFileIDs = append(resolvedFileIDs, file.ID)
			resolvedFileNames[file.ID] = file.Filename
		}

		// 分离图片文件和普通文档
		var imageFileIDs []uint
		var docFileIDs []uint
		for _, fileID := range resolvedFileIDs {
			isImg, err := h.fileService.IsImageFile(fileID)
			if err == nil && isImg {
				imageFileIDs = append(imageFileIDs, fileID)
			} else {
				docFileIDs = append(docFileIDs, fileID)
			}
		}

		// 处理图片
		if len(imageFileIDs) > 0 {
			var images []string
			for _, fileID := range imageFileIDs {
				dataURI, _, err := h.fileService.GetFileBase64DataURI(fileID)
				if err == nil {
					images = append(images, dataURI)
				} else {
					fmt.Printf("[Compare] 图片 base64 转换失败: %v\n", err)
				}
			}
			for i := range messages {
				if messages[i].Role == "user" {
					messages[i].Images = images
					break
				}
			}
		}

		// 处理普通文档：对比模式强制走关键词检索，确保各模型获得相同上下文
		if len(docFileIDs) > 0 && h.retrievalSvc != nil {
			results, err := h.retrievalSvc.Search(docFileIDs, req.Query, services.DynamicTopK("compare"), true)
			if err == nil && len(results) > 0 {
				fileContexts := services.ExtractFileContexts(results, resolvedFileNames)
				fileContext := h.contextBuilder.Build(fileContexts, req.Query, 0)
				if fileContext != "" {
					fileMsg := services.Message{Role: "system", Content: fileContext}
					messages = append([]services.Message{fileMsg}, messages...)
				}
			} else if err != nil {
				fmt.Printf("[Compare] 文件检索失败: %v\n", err)
			}
		}

		// 保存文件与对话的关联
		if req.ConversationID > 0 {
			for _, fileID := range resolvedFileIDs {
				var existing models.ConversationFile
				if err := h.db.Where("conversation_id = ? AND file_id = ?", req.ConversationID, fileID).First(&existing).Error; err != nil {
					h.db.Create(&models.ConversationFile{
						ConversationID: req.ConversationID,
						FileID:         fileID,
					})
				}
			}
		}
	}
	// ========== 文件上下文注入结束 ==========

	// 并行调用多个模型
	type resultChan struct {
		index int
		res   CompareResult
	}

	results := make(chan resultChan, len(req.ModelIDs))
	ctx := c.Request.Context()

	searchMessages, _, compareUseSearchTool := h.preprocessSearch(messages, req.ModelIDs[0], req.Search, c.ClientIP())

	for i, modelID := range req.ModelIDs {
		go func(idx int, modelID string) {
			start := time.Now()
			modelMessages := searchMessages
			useSearchTool := compareUseSearchTool
			if req.Search {
				modelMessages, _, useSearchTool = h.preprocessSearch(messages, modelID, req.Search, c.ClientIP())
			}
			content, err := h.callModel(ctx, modelID, modelMessages, req.Reasoning, req.ReasoningEffort, useSearchTool)
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
					CreatedAt:      time.Now(),
				})
			}
		} else {
			// 创建新的对比对话
			title := req.Query
			if len(title) > 20 {
				title = title[:20] + "..."
			}
			conv := models.Conversation{
				UserID:        userID,
				Title:         title,
				Model:         req.ModelIDs[0],
				Compare:       true,
				CompareModels: mustJSON(req.ModelIDs),
			}
			h.db.Create(&conv)
			conversationID = conv.ID

			// 保存用户消息
			h.db.Create(&models.Message{
				ConversationID: conv.ID,
				Role:           "user",
				Content:        req.Query,
				CreatedAt:      time.Now(),
			})
		}
	}

	// 保存对比记录
	if conversationID > 0 {
		for _, res := range ordered {
			h.db.Create(&models.Message{
				ConversationID: conversationID,
				Role:           "assistant",
				Content:        res.Content,
				Model:          res.ModelID,
				CreatedAt:      time.Now(),
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"results":         ordered,
		"conversation_id": conversationID,
	})
}

func mustJSON(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

const chartRenderInstruction = `用户要求画图表/折线图/柱状图/饼图/趋势图时，必须输出一个真实可渲染图表，而不是 ASCII 示意图或只给 ECharts JS 代码。

输出规则：
1. 先用一句中文简短说明。
2. 立即给出一个 fenced code block，语言必须是 echarts：
` + "```echarts" + `
{ ... }
` + "```" + `
3. 代码块内容必须是严格 JSON 对象，可被 JSON.parse 直接解析：
   - 属性名必须使用双引号
   - 字符串必须使用双引号
   - 不要出现 const、option =、注释、函数、尾随逗号
4. option 必须至少包含 title、tooltip、xAxis、yAxis、series。
5. 不要再输出 ASCII 图、text 图、Mermaid、JavaScript 代码示例。`

func shouldRenderChart(messages []services.Message) bool {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != "user" {
			continue
		}
		text := strings.ToLower(messages[i].Content)
		chartWords := []string{"图表", "折线图", "柱状图", "饼图", "趋势图", "面积图", "散点图", "echarts", "chart", "line chart", "bar chart", "pie chart"}
		for _, word := range chartWords {
			if strings.Contains(text, word) {
				return true
			}
		}
		return false
	}
	return false
}
