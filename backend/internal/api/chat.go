package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"aipool-backend/internal/skills"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
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
	usageService   *services.UsageService
}

func NewChatHandler(db *gorm.DB, cfg *config.Config, aiService *services.AIService, searchService *services.SearchService, fileService *services.FileService, retrievalSvc *services.RetrievalService, contextBuilder *services.ContextBuilder, usageService *services.UsageService) *ChatHandler {
	return &ChatHandler{db: db, cfg: cfg, aiService: aiService, searchService: searchService, fileService: fileService, retrievalSvc: retrievalSvc, contextBuilder: contextBuilder, usageService: usageService}
}

type FileContextPolicy struct {
	UseConversationFiles string `json:"use_conversation_files,omitempty"` // auto | always | never
	MaxConversationFiles int    `json:"max_conversation_files,omitempty"`
	IncludePinnedFiles   bool   `json:"include_pinned_files,omitempty"`
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
	WorkspaceID     uint               `json:"workspace_id,omitempty"`
	SkillKey        string             `json:"skill_key,omitempty"` // 指定技能 key

	// 本轮消息显式附件，只用于 message_files 展示，同时默认参与本轮 RAG
	MessageFileIDs []string `json:"message_file_ids,omitempty"`
	// 显式选择参与本轮上下文的历史文件，不展示在当前消息气泡
	ContextFileIDs []string `json:"context_file_ids,omitempty"`
	// 控制是否从 conversation_files 自动选上下文文件
	ContextPolicy FileContextPolicy `json:"context_policy,omitempty"`
	// 兼容旧前端：旧 file_ids 等同于 message_file_ids
	FileIDs []string `json:"file_ids,omitempty"`
}

type CompareRequest struct {
	Query           string   `json:"query" binding:"required"`
	ModelIDs        []string `json:"models" binding:"required,min=2,max=4"`
	TemplateID      uint     `json:"template_id,omitempty"`
	ConversationID  uint     `json:"conversation_id,omitempty"`
	Reasoning       bool     `json:"reasoning"`
	WorkspaceID     uint     `json:"workspace_id,omitempty"`
	ReasoningEffort string   `json:"reasoning_effort"`
	Search          bool     `json:"search"`

	MessageFileIDs []string          `json:"message_file_ids,omitempty"`
	ContextFileIDs []string          `json:"context_file_ids,omitempty"`
	ContextPolicy  FileContextPolicy `json:"context_policy,omitempty"`
	FileIDs        []string          `json:"file_ids,omitempty"`
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

// isFileQuestion 判断用户问题是否是针对上传文件/图片的指代性提问。
// 注意：这里不能把单字“这”当关键词，否则“今天这个新闻”等问题会误跳过搜索。
func isFileQuestion(query string) bool {
	q := strings.ToLower(strings.TrimSpace(query))
	fileKeywords := []string{
		"图片", "照片", "截图", "这张图", "这张图片", "这张照片", "图里", "图片里",
		"文件", "文档", "pdf", "docx", "ppt", "xlsx", "附件", "上传的",
		"这个文件", "这份文件", "这个附件", "这个文档", "上面的文件", "上面的图片",
		"这是什么", "是什么", "内容是什么", "什么意思", "讲什么",
		"描述", "描述下", "总结一下", "总结", "概括", "解释", "内容",
	}
	for _, kw := range fileKeywords {
		if strings.Contains(q, kw) {
			return true
		}
	}
	return false
}

func lastUserContent(messages []services.Message) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return messages[i].Content
		}
	}
	return ""
}

func maxFileContextTokens(model string) int {
	if strings.Contains(model, "flash") || strings.Contains(model, "8k") {
		return 8000
	}
	if strings.Contains(model, "opus") || strings.Contains(model, "200k") {
		return 12000
	}
	return 0
}

func appendUniqueStrings(dst []string, values ...string) []string {
	seen := make(map[string]struct{}, len(dst)+len(values))
	for _, v := range dst {
		seen[v] = struct{}{}
	}
	for _, v := range values {
		if strings.TrimSpace(v) == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		dst = append(dst, v)
	}
	return dst
}

func mergeSystemMessages(messages []services.Message) []services.Message {
	var fileContextParts []string
	var otherSystemParts []string
	var webSearchParts []string
	var nonSystem []services.Message
	for _, m := range messages {
		if m.Role == "system" {
			if strings.Contains(m.Content, "<file_context>") {
				fileContextParts = append(fileContextParts, m.Content)
			} else if strings.Contains(m.Content, "<web_search_context>") {
				webSearchParts = append(webSearchParts, m.Content)
			} else {
				otherSystemParts = append(otherSystemParts, m.Content)
			}
		} else {
			nonSystem = append(nonSystem, m)
		}
	}

	var orderedParts []string
	orderedParts = append(orderedParts, fileContextParts...)
	orderedParts = append(orderedParts, otherSystemParts...)
	orderedParts = append(orderedParts, webSearchParts...)
	if len(orderedParts) == 0 {
		return messages
	}

	mergedSystem := strings.Join(orderedParts, "\n\n---\n\n")
	fmt.Printf("[Chat] merged %d system messages into one (file=%d other=%d search=%d), total length=%d\n",
		len(orderedParts), len(fileContextParts), len(otherSystemParts), len(webSearchParts), len(mergedSystem))
	return append([]services.Message{{Role: "system", Content: mergedSystem}}, nonSystem...)
}

func (h *ChatHandler) resolveChatFiles(publicIDs []string, userID uint, guestID string) ([]uint, map[uint]string, []models.File) {
	publicIDs = uniquePublicIDs(publicIDs)
	const maxFilesPerChat = 20
	if len(publicIDs) > maxFilesPerChat {
		fmt.Printf("[Chat] 文件数 %d 超过上限 %d，截断到前 %d 个\n", len(publicIDs), maxFilesPerChat, maxFilesPerChat)
		publicIDs = publicIDs[:maxFilesPerChat]
	}

	var resolvedFileIDs []uint
	resolvedFileNames := make(map[uint]string)
	var resolvedFiles []models.File
	for _, publicID := range publicIDs {
		file, err := h.fileService.ResolveFileByPublicID(publicID, userID, guestID)
		if err != nil {
			fmt.Printf("[Chat] 文件解析失败 public_id=%s: %v\n", publicID, err)
			continue
		}
		resolvedFileIDs = append(resolvedFileIDs, file.ID)
		resolvedFileNames[file.ID] = file.Filename
		resolvedFiles = append(resolvedFiles, *file)
	}

	return resolvedFileIDs, resolvedFileNames, resolvedFiles
}

func uniquePublicIDs(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	var out []string
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func appendUniqueFiles(dst []models.File, values ...models.File) []models.File {
	seen := make(map[uint]struct{}, len(dst)+len(values))
	for _, f := range dst {
		seen[f.ID] = struct{}{}
	}
	for _, f := range values {
		if _, ok := seen[f.ID]; ok {
			continue
		}
		seen[f.ID] = struct{}{}
		dst = append(dst, f)
	}
	return dst
}

func makeFileNameMap(files []models.File) map[uint]string {
	names := make(map[uint]string, len(files))
	for _, f := range files {
		names[f.ID] = f.Filename
	}
	return names
}

func (h *ChatHandler) loadConversationFiles(conversationID uint, userID uint, guestID string, limit int, includePinned bool) []models.File {
	if conversationID == 0 {
		return nil
	}
	if limit <= 0 {
		limit = 8
	}

	query := h.db.
		Table("conversation_files").
		Select("files.*").
		Joins("JOIN conversations ON conversations.id = conversation_files.conversation_id").
		Joins("JOIN files ON files.id = conversation_files.file_id").
		Where("conversation_files.conversation_id = ?", conversationID)
	if userID > 0 {
		query = query.Where("conversations.user_id = ?", userID)
	} else {
		query = query.Where("conversations.guest_id = ?", guestID)
	}

	query = query.Order("conversation_files.id DESC")

	var files []models.File
	if err := query.Limit(limit).Scan(&files).Error; err != nil {
		fmt.Printf("[Chat] 加载会话文件失败 conversation_id=%d: %v\n", conversationID, err)
		return nil
	}
	return files
}

type ChatFilePlan struct {
	MessageFiles []models.File // 当前消息附件，写 message_files
	ContextFiles []models.File // 显式上下文文件，不展示在消息
	RAGFiles     []models.File // 本轮实际进入 buildFileContext 的文件
}

func (h *ChatHandler) buildChatFilePlan(req ChatRequest, userID uint, guestID string) ChatFilePlan {
	messagePublicIDs := req.MessageFileIDs
	if len(messagePublicIDs) == 0 && len(req.FileIDs) > 0 {
		// 兼容旧前端：旧 file_ids 按当前消息附件处理
		messagePublicIDs = req.FileIDs
	}

	_, _, messageFiles := h.resolveChatFiles(messagePublicIDs, userID, guestID)
	_, _, contextFiles := h.resolveChatFiles(req.ContextFileIDs, userID, guestID)

	ragFiles := appendUniqueFiles(nil, messageFiles...)
	ragFiles = appendUniqueFiles(ragFiles, contextFiles...)

	mode := req.ContextPolicy.UseConversationFiles
	if mode == "" {
		mode = "auto"
	}

	query := lastUserContent(req.Messages)
	shouldUseConversationFiles := false
	switch mode {
	case "always":
		shouldUseConversationFiles = true
	case "never":
		shouldUseConversationFiles = false
	default: // auto
		// 保守策略：只有当本轮没有上传新文件，且用户问题明显指向文件/图片时，才自动加载历史文件。
		// 普通 follow-up 问题（如"还有呢""再说详细点"）不会污染历史文件上下文。
		if len(messageFiles) == 0 && isFileQuestion(query) {
			shouldUseConversationFiles = true
			fmt.Printf("[buildChatFilePlan] auto 模式：问题指向文件，自动加载历史文件 query=%q\n", query)
		} else {
			fmt.Printf("[buildChatFilePlan] auto 模式：跳过历史文件。新文件=%d, 是文件问题=%v, query=%q\n",
				len(messageFiles), isFileQuestion(query), query)
		}
	}

	if shouldUseConversationFiles {
		limit := req.ContextPolicy.MaxConversationFiles
		if limit <= 0 {
			limit = 8
		}
		conversationFiles := h.loadConversationFiles(
			req.ConversationID,
			userID,
			guestID,
			limit,
			req.ContextPolicy.IncludePinnedFiles,
		)
		ragFiles = appendUniqueFiles(ragFiles, conversationFiles...)
	}

	return ChatFilePlan{
		MessageFiles: messageFiles,
		ContextFiles: contextFiles,
		RAGFiles:     ragFiles,
	}
}

func (h *ChatHandler) saveMessageFiles(messageID uint, files []models.File) {
	for _, file := range files {
		ftype := "document"
		if file.HasImages || file.MimeType == "image" || strings.HasPrefix(file.MimeType, "image/") {
			ftype = "image"
		}
		h.db.Create(&models.MessageFile{
			MessageID: messageID,
			FileID:    file.ID,
			PublicID:  file.PublicID,
			Type:      ftype,
			Filename:  file.Filename,
		})
	}
}

func (h *ChatHandler) upsertConversationFiles(conversationID uint, files []models.File) {
	if conversationID == 0 || len(files) == 0 {
		return
	}
	for _, file := range files {
		var existing models.ConversationFile
		if err := h.db.Where("conversation_id = ? AND file_id = ?", conversationID, file.ID).First(&existing).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				h.db.Create(&models.ConversationFile{ConversationID: conversationID, FileID: file.ID})
			} else {
				fmt.Printf("[Chat] 查询会话文件失败 conversation_id=%d file_id=%d: %v\n", conversationID, file.ID, err)
			}
		}
	}
}

func (h *ChatHandler) buildFileContext(files []models.File, fileNames map[uint]string, query string, model string, forceKeyword bool, logPrefix string) string {
	if len(files) == 0 {
		return ""
	}

	var imageFileIDs []uint
	var docFileIDs []uint
	for _, file := range files {
		isImage := file.HasImages || file.MimeType == "image" || strings.HasPrefix(file.MimeType, "image/")
		if file.ParseStatus != "done" {
			fmt.Printf("[%s RAG] 文件尚未解析完成 fileID=%d name=%s status=%s error=%s\n", logPrefix, file.ID, file.Filename, file.ParseStatus, file.ErrorMessage)
		}
		if isImage {
			imageFileIDs = append(imageFileIDs, file.ID)
		} else {
			docFileIDs = append(docFileIDs, file.ID)
		}
	}
	fmt.Printf("[%s RAG] imageFileIDs=%v docFileIDs=%v\n", logPrefix, imageFileIDs, docFileIDs)

	// [路径A] 文件上传 RAG：将上传的图片/文档分别处理
	// 图片 → 直接注入 image_caption chunks（一次读全，不走语义检索）
	// 文档 → RetrievalService.Search（支持语义/关键词检索）
	// 这与下面的 callXXX 函数中 Message.Images 的路径B（内联多模态直传）完全独立。
	var allResults []services.ChunkSearchResult
	for _, fid := range imageFileIDs {
		var chunks []models.FileChunk
		if err := h.db.Where("file_id = ? AND block_type = ?", fid, "image_caption").Order("chunk_index").Find(&chunks).Error; err != nil {
			fmt.Printf("[%s RAG] 读取图片 chunks 失败 fileID=%d: %v\n", logPrefix, fid, err)
			continue
		}
		fmt.Printf("[%s RAG] 图片 fileID=%d 直接注入 %d 个 image_caption chunks\n", logPrefix, fid, len(chunks))
		for _, c := range chunks {
			allResults = append(allResults, services.ChunkSearchResult{Chunk: c, Score: 1.0, Relevance: "high"})
		}
	}

	if len(docFileIDs) > 0 && h.retrievalSvc != nil {
		if services.IsDocumentOverviewQuery(query) {
			// 概览模式：确定性选择开头+关键词+结尾 chunks，不走语义检索
			fmt.Printf("[%s RAG] 概览模式 query=%q，不走检索，直接选择开头+关键词+结尾 chunks\n", logPrefix, query)
			for _, fid := range docFileIDs {
				var chunks []models.FileChunk
				if err := h.db.Where("file_id = ?", fid).Order("chunk_index").Find(&chunks).Error; err != nil {
					fmt.Printf("[%s RAG] 读取文件 chunks 失败 fileID=%d: %v\n", logPrefix, fid, err)
					continue
				}
				selected := services.SelectOverviewChunks(chunks, query, 40000)
				fmt.Printf("[%s RAG] 文件 fileID=%d 概览选择 %d/%d chunks\n", logPrefix, fid, len(selected), len(chunks))
				for _, c := range selected {
					allResults = append(allResults, services.ChunkSearchResult{Chunk: c, Score: 1.0, Relevance: "high"})
				}
			}
		} else {
			topK := services.DynamicTopK(model)
			results, err := h.retrievalSvc.Search(docFileIDs, query, topK, forceKeyword)
			fmt.Printf("[%s RAG] 文档检索 docFileIDs=%v query=%q 返回 %d 结果, err=%v\n", logPrefix, docFileIDs, query, len(results), err)
			for i, r := range results {
				fmt.Printf("[%s RAG] result[%d]: fileID=%d score=%.4f content=%q\n", logPrefix, i, r.Chunk.FileID, r.Score, services.PreviewRunes(r.Chunk.Content, 80))
			}
			if err == nil {
				allResults = append(allResults, results...)
			}
		}
	}

	if len(allResults) == 0 {
		fmt.Printf("[%s RAG] no file context to inject\n", logPrefix)
		return ""
	}

	fileContexts := services.ExtractFileContexts(allResults, fileNames)
	for i, fc := range fileContexts {
		fileID := uint(0)
		if len(fc.Chunks) > 0 {
			fileID = fc.Chunks[0].Chunk.FileID
		}
		fmt.Printf("[%s RAG] context[%d]: fileID=%d name=%s chunks=%d\n", logPrefix, i, fileID, fc.FileName, len(fc.Chunks))
	}

	fileContext := h.contextBuilder.Build(fileContexts, query, maxFileContextTokens(model))
	fmt.Printf("[%s RAG] fileContext length=%d empty=%v\n", logPrefix, len(fileContext), fileContext == "")
	return fileContext
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

	// 不再把搜索结果拼到 user message 里污染问题，而是作为单独的 system message
	// 确保上传文件上下文优先级高于搜索结果
	searchCtx := "<web_search_context>\n"
	searchCtx += "以下是联网搜索结果，仅用于补充外部背景。\n"
	searchCtx += "不得替代上传文件内容。如果搜索结果与文件上下文冲突，以文件上下文为准。\n\n"
	searchCtx += searchResult
	searchCtx += "\n</web_search_context>"
	searchMsg := services.Message{Role: "system", Content: searchCtx}
	processed = append([]services.Message{searchMsg}, processed...)

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

	// ========== 匿名用户检查 ==========
	userID, guestID, ok := requireGuestOrUser(c, h.cfg, h.db)
	if !ok {
		return
	}
	// ========== 匿名用户检查结束 ==========

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

	// ========== 保存消息与会话 ==========
	// 如果没有 conversation_id，创建新会话（匿名用户也需要保存以便统计额度和历史文件复用）
	conversationID := req.ConversationID
	if conversationID == 0 {
		lastUserQuery := lastUserContent(req.Messages)
		title := lastUserQuery
		if len(title) > 20 {
			title = title[:20] + "..."
		}
		conv := models.Conversation{
			UserID:      userID,
			GuestID:     guestID,
			Title:       title,
			Model:       req.Model,
			WorkspaceID: req.WorkspaceID,
		}
		h.db.Create(&conv)
		conversationID = conv.ID
		req.ConversationID = conv.ID
	}
	// ========== 保存消息与会话结束 ==========

	// ========== 文件上下文注入 ==========
	filePlan := ChatFilePlan{}
	query := lastUserContent(req.Messages)

	if h.fileService != nil {
		filePlan = h.buildChatFilePlan(req, userID, guestID)
	}

	// 检查文件是否解析完成
	for _, f := range filePlan.RAGFiles {
		if f.ParseStatus != "done" {
			c.JSON(http.StatusConflict, gin.H{"error": "file_not_ready", "message": "文件正在解析中，请稍后重试", "file_id": f.PublicID, "status": f.ParseStatus})
			return
		}
	}

	ragFileNames := makeFileNameMap(filePlan.RAGFiles)
	if len(filePlan.RAGFiles) > 0 {
		fileContext := h.buildFileContext(filePlan.RAGFiles, ragFileNames, query, req.Model, false, "Chat")
		if fileContext != "" {
			fileMsg := services.Message{Role: "system", Content: fileContext}
			req.Messages = append([]services.Message{fileMsg}, req.Messages...)
			fmt.Printf("[Chat RAG] injected system message with file context\n")
		}

		// 保存文件与会话的关联：message_files + context_files 都进入 conversation_files 池
		allFiles := appendUniqueFiles(nil, filePlan.MessageFiles...)
		allFiles = appendUniqueFiles(allFiles, filePlan.ContextFiles...)
		h.upsertConversationFiles(req.ConversationID, allFiles)
	}
	// ========== 文件上下文注入结束 ==========

	// 保存用户消息（除非标记了跳过）
	if !req.SkipSaveUserMsg {
		userMsg := req.Messages[len(req.Messages)-1]
		if userMsg.Role == "user" {
			msg := models.Message{
				ConversationID: conversationID,
				Role:           "user",
				Content:        userMsg.Content,
				Model:          req.Model,
				CreatedAt:      time.Now(),
			}
			h.db.Create(&msg)

			// 保存消息-文件关联：只保存当前消息附件，避免历史文件污染新消息展示
			if len(filePlan.MessageFiles) > 0 {
				h.saveMessageFiles(msg.ID, filePlan.MessageFiles)
			}
		}
	}
	// ========== 保存消息与会话结束 ==========

	var searchSources []services.SearchResult
	var useSearchTool bool

	// 有文件上下文且问题是文件相关时，跳过联网搜索，避免搜索结果污染文件问答
	lastUserQuery := ""
	if len(req.Messages) > 0 {
		lastUserQuery = req.Messages[len(req.Messages)-1].Content
	}
	if len(filePlan.RAGFiles) > 0 && isFileQuestion(lastUserQuery) {
		fmt.Printf("[Chat] 文件问答模式，跳过联网搜索 ragFiles=%v query=%q\n", filePlan.RAGFiles, lastUserQuery)
		searchSources = nil
		useSearchTool = false
	} else {
		req.Messages, searchSources, useSearchTool = h.preprocessSearch(req.Messages, req.Model, req.Search, c.ClientIP())
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

	// 合并所有 system message 为一条，避免多个 system 导致部分模型（如 DeepSeek）只读取其中一条
	// 按优先级排序：file_context > 其他 > web_search_context
	req.Messages = mergeSystemMessages(req.Messages)

	// GPT 5.5 后台规则仍保留 stream=true：background=true + stream=true + webhook。
	// 前端在线时实时看流；断开后 OpenAI 后台继续跑；最终 webhook 兜底落库。
	useBackground := services.OpenAIUsesBackground(req.Model, req.ReasoningEffort)

	// 调用 AI 服务（reasoning 参数控制是否启用思考模式，search 控制模型原生搜索工具调用）
	resp, err := h.aiService.ChatCompletion(c.Request.Context(), req.Model, req.Messages, req.Stream, req.Reasoning, req.ReasoningEffort, useSearchTool)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if resp.Background && !req.Stream {
		h.handleBackgroundResponse(c, resp, conversationID, userID, guestID, req.Model, false)
		return
	}

	if req.Stream {
		// 先创建一条空的 assistant 消息，确保即使用户跳转/刷新也能看到生成中的消息
		assistantMsg := models.Message{
			ConversationID: conversationID,
			Role:           "assistant",
			Content:        "",
			Model:          req.Model,
			CreatedAt:      time.Now(),
		}
		h.db.Create(&assistantMsg)
		assistantMsgID := assistantMsg.ID

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

		streamResult, usage, err := h.forwardUnifiedStream(resp, c.Writer, req.Reasoning, assistantMsgID)
		if err != nil {
			fmt.Printf("[Chat] forwardUnifiedStream error: %v\n", err)
		}
		resp.Body.Close()

		// 流结束后，更新已有的 assistant 消息（先创建空消息可防止用户跳转时丢失）
		if assistantMsgID > 0 {
			h.db.Model(&models.Message{}).Where("id = ?", assistantMsgID).Update("content", streamResult.FullContent)
			if useBackground && streamResult.ResponseID != "" {
				h.createBackgroundTask(streamResult.ResponseID, userID, guestID, conversationID, assistantMsgID, req.Model, resp.Provider, "streaming", streamResult.LastSequenceNumber)
			}
		} else if useBackground && streamResult.ResponseID != "" {
			// 极端情况：如果没有 assistantMsgID（不应该发生），退回到原逻辑
			assistantMsg := models.Message{ConversationID: conversationID, Role: "assistant", Content: "后台任务已开始，完成后会自动更新结果。", Model: req.Model, CreatedAt: time.Now()}
			h.db.Create(&assistantMsg)
			h.createBackgroundTask(streamResult.ResponseID, userID, guestID, conversationID, assistantMsg.ID, req.Model, resp.Provider, "running", streamResult.LastSequenceNumber)
		}

		// 记录 usage
		if h.usageService != nil && usage != nil {
			if err := h.usageService.RecordChatUsageWithResourceID(userID, guestID, resp.Provider, resp.Model, resp.ModelType, conversationID, usage); err != nil {
				fmt.Printf("[Chat] 记录 usage 失败: %v\n", err)
			}
		}
	} else {
		// 非流式响应：读取 body，解析 usage，记录，再写回客户端
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "读取响应失败"})
			return
		}

		var usage *services.TokenUsage
		var rawResp map[string]interface{}
		if err := json.Unmarshal(body, &rawResp); err == nil {
			if usageRaw, ok := rawResp["usage"].(map[string]interface{}); ok {
				usage = services.ParseOpenAIUsage(usageRaw)
				if usage.TotalTokens == 0 {
					usage = services.ParseAnthropicUsage(usageRaw)
				}
				if usage.TotalTokens == 0 {
					usage = nil
				}
			}
		}

		if h.usageService != nil && usage != nil {
			if err := h.usageService.RecordChatUsageWithResourceID(userID, guestID, resp.Provider, resp.Model, resp.ModelType, conversationID, usage); err != nil {
				fmt.Printf("[Chat] 记录 usage 失败: %v\n", err)
			}
		}

		// 非流式响应也保存 assistant 消息
		if content, ok := rawResp["choices"]; ok {
			if choices, ok := content.([]interface{}); ok && len(choices) > 0 {
				if choice, ok := choices[0].(map[string]interface{}); ok {
					if msgMap, ok := choice["message"].(map[string]interface{}); ok {
						if assistantContent, ok := msgMap["content"].(string); ok && assistantContent != "" {
							h.db.Create(&models.Message{
								ConversationID: conversationID,
								Role:           "assistant",
								Content:        assistantContent,
								Model:          req.Model,
								CreatedAt:      time.Now(),
							})
						}
					}
				}
			}
		}

		c.Header("Content-Type", "application/json")
		// 注入 conversation_id 到响应中（前端需要它来维护会话状态）
		if rawResp == nil {
			rawResp = make(map[string]interface{})
		}
		rawResp["conversation_id"] = conversationID
		body, _ = json.Marshal(rawResp)
		c.Writer.Write(body)
	}
}

// forwardUnifiedStream 统一流式转发：通过 decoder factory 获取对应解码器，
// 循环读取上游事件 → 转换 → 写入前端 SSE，返回完整内容和 usage。
func (h *ChatHandler) createBackgroundTask(responseID string, userID uint, guestID string, conversationID uint, assistantMessageID uint, model string, provider string, status string, lastSequenceNumber int64) {
	if responseID == "" {
		return
	}
	task := models.AIBackgroundTask{
		ResponseID:         responseID,
		UserID:             userID,
		GuestID:            guestID,
		ConversationID:     conversationID,
		AssistantMessageID: assistantMessageID,
		Model:              model,
		Provider:           provider,
		Status:             status,
		LastSequenceNumber: lastSequenceNumber,
		CreatedAt:          time.Now(),
	}
	if err := h.db.Where("response_id = ?", responseID).Assign(task).FirstOrCreate(&task).Error; err != nil {
		fmt.Printf("[Chat] 保存后台任务失败 response_id=%s: %v\n", responseID, err)
	}
}

func (h *ChatHandler) handleBackgroundResponse(c *gin.Context, resp *services.AICompletionResponse, conversationID uint, userID uint, guestID string, model string, clientWantsStream bool) {
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取后台任务响应失败"})
		return
	}

	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "解析后台任务响应失败"})
		return
	}
	responseID, _ := raw["id"].(string)
	if responseID == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "OpenAI 后台任务未返回 response id"})
		return
	}

	placeholder := "后台任务已开始，完成后会自动更新结果。"
	assistantMsg := models.Message{
		ConversationID: conversationID,
		Role:           "assistant",
		Content:        placeholder,
		Model:          model,
		CreatedAt:      time.Now(),
	}
	if err := h.db.Create(&assistantMsg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存后台任务占位消息失败"})
		return
	}

	task := models.AIBackgroundTask{
		ResponseID:         responseID,
		UserID:             userID,
		GuestID:            guestID,
		ConversationID:     conversationID,
		AssistantMessageID: assistantMsg.ID,
		Model:              model,
		Provider:           resp.Provider,
		Status:             "running",
		CreatedAt:          time.Now(),
	}
	if err := h.db.Create(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存后台任务失败"})
		return
	}

	payload := gin.H{
		"id":                   responseID,
		"object":               "background_task",
		"status":               "running",
		"background":           true,
		"conversation_id":      conversationID,
		"assistant_message_id": assistantMsg.ID,
		"message":              placeholder,
	}

	if clientWantsStream {
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		out, _ := json.Marshal(map[string]any{
			"choices":          []map[string]any{{"delta": map[string]string{"content": placeholder}}},
			"_background_task": payload,
		})
		c.Writer.WriteString("data: " + string(out) + "\n\n")
		c.Writer.WriteString("data: [DONE]\n\n")
		c.Writer.Flush()
		return
	}

	c.JSON(http.StatusOK, payload)
}

type UnifiedStreamResult struct {
	FullContent        string
	ResponseID         string
	LastSequenceNumber int64
}

func (h *ChatHandler) forwardUnifiedStream(resp *services.AICompletionResponse, w gin.ResponseWriter, reasoningEnabled bool, assistantMsgID uint) (*UnifiedStreamResult, *services.TokenUsage, error) {
	decoder := resp.Decoder
	if decoder == nil {
		decoder = services.NewDecoder(resp.ModelType, resp.Body)
	}
	outcome := &UnifiedStreamResult{}

	type streamResult struct {
		event *services.AIStreamEvent
		err   error
	}

	results := make(chan streamResult, 1)
	done := make(chan struct{})
	defer close(done)

	// decoder.Next() 会阻塞等待上游首个 token。放到 goroutine 中读取，
	// 主 goroutine 用 ticker 定期向前端发送 SSE 注释心跳，避免 Cloudflare / 浏览器
	// 在 DeepSeek 大文件请求 40-60s 无输出时把空闲连接断开。
	go func() {
		for {
			event, err := decoder.Next()
			select {
			case results <- streamResult{event: event, err: err}:
			case <-done:
				return
			}
			if err != nil || (event != nil && event.Type == services.EventDone) {
				return
			}
		}
	}()

	writeAndFlush := func(payload string) error {
		if _, err := w.WriteString(payload); err != nil {
			return err
		}
		w.Flush()
		return nil
	}

	const heartbeatInterval = 15 * time.Second
	heartbeat := time.NewTicker(heartbeatInterval)
	defer heartbeat.Stop()

	var fullContent strings.Builder
	var contentMu sync.Mutex
	var getContent = func() string {
		contentMu.Lock()
		defer contentMu.Unlock()
		return fullContent.String()
	}

	// 定期将增量内容落库，防止用户跳转/刷新时丢失生成进度
	var dbUpdateTicker *time.Ticker
	var dbUpdateDone chan struct{}
	if assistantMsgID > 0 {
		dbUpdateTicker = time.NewTicker(2 * time.Second)
		dbUpdateDone = make(chan struct{})
		defer func() {
			dbUpdateTicker.Stop()
			close(dbUpdateDone)
		}()
		go func() {
			for {
				select {
				case <-dbUpdateTicker.C:
					content := getContent()
					if content != "" {
						h.db.Model(&models.Message{}).Where("id = ?", assistantMsgID).Update("content", content)
					}
				case <-dbUpdateDone:
					return
				}
			}
		}()
	}

	var finalUsage *services.TokenUsage
	for {
		select {
		case <-heartbeat.C:
			// SSE comment：前端 EventSource/fetch parser 会忽略以 ':' 开头的注释行，
			// 但 Cloudflare tunnel 会把它视为有效传输，从而保持连接活跃。
			if err := writeAndFlush(":ping\n\n"); err != nil {
				outcome.FullContent = strings.TrimSpace(getContent())
				return outcome, finalUsage, err
			}

		case result := <-results:
			event, err := result.event, result.err
			if err != nil {
				if err == io.EOF {
					outcome.FullContent = strings.TrimSpace(getContent())
					return outcome, finalUsage, nil
				}
				// 解析错误：向前端发送错误，不发 [DONE]
				errOut, _ := json.Marshal(map[string]interface{}{
					"choices": []map[string]interface{}{
						{"delta": map[string]string{"content": fmt.Sprintf("❌ 上游流式响应解析失败: %v", err)}},
					},
				})
				_ = writeAndFlush("data: " + string(errOut) + "\n\n")
				outcome.FullContent = strings.TrimSpace(getContent())
				return outcome, finalUsage, err
			}

			if event == nil {
				continue
			}
			if event.SequenceNumber > 0 {
				outcome.LastSequenceNumber = event.SequenceNumber
			}
			if event.ResponseID != "" {
				outcome.ResponseID = event.ResponseID
			}
			if event.Type == services.EventResponseCreated {
				continue
			}

			// 收集 usage 信息，不转发给前端
			if event.Type == services.EventUsage {
				finalUsage = event.Usage
				continue
			}

			if event.Type == services.EventDone {
				if err := writeAndFlush("data: [DONE]\n\n"); err != nil {
					outcome.FullContent = strings.TrimSpace(getContent())
					return outcome, finalUsage, err
				}
				outcome.FullContent = strings.TrimSpace(getContent())
				return outcome, finalUsage, nil
			}

			if event.Type == services.EventError {
				if err := writeAndFlush("data: " + event.Message + "\n\n"); err != nil {
					outcome.FullContent = strings.TrimSpace(getContent())
					return outcome, finalUsage, err
				}
				continue
			}

			delta := map[string]string{"content": ""}
			if event.Type == services.EventTextDelta {
				delta["content"] = event.Delta
				contentMu.Lock()
				fullContent.WriteString(event.Delta)
				contentMu.Unlock()
			} else if event.Type == services.EventReasoningDelta {
				delta["reasoning_content"] = event.Delta
				// 推理内容也累积到完整内容中（保存时需要）
				contentMu.Lock()
				fullContent.WriteString(event.Delta)
				contentMu.Unlock()
			}

			if delta["content"] != "" || delta["reasoning_content"] != "" {
				out, _ := json.Marshal(map[string]interface{}{
					"choices": []map[string]interface{}{
						{"delta": delta},
					},
				})
				if err := writeAndFlush("data: " + string(out) + "\n\n"); err != nil {
					outcome.FullContent = strings.TrimSpace(getContent())
					return outcome, finalUsage, err
				}
			}
		}
	}
}

// ---- 辅助方法：非流式调用 AI 并返回完整内容 ----
func (h *ChatHandler) callModel(ctx context.Context, modelID string, messages []services.Message, reasoning bool, reasoningEffort string, search bool) (string, error) {
	resp, err := h.aiService.ChatCompletion(ctx, modelID, messages, false, reasoning, reasoningEffort, search)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if services.IsOpenAIResponsesModel(modelID) {
		// Responses API 非流式响应
		var result map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
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

		// 如果有 reasoning summary，包装为  标签格式
		if reasoningSummary != "" {
			finalContent = " " + reasoningSummary + " " + finalContent
		}

		if finalContent == "" {
			return "", fmt.Errorf("Responses API 返回空文本")
		}
		return finalContent, nil
	}

	// Chat Completions 非流式响应：choices[0].message.content
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
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

	// ========== 匿名用户检查 ==========
	userID, guestID, ok := requireGuestOrUser(c, h.cfg, h.db)
	if !ok {
		return
	}
	// ========== 匿名用户检查结束 ==========

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

	// ========== 文件上下文注入（与主 Chat 保持一致，使用 buildFileContext 分离图片与文档路径） ==========
	filePlan := ChatFilePlan{}
	if h.fileService != nil {
		chatReq := ChatRequest{
			MessageFileIDs: req.MessageFileIDs,
			ContextFileIDs: req.ContextFileIDs,
			ContextPolicy:  req.ContextPolicy,
			FileIDs:        req.FileIDs,
			ConversationID: req.ConversationID,
			Messages:       messages,
		}
		filePlan = h.buildChatFilePlan(chatReq, userID, guestID)
	}

	if len(filePlan.RAGFiles) > 0 {
		// 检查文件是否解析完成
		for _, f := range filePlan.RAGFiles {
			if f.ParseStatus != "done" {
				c.JSON(http.StatusConflict, gin.H{"error": "file_not_ready", "message": "文件正在解析中，请稍后重试", "file_id": f.PublicID, "status": f.ParseStatus})
				return
			}
		}

		ragFileNames := makeFileNameMap(filePlan.RAGFiles)
		fileContext := h.buildFileContext(filePlan.RAGFiles, ragFileNames, req.Query, "compare", false, "Compare")
		if fileContext != "" {
			fileMsg := services.Message{Role: "system", Content: fileContext}
			messages = append([]services.Message{fileMsg}, messages...)
		}

		// 保存文件与会话的关联
		allFiles := appendUniqueFiles(nil, filePlan.MessageFiles...)
		allFiles = appendUniqueFiles(allFiles, filePlan.ContextFiles...)
		h.upsertConversationFiles(req.ConversationID, allFiles)
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
	if userID > 0 || guestID != "" {
		if req.ConversationID > 0 {
			// 已有对比对话，追加消息
			var conv models.Conversation
			q := h.db.Where("id = ?", req.ConversationID)
			if userID > 0 {
				q = q.Where("user_id = ?", userID)
			} else {
				q = q.Where("guest_id = ?", guestID)
			}
			if err := q.First(&conv).Error; err == nil {
				conversationID = conv.ID

				// 保存用户消息
				msg := models.Message{
					ConversationID: conv.ID,
					Role:           "user",
					Content:        req.Query,
					CreatedAt:      time.Now(),
				}
				h.db.Create(&msg)
				if len(filePlan.MessageFiles) > 0 {
					h.saveMessageFiles(msg.ID, filePlan.MessageFiles)
				}
			}
		} else {
			// 创建新的对比对话
			title := req.Query
			if len(title) > 20 {
				title = title[:20] + "..."
			}
			conv := models.Conversation{
				UserID:        userID,
				GuestID:       guestID,
				Title:         title,
				Model:         req.ModelIDs[0],
				WorkspaceID:   req.WorkspaceID,
				Compare:       true,
				CompareModels: mustJSON(req.ModelIDs),
			}
			h.db.Create(&conv)
			conversationID = conv.ID

			// 保存用户消息
			msg := models.Message{
				ConversationID: conv.ID,
				Role:           "user",
				Content:        req.Query,
				CreatedAt:      time.Now(),
			}
			h.db.Create(&msg)
			if len(filePlan.MessageFiles) > 0 {
				h.saveMessageFiles(msg.ID, filePlan.MessageFiles)
			}
		}
	}

	// compare 新建会话时，前面的 upsertConversationFiles 还不知道 conversationID；这里再做一次，已有会话会被唯一索引去重。
	if conversationID > 0 {
		allFiles := appendUniqueFiles(nil, filePlan.MessageFiles...)
		allFiles = appendUniqueFiles(allFiles, filePlan.ContextFiles...)
		h.upsertConversationFiles(conversationID, allFiles)
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
