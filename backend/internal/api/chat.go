package api

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"aipool-backend/internal/skills"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
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
	fileContext    *services.FileContextOrchestrator
	usageService   *services.UsageService
}

func NewChatHandler(db *gorm.DB, cfg *config.Config, aiService *services.AIService, searchService *services.SearchService, fileService *services.FileService, retrievalSvc *services.RetrievalService, contextBuilder *services.ContextBuilder, usageService *services.UsageService) *ChatHandler {
	return &ChatHandler{db: db, cfg: cfg, aiService: aiService, searchService: searchService, fileService: fileService, retrievalSvc: retrievalSvc, contextBuilder: contextBuilder, fileContext: services.NewFileContextOrchestrator(db, retrievalSvc, contextBuilder), usageService: usageService}
}

func (h *ChatHandler) touchConversation(conversationID uint) {
	if conversationID > 0 {
		h.db.Model(&models.Conversation{}).Where("id = ?", conversationID).Update("updated_at", time.Now())
	}
}

func (h *ChatHandler) createMessageGroup(conversationID uint, userMessageID uint, modelIDs []string) (*models.MessageGroup, error) {
	group := &models.MessageGroup{
		ConversationID: conversationID,
		UserMessageID:  userMessageID,
		CreatedAt:      time.Now(),
	}
	group.SetModels(modelIDs)
	if err := h.db.Create(group).Error; err != nil {
		return nil, err
	}
	return group, nil
}

func appendMissingStrings(values []string, extras ...string) []string {
	seen := make(map[string]struct{}, len(values)+len(extras))
	out := make([]string, 0, len(values)+len(extras))
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	for _, v := range extras {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
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
	GroupID         uint               `json:"group_id,omitempty"`           // 同一轮多模型回答复用的 MessageGroup
	GroupIndex      *int               `json:"group_index,omitempty"`        // 当前模型在组内的顺序
	GroupModels     []string           `json:"group_models,omitempty"`       // 本轮不可变模型快照
	UserMessageID   uint               `json:"user_message_id,omitempty"`    // skip_save_user_msg 时复用的用户消息
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

type ForkChatRequest struct {
	ModelIDs        []string `json:"models" binding:"required,min=1,max=4"`
	Reasoning       bool     `json:"reasoning"`
	ReasoningEffort string   `json:"reasoning_effort"`
	Search          bool     `json:"search"`
}

type CompareResult struct {
	ModelID   string `json:"model_id"`
	ModelName string `json:"model_name"`
	Content   string `json:"content"`
	Error     string `json:"error,omitempty"`
	ElapsedMs int64  `json:"elapsed_ms"`
	MessageID uint   `json:"message_id,omitempty"`
	GroupID   uint   `json:"group_id,omitempty"`
}

// 从 model_id 查找模型显示名（从 models_handler.go 的 SupportedModels）
func findModelName(modelID string) string {
	if model, ok := modelmeta.FindModelInfo(modelID); ok {
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

func modelIndex(models []string, model string) int {
	for i, m := range models {
		if m == model {
			return i
		}
	}
	return -1
}

type chatGroupContext struct {
	Group         *models.MessageGroup
	UserMessageID uint
	GroupIndex    int
	GroupModels   []string
}

func (h *ChatHandler) ensureMessageGroup(conversationID uint, req ChatRequest, savedUserMessageID uint) (*chatGroupContext, error) {
	modelsSnapshot := appendUniqueStrings(nil, req.GroupModels...)
	modelsSnapshot = appendUniqueStrings(modelsSnapshot, req.Model)

	userMessageID := savedUserMessageID
	if userMessageID == 0 {
		userMessageID = req.UserMessageID
	}
	if userMessageID == 0 && req.GroupID > 0 {
		var existing models.MessageGroup
		if err := h.db.Where("id = ? AND conversation_id = ?", req.GroupID, conversationID).First(&existing).Error; err != nil {
			return nil, err
		}
		userMessageID = existing.UserMessageID
		if len(req.GroupModels) == 0 {
			modelsSnapshot = appendUniqueStrings(existing.GetModels(), req.Model)
		}
	}
	if userMessageID == 0 {
		return nil, fmt.Errorf("缺少用户消息，无法创建消息组")
	}

	group := models.MessageGroup{}
	if req.GroupID > 0 {
		if err := h.db.Where("id = ? AND conversation_id = ?", req.GroupID, conversationID).First(&group).Error; err != nil {
			return nil, err
		}
		merged := appendUniqueStrings(group.GetModels(), modelsSnapshot...)
		if len(merged) > len(group.GetModels()) {
			group.SetModels(merged)
			h.db.Model(&group).Update("models", group.Models)
		}
		modelsSnapshot = group.GetModels()
	} else {
		if err := h.db.Where("conversation_id = ? AND user_message_id = ?", conversationID, userMessageID).First(&group).Error; err != nil {
			if err != gorm.ErrRecordNotFound {
				return nil, err
			}
			group = models.MessageGroup{ConversationID: conversationID, UserMessageID: userMessageID, CreatedAt: time.Now()}
			group.SetModels(modelsSnapshot)
			if err := h.db.Create(&group).Error; err != nil {
				return nil, err
			}
		} else {
			merged := appendUniqueStrings(group.GetModels(), modelsSnapshot...)
			if len(merged) > len(group.GetModels()) {
				group.SetModels(merged)
				h.db.Model(&group).Update("models", group.Models)
			}
		}
		modelsSnapshot = group.GetModels()
	}

	idx := modelIndex(modelsSnapshot, req.Model)
	if req.GroupIndex != nil {
		idx = *req.GroupIndex
	}
	if idx < 0 {
		idx = len(modelsSnapshot) - 1
	}
	return &chatGroupContext{Group: &group, UserMessageID: userMessageID, GroupIndex: idx, GroupModels: modelsSnapshot}, nil
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

const assistantHistoryTruncateThreshold = 1500
const assistantHistoryTruncateTo = 300

func truncateHistoryMessages(messages []services.Message) []services.Message {
	if len(messages) == 0 {
		return messages
	}
	result := make([]services.Message, len(messages))
	copy(result, messages)
	for i := range result {
		if result[i].Role == "assistant" && len(result[i].Content) > assistantHistoryTruncateThreshold {
			truncated := result[i].Content[:assistantHistoryTruncateTo]
			result[i].Content = truncated + "\n\n[前文已省略，如需回顾请重新提问]"
			fmt.Printf("[Chat] truncated assistant message[%d] from %d to %d chars\n", i, len(messages[i].Content), len(result[i].Content))
		}
	}
	return result
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

func applyFileContextPackage(messages []services.Message, pkg services.FileContextPackage) []services.Message {
	if pkg.SystemPrompt != "" {
		fileMsg := services.Message{Role: "system", Content: pkg.SystemPrompt}
		messages = append([]services.Message{fileMsg}, messages...)
	}
	if len(pkg.NativeParts) == 0 {
		return messages
	}
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != "user" {
			continue
		}
		for _, part := range pkg.NativeParts {
			if part.Type == "image" && strings.TrimSpace(part.DataURI) != "" {
				messages[i].Images = append(messages[i].Images, part.DataURI)
			} else if part.Type == "file" && strings.TrimSpace(part.DataURI) != "" {
				messages[i].Files = append(messages[i].Files, services.NativeFile{
					Filename: part.Filename,
					MimeType: part.MimeType,
					DataURI:  part.DataURI,
					FileID:   part.FileID,
				})
			}
		}
		return messages
	}
	return messages
}

func countMessageImages(messages []services.Message) int {
	total := 0
	for _, msg := range messages {
		total += len(msg.Images)
	}
	return total
}

func countMessageNativeFiles(messages []services.Message) int {
	total := 0
	for _, msg := range messages {
		total += len(msg.Files)
	}
	return total
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
	MessageFiles    []models.File // 当前消息附件，写 message_files，并走 direct context
	ContextFiles    []models.File // 显式上下文文件，不展示在消息，走历史/补充上下文
	HistoricalFiles []models.File // 本轮可作为补充上下文的历史文件
}

func (h *ChatHandler) buildChatFilePlan(req ChatRequest, userID uint, guestID string) ChatFilePlan {
	messagePublicIDs := req.MessageFileIDs
	if len(messagePublicIDs) == 0 && len(req.FileIDs) > 0 {
		// 兼容旧前端：旧 file_ids 按当前消息附件处理
		messagePublicIDs = req.FileIDs
	}

	_, _, messageFiles := h.resolveChatFiles(messagePublicIDs, userID, guestID)
	_, _, contextFiles := h.resolveChatFiles(req.ContextFileIDs, userID, guestID)

	// 当前消息显式带了附件时，进入“当前附件隔离模式”：
	// 只回答本轮上传/附加的文件，不把历史会话文件或显式 context_file_ids 混进来。
	// 目标效果：上传 A 回答 A；下一轮上传 B 回答 B，而不是被 A 的历史上下文污染。
	isCurrentAttachmentTurn := len(messageFiles) > 0

	historicalFiles := appendUniqueFiles(nil, contextFiles...)
	if isCurrentAttachmentTurn {
		historicalFiles = nil
	}

	mode := req.ContextPolicy.UseConversationFiles
	if mode == "" {
		mode = "auto"
	}

	query := lastUserContent(req.Messages)
	shouldUseConversationFiles := false
	switch mode {
	case "always":
		shouldUseConversationFiles = !isCurrentAttachmentTurn
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
		historicalFiles = appendUniqueFiles(historicalFiles, conversationFiles...)
	}

	return ChatFilePlan{
		MessageFiles:    messageFiles,
		ContextFiles:    contextFiles,
		HistoricalFiles: historicalFiles,
	}
}

func (h *ChatHandler) saveMessageFiles(messageID uint, files []models.File) {
	for _, file := range files {
		ftype := "document"
		if isImageFile(file) {
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

func isImageFile(file models.File) bool {
	return file.MimeType == "image" || strings.HasPrefix(file.MimeType, "image/")
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
		isImage := isImageFile(file)
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

	if modelmeta.SupportsSearch(modelID) {
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

	if len(filePlan.MessageFiles) > 0 || len(filePlan.HistoricalFiles) > 0 {
		fileContextPackage := h.fileContext.Build(services.FileContextBuildRequest{
			CurrentFiles:    filePlan.MessageFiles,
			HistoricalFiles: filePlan.HistoricalFiles,
			Query:           query,
			Model:           req.Model,
			LogPrefix:       "Chat",
		})
		beforeNativeImages := countMessageImages(req.Messages)
		beforeNativeFiles := countMessageNativeFiles(req.Messages)
		req.Messages = applyFileContextPackage(req.Messages, fileContextPackage)
		fmt.Printf("[Chat FileContext] injected context usedFiles=%v nativeParts=%d nativeImagesAdded=%d nativeFilesAdded=%d warnings=%d systemPrompt=%v\n",
			fileContextPackage.UsedFileIDs,
			len(fileContextPackage.NativeParts),
			countMessageImages(req.Messages)-beforeNativeImages,
			countMessageNativeFiles(req.Messages)-beforeNativeFiles,
			len(fileContextPackage.Warnings),
			fileContextPackage.SystemPrompt != "",
		)

		// 保存文件与会话的关联：message_files + context_files 都进入 conversation_files 池
		allFiles := appendUniqueFiles(nil, filePlan.MessageFiles...)
		allFiles = appendUniqueFiles(allFiles, filePlan.ContextFiles...)
		h.upsertConversationFiles(req.ConversationID, allFiles)
	}
	// ========== 文件上下文注入结束 ==========

	// 保存用户消息（除非标记了跳过）
	savedUserMessageID := req.UserMessageID
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
			savedUserMessageID = msg.ID
			h.touchConversation(conversationID)

			// 保存消息-文件关联：只保存当前消息附件，避免历史文件污染新消息展示
			if len(filePlan.MessageFiles) > 0 {
				h.saveMessageFiles(msg.ID, filePlan.MessageFiles)
			}
		}
	}

	groupCtx, err := h.ensureMessageGroup(conversationID, req, savedUserMessageID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message_group_failed", "message": err.Error()})
		return
	}
	// ========== 保存消息与会话结束 ==========

	var searchSources []services.SearchResult
	var useSearchTool bool

	// 有文件上下文且问题是文件相关时，跳过联网搜索，避免搜索结果污染文件问答
	lastUserQuery := ""
	if len(req.Messages) > 0 {
		lastUserQuery = req.Messages[len(req.Messages)-1].Content
	}
	if (len(filePlan.MessageFiles) > 0 || len(filePlan.HistoricalFiles) > 0) && isFileQuestion(lastUserQuery) {
		fmt.Printf("[Chat] 文件问答模式，跳过联网搜索 currentFiles=%d historicalFiles=%d query=%q\n", len(filePlan.MessageFiles), len(filePlan.HistoricalFiles), lastUserQuery)
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
	// 截断过长的历史 assistant 消息，防止旧文件总结污染新查询
	req.Messages = truncateHistoryMessages(req.Messages)

	// GPT 5.5 后台规则仍保留 stream=true：background=true + stream=true + webhook。
	// 从这里开始，流式生成彻底从 HTTP handler 拆出去：handler 只创建 task，runner 独立消费上游 stream，当前请求只是订阅 task events。
	useBackground := services.OpenAIUsesBackground(req.Model, services.ParseReasoningEffort(req.ReasoningEffort))

	if req.Stream {
		// 先创建一条空的 assistant 消息，确保即使用户跳转/刷新也能看到生成中的消息
		assistantMsg := models.Message{
			ConversationID: conversationID,
			Role:           "assistant",
			Content:        "",
			Model:          req.Model,
			GroupID:        groupCtx.Group.ID,
			GroupIndex:     groupCtx.GroupIndex,
			CreatedAt:      time.Now(),
		}
		if err := h.db.Create(&assistantMsg).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存 assistant 占位消息失败"})
			return
		}
		h.touchConversation(conversationID)
		assistantMsgID := assistantMsg.ID

		streamTask := h.createBackgroundTask(fmt.Sprintf("stream:%d", assistantMsgID), userID, guestID, conversationID, assistantMsgID, req.Model, "", "running", 0)
		if streamTask == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "创建生成任务失败"})
			return
		}

		metaOut, _ := json.Marshal(map[string]interface{}{
			"choices": []map[string]interface{}{
				{"delta": map[string]string{"content": ""}},
			},
			"_generation_task": map[string]interface{}{
				"id":                   streamTask.ID,
				"status":               "running",
				"conversation_id":      conversationID,
				"assistant_message_id": assistantMsgID,
				"user_message_id":      groupCtx.UserMessageID,
				"group_id":             groupCtx.Group.ID,
				"group_index":          groupCtx.GroupIndex,
				"group_models":         groupCtx.GroupModels,
			},
		})
		h.persistTaskEvent(streamTask, assistantMsgID, 1, "generation_task", string(metaOut))

		initialSequence := int64(1)
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
			initialSequence = 2
			h.persistTaskEvent(streamTask, assistantMsgID, initialSequence, "search_meta", string(out))
		}

		runnerReq := GenerationTaskRunRequest{
			Task:               streamTask,
			Messages:           append([]services.Message(nil), req.Messages...),
			Model:              req.Model,
			Reasoning:          req.Reasoning,
			ReasoningEffort:    req.ReasoningEffort,
			UseSearchTool:      useSearchTool,
			UseBackground:      useBackground,
			UserID:             userID,
			GuestID:            guestID,
			ConversationID:     conversationID,
			AssistantMessageID: assistantMsgID,
			InitialSequence:    initialSequence,
			SearchSources:      searchSources,
		}
		go h.runGenerationTask(runnerReq)

		// 当前 HTTP 请求不再直连上游模型，只订阅本地 task event stream。
		h.streamGenerationTaskEvents(c, streamTask, 0)
		return
	} else {
		resp, err := h.aiService.ChatCompletion(c.Request.Context(), req.Model, req.Messages, false, req.Reasoning, services.ParseReasoningEffort(req.ReasoningEffort), useSearchTool)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if resp.Background {
			h.handleBackgroundResponse(c, resp, conversationID, userID, guestID, req.Model, false)
			return
		}
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
							assistantMessage := models.Message{
								ConversationID: conversationID,
								Role:           "assistant",
								Content:        assistantContent,
								Model:          req.Model,
								GroupID:        groupCtx.Group.ID,
								GroupIndex:     groupCtx.GroupIndex,
								CompletedAt:    &[]time.Time{time.Now()}[0],
								CreatedAt:      time.Now(),
							}
							if len(searchSources) > 0 {
								if sourcesJSON, err := json.Marshal(searchSources); err == nil {
									assistantMessage.SearchSources = string(sourcesJSON)
									assistantMessage.SearchSourcesCount = len(searchSources)
								}
							}
							h.db.Create(&assistantMessage)
							h.touchConversation(conversationID)
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
		rawResp["group_id"] = groupCtx.Group.ID
		rawResp["group_index"] = groupCtx.GroupIndex
		rawResp["group_models"] = groupCtx.GroupModels
		body, _ = json.Marshal(rawResp)
		c.Writer.Write(body)
	}
}

// forwardUnifiedStream 统一流式转发：通过 decoder factory 获取对应解码器，
// 循环读取上游事件 → 转换 → 写入前端 SSE，返回完整内容和 usage。
func (h *ChatHandler) createBackgroundTask(responseID string, userID uint, guestID string, conversationID uint, assistantMessageID uint, model string, provider string, status string, lastSequenceNumber int64) *models.AIBackgroundTask {
	if responseID == "" {
		return nil
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
	if status == "completed" || status == "failed" || status == "cancelled" || status == "incomplete" {
		now := time.Now()
		task.CompletedAt = &now
	}
	if err := h.db.Where("response_id = ?", responseID).Assign(task).FirstOrCreate(&task).Error; err != nil {
		fmt.Printf("[Chat] 保存后台任务失败 response_id=%s: %v\n", responseID, err)
		return nil
	}
	return &task
}

type GenerationTaskRunRequest struct {
	Task               *models.AIBackgroundTask
	Messages           []services.Message
	Model              string
	Reasoning          bool
	ReasoningEffort    string
	UseSearchTool      bool
	UseBackground      bool
	UserID             uint
	GuestID            string
	ConversationID     uint
	AssistantMessageID uint
	InitialSequence    int64
	SearchSources      []services.SearchResult
}

func (h *ChatHandler) runGenerationTask(req GenerationTaskRunRequest) {
	if req.Task == nil || req.AssistantMessageID == 0 {
		return
	}
	ctx := context.Background()
	maxRetries := 3
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if h.isGenerationTaskCancelled(req.Task.ID) {
			return
		}
		if attempt > 0 {
			// 第一次失败后重试
			fmt.Printf("[GenerationRunner] task=%d 重试第%d次\n", req.Task.ID, attempt)
		}

		resp, err := h.aiService.ChatCompletion(ctx, req.Model, req.Messages, true, req.Reasoning, services.ParseReasoningEffort(req.ReasoningEffort), req.UseSearchTool)
		if err != nil {
			// 检查是否是 rate limit 错误，且还有重试次数
			if attempt < maxRetries {
				if pe := services.ParseOpenAIProviderError(err, req.Model); pe != nil && pe.Kind == services.ProviderErrorRateLimit && pe.RetryAfterMs > 0 {
					// 设置 retrying 状态，等待 Retry-After 后重试
					waitMs := pe.RetryAfterMs
					if waitMs < 1000 {
						waitMs = 1000
					}
					jitter := time.Duration(waitMs) * time.Millisecond
					if jitter > 60*time.Second {
						jitter = 60 * time.Second
					}
					h.db.Model(&models.AIBackgroundTask{}).Where("id = ?", req.Task.ID).Updates(map[string]interface{}{
						"status": "retrying",
					})
					fmt.Printf("[GenerationRunner] task=%d rate_limit 等待 %v 后重试\n", req.Task.ID, jitter)
					time.Sleep(jitter)
					continue
				}
			}
			// 非 rate limit 或重试次数用完
			h.failGenerationTask(req.Task, req.AssistantMessageID, req.ConversationID, fmt.Sprintf("上游模型请求失败: %v", err))
			return
		}
		defer resp.Body.Close()

		if resp.Provider != "" && req.Task.Provider != resp.Provider {
			h.db.Model(&models.AIBackgroundTask{}).Where("id = ?", req.Task.ID).Update("provider", resp.Provider)
			req.Task.Provider = resp.Provider
		}

		streamResult, usage, forwardErr := h.forwardUnifiedStream(resp, nil, req.Reasoning, req.AssistantMessageID, req.UseBackground, req.UserID, req.GuestID, req.ConversationID, req.Model, resp.Provider, req.Task, req.InitialSequence)
		if forwardErr != nil {
			fmt.Printf("[GenerationRunner] forwardUnifiedStream error task=%d message=%d: %v\n", req.Task.ID, req.AssistantMessageID, forwardErr)
		}

		// 检查是否是可恢复的 rate limit 流错误
		if streamResult.Recoverable && streamResult.ErrorKind == string(services.ProviderErrorRateLimit) {
			if attempt < maxRetries {
				// 关闭上一次响应 body
				resp.Body.Close()
				waitMs := streamResult.RetryAfterMs
				if waitMs <= 0 {
					waitMs = 2000
				}
				jitter := time.Duration(waitMs) * time.Millisecond
				if jitter > 60*time.Second {
					jitter = 60 * time.Second
				}
				h.db.Model(&models.AIBackgroundTask{}).Where("id = ?", req.Task.ID).Updates(map[string]interface{}{
					"status": "retrying",
				})
				fmt.Printf("[GenerationRunner] task=%d stream rate_limit 等待 %v 后重试\n", req.Task.ID, jitter)
				time.Sleep(jitter)
				continue
			}
		}

		// 成功完成或非可恢复错误
		content := streamResult.FullContent
		if streamResult.Recoverable && streamResult.ErrorKind == string(services.ProviderErrorRateLimit) {
			message := streamResult.ErrorMessage
			if strings.TrimSpace(message) == "" {
				message = "上游模型达到速率限制，自动重试已耗尽，请稍后重试或切换模型。"
			}
			h.failGenerationTaskWithMeta(req.Task, req.AssistantMessageID, req.ConversationID, message, streamResult.ErrorCode, streamResult.ErrorMeta)
			return
		}
		if forwardErr == nil && req.UseBackground && strings.TrimSpace(streamResult.ResponseID) != "" {
			finalContent, finalUsage, finalErr := h.reconcileOpenAIBackgroundFinal(ctx, req.Task, req.AssistantMessageID, streamResult.ResponseID, content, streamResult.LastSequenceNumber)
			if finalErr != nil {
				forwardErr = finalErr
				streamResult.ErrorMessage = finalErr.Error()
				fmt.Printf("[GenerationRunner] OpenAI background final reconcile failed task=%d response_id=%s: %v\n", req.Task.ID, streamResult.ResponseID, finalErr)
			} else {
				content = finalContent
				if finalUsage != nil {
					usage = finalUsage
				}
				streamResult.LastSequenceNumber = req.Task.LastSequenceNumber
			}
		}
		finalStatus := "completed"
		if forwardErr != nil {
			finalStatus = "failed"
			if content == "" {
				content = fmt.Sprintf("生成失败: %v", forwardErr)
			}
			seq := streamResult.LastSequenceNumber + 1
			if seq <= req.InitialSequence {
				seq = req.InitialSequence + 1
			}
			out, _ := json.Marshal(map[string]interface{}{
				"choices": []map[string]interface{}{
					{"delta": map[string]string{"content": ""}},
				},
				"_error_meta": map[string]interface{}{"user_message": forwardErr.Error(), "code": "stream_failed"},
			})
			h.persistTaskEvent(req.Task, req.AssistantMessageID, seq, "error", string(out))
			streamResult.LastSequenceNumber = seq
		} else if streamResult.ErrorMessage != "" {
			finalStatus = "incomplete"
			if strings.TrimSpace(content) == "" {
				content = ""
			}
		} else if strings.TrimSpace(content) == "" {
			content = "任务已完成，但未返回可展示文本。"
		}
		updates := map[string]interface{}{
			"content":      content,
			"completed_at": time.Now(),
		}
		if len(req.SearchSources) > 0 {
			if sourcesJSON, err := json.Marshal(req.SearchSources); err == nil {
				updates["search_sources"] = string(sourcesJSON)
				updates["search_sources_count"] = len(req.SearchSources)
			}
		}
		_ = h.db.Model(&models.Message{}).Where("id = ?", req.AssistantMessageID).Updates(updates).Error
		h.touchConversation(req.ConversationID)

		if forwardErr == nil {
			doneSeq := streamResult.LastSequenceNumber + 1
			if doneSeq <= req.InitialSequence {
				doneSeq = req.InitialSequence + 1
			}
			h.persistTaskEvent(req.Task, req.AssistantMessageID, doneSeq, "done", "[DONE]")
			streamResult.LastSequenceNumber = doneSeq
		}

		taskUpdates := map[string]interface{}{
			"status": finalStatus,
			"result": content,
		}
		if streamResult.ErrorMessage != "" {
			taskUpdates["error_message"] = streamResult.ErrorMessage
		} else if forwardErr != nil {
			taskUpdates["error_message"] = forwardErr.Error()
		}
		if streamResult.ResponseID != "" && req.UseBackground {
			taskUpdates["response_id"] = streamResult.ResponseID
		}
		if streamResult.LastSequenceNumber > 0 {
			taskUpdates["last_sequence_number"] = streamResult.LastSequenceNumber
		}
		now := time.Now()
		taskUpdates["completed_at"] = &now
		h.db.Model(&models.AIBackgroundTask{}).Where("id = ?", req.Task.ID).Updates(taskUpdates)

		if h.usageService != nil && usage != nil {
			if err := h.usageService.RecordChatUsageWithResourceID(req.UserID, req.GuestID, resp.Provider, resp.Model, resp.ModelType, req.ConversationID, usage); err != nil {
				fmt.Printf("[GenerationRunner] 记录 usage 失败: %v\n", err)
			}
		}
		return
	}
}

func (h *ChatHandler) reconcileOpenAIBackgroundFinal(ctx context.Context, task *models.AIBackgroundTask, assistantMessageID uint, responseID string, streamedContent string, lastSeq int64) (string, *services.TokenUsage, error) {
	if task == nil || assistantMessageID == 0 || strings.TrimSpace(responseID) == "" {
		return streamedContent, nil, nil
	}

	// OpenAI background+stream can close the streaming socket before the final
	// completed payload is fully reflected in deltas. Do not let that EOF become
	// frontend [DONE]; retrieve the authoritative final response, append any
	// missing suffix as normal delta events, then the caller writes DB + [DONE].
	var raw map[string]any
	var err error
	completed := false
	lastStatus := ""
	deadline := time.Now().Add(14*time.Minute + 15*time.Second)
	for attempt := 0; time.Now().Before(deadline); attempt++ {
		if h.isGenerationTaskCancelled(task.ID) {
			return streamedContent, nil, fmt.Errorf("generation cancelled")
		}
		retrieveCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		raw, err = h.aiService.RetrieveOpenAIResponse(retrieveCtx, responseID)
		cancel()
		if err == nil {
			status, _ := raw["status"].(string)
			lastStatus = strings.ToLower(strings.TrimSpace(status))
			if lastStatus == "completed" {
				completed = true
				break
			}
			if lastStatus == "failed" || lastStatus == "cancelled" || lastStatus == "incomplete" {
				return streamedContent, nil, fmt.Errorf("OpenAI response status=%s", lastStatus)
			}
		}
		wait := time.Duration(500+attempt*250) * time.Millisecond
		if wait > 5*time.Second {
			wait = 5 * time.Second
		}
		time.Sleep(wait)
	}
	if err != nil {
		return streamedContent, nil, err
	}
	if !completed {
		if lastStatus == "" {
			lastStatus = "unknown"
		}
		return streamedContent, nil, fmt.Errorf("OpenAI response not completed yet status=%s", lastStatus)
	}

	finalText := services.ExtractOpenAIResponseText(raw)
	if strings.TrimSpace(finalText) == "" {
		return streamedContent, parseUsageFromResponse(raw), nil
	}

	mergedContent := mergeReasoningPersistedContent(streamedContent, finalText)
	missing := missingContentSuffix(streamedContent, mergedContent)
	if strings.TrimSpace(missing) == "" {
		return mergedContent, parseUsageFromResponse(raw), nil
	}

	seq := lastSeq + 1
	if seq <= task.LastSequenceNumber {
		seq = task.LastSequenceNumber + 1
	}
	out, _ := json.Marshal(map[string]interface{}{
		"choices": []map[string]interface{}{
			{"delta": map[string]string{"content": missing}},
		},
		"_reconciled_final": true,
	})
	h.persistTaskEvent(task, assistantMessageID, seq, "delta", string(out))
	return mergedContent, parseUsageFromResponse(raw), nil
}

func missingContentSuffix(existing string, final string) string {
	existing = strings.TrimSpace(existing)
	final = strings.TrimSpace(final)
	if final == "" || existing == final || strings.Contains(existing, final) {
		return ""
	}
	if existing == "" {
		return final
	}
	if strings.HasPrefix(final, existing) {
		return strings.TrimPrefix(final, existing)
	}
	existingRunes := []rune(existing)
	finalRunes := []rune(final)
	maxOverlap := len(existingRunes)
	if len(finalRunes) < maxOverlap {
		maxOverlap = len(finalRunes)
	}
	for overlap := maxOverlap; overlap > 0; overlap-- {
		if string(existingRunes[len(existingRunes)-overlap:]) == string(finalRunes[:overlap]) {
			return string(finalRunes[overlap:])
		}
	}
	return final
}

func (h *ChatHandler) failGenerationTask(task *models.AIBackgroundTask, assistantMessageID uint, conversationID uint, message string) {
	h.failGenerationTaskWithMeta(task, assistantMessageID, conversationID, message, "generation_failed", nil)
}

func (h *ChatHandler) failGenerationTaskWithMeta(task *models.AIBackgroundTask, assistantMessageID uint, conversationID uint, message string, code string, meta map[string]interface{}) {
	if task == nil {
		return
	}
	if code == "" {
		code = "generation_failed"
	}
	if meta == nil {
		meta = map[string]interface{}{}
	}
	meta["user_message"] = message
	meta["code"] = code
	out, _ := json.Marshal(map[string]interface{}{
		"choices":     []map[string]interface{}{{"delta": map[string]string{"content": ""}}},
		"_error_meta": meta,
	})
	seq := task.LastSequenceNumber + 1
	if seq <= 1 {
		seq = 2
	}
	h.persistTaskEvent(task, assistantMessageID, seq, "error", string(out))
	h.persistTaskEvent(task, assistantMessageID, seq+1, "done", "[DONE]")
	now := time.Now()
	h.db.Model(&models.Message{}).Where("id = ?", assistantMessageID).Updates(map[string]interface{}{
		"content":      message,
		"completed_at": &now,
	})
	h.db.Model(&models.AIBackgroundTask{}).Where("id = ?", task.ID).Updates(map[string]interface{}{
		"status":               "failed",
		"error_message":        message,
		"result":               message,
		"last_sequence_number": seq + 1,
		"completed_at":         &now,
	})
	h.touchConversation(conversationID)
}

func (h *ChatHandler) persistTaskEvent(task *models.AIBackgroundTask, assistantMessageID uint, sequenceNumber int64, eventType string, payload string) {
	if assistantMessageID == 0 || sequenceNumber <= 0 || payload == "" {
		return
	}
	if task == nil {
		if err := h.db.Where("assistant_message_id = ?", assistantMessageID).Order("updated_at DESC, id DESC").First(&task).Error; err != nil {
			return
		}
	}
	event := models.AIBackgroundTaskEvent{
		TaskID:             task.ID,
		ResponseID:         task.ResponseID,
		ConversationID:     task.ConversationID,
		AssistantMessageID: assistantMessageID,
		SequenceNumber:     sequenceNumber,
		EventType:          eventType,
		Payload:            payload,
		CreatedAt:          time.Now(),
	}
	if err := h.db.Create(&event).Error; err != nil {
		fmt.Printf("[Chat] 保存任务事件失败 message_id=%d seq=%d: %v\n", assistantMessageID, sequenceNumber, err)
		return
	}
	h.db.Model(&models.AIBackgroundTask{}).Where("id = ? AND last_sequence_number < ?", task.ID, sequenceNumber).Update("last_sequence_number", sequenceNumber)
	task.LastSequenceNumber = sequenceNumber
}

func (h *ChatHandler) isGenerationTaskCancelled(taskID uint) bool {
	if taskID == 0 {
		return false
	}
	var status string
	if err := h.db.Model(&models.AIBackgroundTask{}).Where("id = ?", taskID).Select("status").Scan(&status).Error; err != nil {
		return false
	}
	return status == "cancelled"
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
	h.touchConversation(conversationID)

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
	ErrorMessage       string
	ErrorCode          string
	ErrorKind          string
	Recoverable        bool
	RetryAfterMs       int
	ErrorMeta          map[string]interface{}
}

func (h *ChatHandler) forwardUnifiedStream(resp *services.AICompletionResponse, w gin.ResponseWriter, reasoningEnabled bool, assistantMsgID uint, useBackground bool, userID uint, guestID string, conversationID uint, model string, provider string, streamTask *models.AIBackgroundTask, initialSequence int64) (*UnifiedStreamResult, *services.TokenUsage, error) {
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

	clientConnected := true
	outgoingSeq := initialSequence
	bytesSinceFlush := 0
	lastFlush := time.Now()
	writeAndFlush := func(payload string) error {
		if !clientConnected || w == nil {
			return nil
		}
		if _, err := w.WriteString(payload); err != nil {
			clientConnected = false
			fmt.Printf("[Chat] SSE client disconnected, generation continues in backend: %v\n", err)
			return nil
		}
		bytesSinceFlush += len(payload)
		if time.Since(lastFlush) > 5*time.Millisecond || bytesSinceFlush > 128 {
			w.Flush()
			lastFlush = time.Now()
			bytesSinceFlush = 0
		}
		return nil
	}
	defer func() {
		if bytesSinceFlush > 0 {
			w.Flush()
		}
	}()
	writeDataEvent := func(eventType string, payload map[string]interface{}) error {
		out, _ := json.Marshal(payload)
		outgoingSeq++
		h.persistTaskEvent(streamTask, assistantMsgID, outgoingSeq, eventType, string(out))
		outcome.LastSequenceNumber = outgoingSeq
		return writeAndFlush("data: " + string(out) + "\n\n")
	}
	writeDoneEvent := func() error {
		// In task-stream mode (w == nil), do not persist [DONE] here.
		// runGenerationTask must write final message.content first, then append the
		// terminal done event. If DONE is visible before the final DB update, the
		// frontend stops at a partial answer and only looks correct after refresh.
		if w == nil {
			return nil
		}
		outgoingSeq++
		h.persistTaskEvent(streamTask, assistantMsgID, outgoingSeq, "done", "[DONE]")
		outcome.LastSequenceNumber = outgoingSeq
		if !clientConnected {
			return nil
		}
		return writeAndFlush("data: [DONE]\n\n")
	}

	const heartbeatInterval = 15 * time.Second
	heartbeat := time.NewTicker(heartbeatInterval)
	defer heartbeat.Stop()

	var fullContent strings.Builder
	var reasoningPersistOpen bool
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
			if streamTask != nil && h.isGenerationTaskCancelled(streamTask.ID) {
				outcome.FullContent = strings.TrimSpace(getContent())
				return outcome, finalUsage, fmt.Errorf("generation cancelled")
			}
			event, err := result.event, result.err
			if err != nil {
				if err == io.EOF {
					// 部分 decoder（尤其 OpenAI Responses）会在读到流结束时同时返回
					// EventDone + io.EOF。不能先按 EOF return，否则不会持久化 done
					// event，task stream 只能靠 terminal 状态合成 [DONE]，容易在最后几段
					// delta 落库/可见前提前结束前端流。
					if event != nil && event.Type == services.EventDone {
						contentMu.Lock()
						if reasoningPersistOpen {
							fullContent.WriteString("</think>")
							reasoningPersistOpen = false
						}
						contentMu.Unlock()

						if err := writeDoneEvent(); err != nil {
							outcome.FullContent = strings.TrimSpace(getContent())
							return outcome, finalUsage, err
						}
					}
					outcome.FullContent = strings.TrimSpace(getContent())
					return outcome, finalUsage, nil
				}
				// 解析错误：向前端发送错误，不发 [DONE]
				_ = writeDataEvent("error", map[string]interface{}{
					"choices": []map[string]interface{}{
						{"delta": map[string]string{"content": fmt.Sprintf("❌ 上游流式响应解析失败: %v", err)}},
					},
				})
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
				if useBackground {
					// OpenAI background+stream 的 webhook 可能在前端流结束前就到达；
					// 必须把启动时的 stream:<message_id> task 原地升级为 response_id，避免同一 message 出现两个 task，续流查到“新 task 但无事件”。
					if streamTask != nil && streamTask.ResponseID != event.ResponseID {
						h.db.Model(&models.AIBackgroundTask{}).Where("id = ?", streamTask.ID).Updates(map[string]interface{}{
							"response_id":          event.ResponseID,
							"status":               "streaming",
							"last_sequence_number": outcome.LastSequenceNumber,
						})
						streamTask.ResponseID = event.ResponseID
						streamTask.Status = "streaming"
					} else if streamTask == nil {
						streamTask = h.createBackgroundTask(event.ResponseID, userID, guestID, conversationID, assistantMsgID, model, provider, "streaming", outcome.LastSequenceNumber)
					}
				}
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
				contentMu.Lock()
				if reasoningPersistOpen {
					fullContent.WriteString("</think>")
					reasoningPersistOpen = false
				}
				contentMu.Unlock()

				if err := writeDoneEvent(); err != nil {
					outcome.FullContent = strings.TrimSpace(getContent())
					return outcome, finalUsage, err
				}
				outcome.FullContent = strings.TrimSpace(getContent())
				return outcome, finalUsage, nil
			}

			if event.Type == services.EventError {
				message := event.Message
				if event.Provider == "gemini" || strings.Contains(strings.ToLower(event.Model), "gemini") {
					message = "Gemini服务商故障，本次生成中断，请稍后重试或切换模型。"
				} else if message == "" {
					message = "上游模型暂时不可用，请稍后重试。"
				}

				contentMu.Lock()
				if reasoningPersistOpen {
					fullContent.WriteString("</think>")
					reasoningPersistOpen = false
				}
				contentMu.Unlock()
				outcome.ErrorMessage = message
				outcome.ErrorCode = event.Code
				outcome.ErrorKind = event.ErrorKind
				outcome.Recoverable = event.Recoverable
				outcome.RetryAfterMs = event.RetryAfterMs

				meta := map[string]interface{}{
					"type":                "_error_meta",
					"provider":            event.Provider,
					"model":               event.Model,
					"category":            event.ErrorKind,
					"code":                event.Code,
					"limit_type":          event.LimitType,
					"limit":               event.LimitTokens,
					"used":                event.UsedTokens,
					"requested":           event.RequestedTokens,
					"retry_after_ms":      event.RetryAfterMs,
					"retry_after_seconds": float64(event.RetryAfterMs) / 1000,
					"retriable":           event.Recoverable,
					"user_message":        message,
					"suggested_actions":   event.SuggestedActions,
				}
				outcome.ErrorMeta = meta
				if err := writeDataEvent("error", map[string]interface{}{
					"choices": []map[string]interface{}{
						{"delta": map[string]string{"content": ""}},
					},
					"_error_meta": meta,
				}); err != nil {
					outcome.FullContent = strings.TrimSpace(getContent())
					return outcome, finalUsage, err
				}
				if err := writeDoneEvent(); err != nil {
					outcome.FullContent = strings.TrimSpace(getContent())
					return outcome, finalUsage, err
				}
				outcome.FullContent = strings.TrimSpace(getContent())
				return outcome, finalUsage, nil
			}

			activityKind := ""
			activityStatus := ""
			switch event.Type {
			case services.EventSearchStart:
				activityKind = "web_search"
				activityStatus = "searching"
			case services.EventSearchDone:
				activityKind = "web_search"
				activityStatus = "completed"
			case services.EventFileSearchStart:
				activityKind = "file_search"
				activityStatus = "searching"
			case services.EventFileSearchDone:
				activityKind = "file_search"
				activityStatus = "completed"
			case services.EventToolCallStart:
				activityKind = "tool_call"
				activityStatus = "running"
			case services.EventToolCallDone:
				activityKind = "tool_call"
				activityStatus = "completed"
			}
			if activityKind != "" {
				label := event.Delta
				if label == "" {
					label = activityKind
				}
				if err := writeDataEvent("activity_meta", map[string]interface{}{
					"choices": []map[string]interface{}{{"delta": map[string]string{"content": ""}}},
					"_activity_meta": map[string]interface{}{
						"kind":   activityKind,
						"status": activityStatus,
						"label":  label,
					},
				}); err != nil {
					outcome.FullContent = strings.TrimSpace(getContent())
					return outcome, finalUsage, err
				}
				continue
			}

			delta := map[string]string{"content": ""}
			if event.Type == services.EventTextDelta {
				delta["content"] = event.Delta
				contentMu.Lock()
				if reasoningPersistOpen {
					fullContent.WriteString("</think>")
					reasoningPersistOpen = false
				}
				fullContent.WriteString(event.Delta)
				contentMu.Unlock()
			} else if event.Type == services.EventReasoningDelta {
				delta["reasoning_content"] = event.Delta
				// reasoning summary 也持久化到 content 内，沿用前端已有 <think> 解析展示。
				// 这样刷新/重新打开会话后，思考区不会丢失。
				contentMu.Lock()
				if !reasoningPersistOpen {
					fullContent.WriteString("<think>")
					reasoningPersistOpen = true
				}
				fullContent.WriteString(event.Delta)
				contentMu.Unlock()
			}

			if delta["content"] != "" || delta["reasoning_content"] != "" {
				if err := writeDataEvent("delta", map[string]interface{}{
					"choices": []map[string]interface{}{
						{"delta": delta},
					},
				}); err != nil {
					outcome.FullContent = strings.TrimSpace(getContent())
					return outcome, finalUsage, err
				}
			}
		}
	}
}

func (h *ChatHandler) GetTask(c *gin.Context) {
	userID, guestID := getUserID(c), getGuestID(c)
	messageID := c.Param("message_id")

	var task models.AIBackgroundTask
	q := h.db.Where("assistant_message_id = ?", messageID)
	if userID > 0 {
		q = q.Where("user_id = ?", userID)
	} else if guestID != "" {
		q = q.Where("guest_id = ?", guestID)
	} else {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	if err := q.Order("updated_at DESC, id DESC").First(&task).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
		return
	}
	h.writeTaskSnapshot(c, task)
}

func (h *ChatHandler) GetGenerationTask(c *gin.Context) {
	task, ok := h.loadTaskByIDForRequest(c)
	if !ok {
		return
	}
	h.writeTaskSnapshot(c, task)
}

func (h *ChatHandler) StreamTaskEvents(c *gin.Context) {
	userID, guestID := getUserID(c), getGuestID(c)
	messageID := c.Param("message_id")
	after, _ := strconv.ParseInt(c.DefaultQuery("after", "0"), 10, 64)

	var task models.AIBackgroundTask
	q := h.db.Where("assistant_message_id = ?", messageID)
	if userID > 0 {
		q = q.Where("user_id = ?", userID)
	} else if guestID != "" {
		q = q.Where("guest_id = ?", guestID)
	} else {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	if err := q.Order("updated_at DESC, id DESC").First(&task).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
		return
	}

	h.streamGenerationTaskEvents(c, &task, after)
}

func (h *ChatHandler) StreamGenerationTaskEvents(c *gin.Context) {
	task, ok := h.loadTaskByIDForRequest(c)
	if !ok {
		return
	}
	after, _ := strconv.ParseInt(c.DefaultQuery("after", "0"), 10, 64)
	h.streamGenerationTaskEvents(c, &task, after)
}

func (h *ChatHandler) CancelGenerationTask(c *gin.Context) {
	task, ok := h.loadTaskByIDForRequest(c)
	if !ok {
		return
	}
	terminal := task.Status == "completed" || task.Status == "failed" || task.Status == "cancelled" || task.Status == "incomplete"
	if terminal {
		h.writeTaskSnapshot(c, task)
		return
	}
	message := "生成已停止"
	seq := task.LastSequenceNumber + 1
	if seq <= 1 {
		seq = 2
	}
	out, _ := json.Marshal(map[string]interface{}{
		"choices":     []map[string]interface{}{{"delta": map[string]string{"content": message}}},
		"_error_meta": map[string]interface{}{"user_message": message, "code": "cancelled"},
	})
	h.persistTaskEvent(&task, task.AssistantMessageID, seq, "cancelled", string(out))
	h.persistTaskEvent(&task, task.AssistantMessageID, seq+1, "done", "[DONE]")
	now := time.Now()
	h.db.Model(&models.Message{}).Where("id = ?", task.AssistantMessageID).Updates(map[string]interface{}{
		"completed_at": &now,
	})
	h.db.Model(&models.AIBackgroundTask{}).Where("id = ?", task.ID).Updates(map[string]interface{}{
		"status":               "cancelled",
		"error_message":        message,
		"last_sequence_number": seq + 1,
		"completed_at":         &now,
	})
	_ = h.db.First(&task, task.ID).Error
	h.writeTaskSnapshot(c, task)
}

func (h *ChatHandler) loadTaskByIDForRequest(c *gin.Context) (models.AIBackgroundTask, bool) {
	userID, guestID := getUserID(c), getGuestID(c)
	taskID := c.Param("task_id")
	var task models.AIBackgroundTask
	q := h.db.Where("id = ?", taskID)
	if userID > 0 {
		q = q.Where("user_id = ?", userID)
	} else if guestID != "" {
		q = q.Where("guest_id = ?", guestID)
	} else {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return task, false
	}
	if err := q.First(&task).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
		return task, false
	}
	return task, true
}

func (h *ChatHandler) writeTaskSnapshot(c *gin.Context, task models.AIBackgroundTask) {
	var msg models.Message
	_ = h.db.Where("id = ? AND conversation_id = ?", task.AssistantMessageID, task.ConversationID).First(&msg).Error
	c.JSON(http.StatusOK, gin.H{"task": task, "message": msg})
}

func (h *ChatHandler) streamGenerationTaskEvents(c *gin.Context, task *models.AIBackgroundTask, after int64) {
	if task == nil || task.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Writer.WriteHeaderNow()

	doneWritten := false
	writeEvent := func(event models.AIBackgroundTaskEvent) bool {
		var err error
		if event.Payload == "[DONE]" {
			if doneWritten {
				after = event.SequenceNumber
				return true
			}
			_, err = c.Writer.WriteString(fmt.Sprintf("id: %d\ndata: [DONE]\n\n", event.SequenceNumber))
			doneWritten = true
		} else {
			_, err = c.Writer.WriteString(fmt.Sprintf("id: %d\ndata: %s\n\n", event.SequenceNumber, event.Payload))
		}
		if err != nil {
			return false
		}
		c.Writer.Flush()
		after = event.SequenceNumber
		return true
	}

	// Keep the task event stream open slightly less than the 15-minute Nginx timeout.
	// OpenAI responses can continue generating in the backend after the initial /chat
	// stream is handed off; a 90s watcher timeout made the frontend think generation
	// was interrupted while DB/webhook completion arrived shortly after.
	deadline := time.Now().Add(14*time.Minute + 30*time.Second)
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		var events []models.AIBackgroundTaskEvent
		if err := h.db.Where("task_id = ? AND sequence_number > ?", task.ID, after).Order("sequence_number ASC").Find(&events).Error; err == nil {
			for _, event := range events {
				if !writeEvent(event) {
					return
				}
			}
		}

		if err := h.db.First(task, task.ID).Error; err == nil {
			terminal := task.Status == "completed" || task.Status == "failed" || task.Status == "cancelled" || task.Status == "incomplete"
			if terminal && after >= task.LastSequenceNumber {
				// Never synthesize a successful [DONE] from task status alone. In the
				// OpenAI background path the runner writes final missing deltas, then the
				// real done event, and only afterwards updates task.last_sequence_number.
				// If this subscriber races with those writes, a synthetic after+1 DONE can
				// overtake real tail deltas and make the frontend stop at a partial answer.
				if doneWritten {
					return
				}
				if task.Status != "completed" && task.ErrorMessage != "" {
					meta := map[string]interface{}{"_error_meta": map[string]interface{}{"user_message": task.ErrorMessage, "code": task.Status}}
					out, _ := json.Marshal(meta)
					_, _ = c.Writer.WriteString("data: " + string(out) + "\n\n")
					_, _ = c.Writer.WriteString(fmt.Sprintf("id: %d\ndata: [DONE]\n\n", after+1))
					c.Writer.Flush()
					return
				}
				// Completed without a visible done event means the writer has not made the
				// terminal event visible to this read yet. Keep the stream open and poll;
				// the timeout guard below still prevents an infinite hang.
			}
		}

		if time.Now().After(deadline) {
			_, _ = c.Writer.WriteString(":timeout\n\n")
			c.Writer.Flush()
			return
		}

		select {
		case <-c.Request.Context().Done():
			return
		case <-heartbeat.C:
			_, _ = c.Writer.WriteString(":ping\n\n")
			c.Writer.Flush()
		case <-time.After(700 * time.Millisecond):
		}
	}
}

// ---- 辅助方法：非流式调用 AI 并返回完整内容 ----
func (h *ChatHandler) callModel(ctx context.Context, modelID string, messages []services.Message, reasoning bool, reasoningEffort string, search bool) (string, error) {
	resp, err := h.aiService.ChatCompletion(ctx, modelID, messages, false, reasoning, services.ParseReasoningEffort(reasoningEffort), search)
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

		var finalContent string

		for _, o := range output {
			item, ok := o.(map[string]interface{})
			if !ok {
				continue
			}
			itemType, _ := item["type"].(string)

			if itemType == "reasoning" {
				// reasoning summary 只用于前端思考块/日志，不混入非流式正式正文。
				continue
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

	if len(filePlan.MessageFiles) > 0 || len(filePlan.HistoricalFiles) > 0 {
		fileContextPackage := h.fileContext.Build(services.FileContextBuildRequest{
			CurrentFiles:    nil,
			HistoricalFiles: filePlan.HistoricalFiles,
			Query:           req.Query,
			Model:           "compare",
			LogPrefix:       "Compare",
		})
		messages = applyFileContextPackage(messages, fileContextPackage)
		fmt.Printf("[Compare FileContext] injected historical context usedFiles=%v warnings=%d systemPrompt=%v\n",
			fileContextPackage.UsedFileIDs,
			len(fileContextPackage.Warnings),
			fileContextPackage.SystemPrompt != "",
		)

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
			baseMessages := messages
			if len(filePlan.MessageFiles) > 0 {
				currentPkg := h.fileContext.Build(services.FileContextBuildRequest{
					CurrentFiles:    filePlan.MessageFiles,
					HistoricalFiles: nil,
					Query:           req.Query,
					Model:           modelID,
					LogPrefix:       "Compare",
				})
				beforeImages := countMessageImages(baseMessages)
				baseMessages = applyFileContextPackage(baseMessages, currentPkg)
				fmt.Printf("[Compare FileContext] model=%s currentFiles=%d nativeParts=%d nativeImagesAdded=%d warnings=%d\n",
					modelID,
					len(filePlan.MessageFiles),
					len(currentPkg.NativeParts),
					countMessageImages(baseMessages)-beforeImages,
					len(currentPkg.Warnings),
				)
			}
			modelMessages := searchMessages
			useSearchTool := compareUseSearchTool
			if req.Search {
				modelMessages, _, useSearchTool = h.preprocessSearch(baseMessages, modelID, req.Search, c.ClientIP())
			} else {
				modelMessages = baseMessages
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
	var userMessageID uint
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
				if err := h.db.Create(&msg).Error; err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "保存用户消息失败"})
					return
				}
				userMessageID = msg.ID
				h.touchConversation(conv.ID)
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
			if err := h.db.Create(&conv).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "创建对话失败"})
				return
			}
			conversationID = conv.ID

			// 保存用户消息
			msg := models.Message{
				ConversationID: conv.ID,
				Role:           "user",
				Content:        req.Query,
				CreatedAt:      time.Now(),
			}
			if err := h.db.Create(&msg).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "保存用户消息失败"})
				return
			}
			userMessageID = msg.ID
			h.touchConversation(conv.ID)
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

	// 保存对比记录，并绑定到本轮 MessageGroup
	var groupID uint
	if conversationID > 0 && userMessageID > 0 {
		group, err := h.createMessageGroup(conversationID, userMessageID, req.ModelIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "创建消息组失败"})
			return
		}
		groupID = group.ID

		for idx, res := range ordered {
			now := time.Now()
			msg := models.Message{
				ConversationID: conversationID,
				Role:           "assistant",
				Content:        res.Content,
				Model:          res.ModelID,
				GroupID:        groupID,
				GroupIndex:     idx,
				CompletedAt:    &now,
				CreatedAt:      now,
			}
			if err := h.db.Create(&msg).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "保存对比消息失败"})
				return
			}
			ordered[idx].MessageID = msg.ID
			ordered[idx].GroupID = groupID
		}
		h.touchConversation(conversationID)
	}

	c.JSON(http.StatusOK, gin.H{
		"results":         ordered,
		"conversation_id": conversationID,
		"group_id":        groupID,
	})
}

func (h *ChatHandler) ForkChat(c *gin.Context) {
	messageID64, err := strconv.ParseUint(c.Param("message_id"), 10, 64)
	if err != nil || messageID64 == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的消息ID"})
		return
	}

	var req ForkChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, guestID, ok := requireGuestOrUser(c, h.cfg, h.db)
	if !ok {
		return
	}

	var source models.Message
	if err := h.db.First(&source, uint(messageID64)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "消息不存在"})
		return
	}

	var conv models.Conversation
	q := h.db.Where("id = ?", source.ConversationID)
	if userID > 0 {
		q = q.Where("user_id = ?", userID)
	} else {
		q = q.Where("guest_id = ?", guestID)
	}
	if err := q.First(&conv).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权访问该对话"})
		return
	}

	userMsg := source
	if source.Role != "user" {
		if err := h.db.Where("conversation_id = ? AND role = ? AND created_at < ?", source.ConversationID, "user", source.CreatedAt).
			Order("created_at DESC, id DESC").First(&userMsg).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未找到可对比的用户消息"})
			return
		}
	}
	if userMsg.Role != "user" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "只能从用户消息或其回答发起对比"})
		return
	}

	var group models.MessageGroup
	if source.GroupID > 0 {
		h.db.First(&group, source.GroupID)
	}
	if group.ID == 0 {
		if err := h.db.Where("conversation_id = ? AND user_message_id = ?", source.ConversationID, userMsg.ID).First(&group).Error; err != nil {
			existingModels := req.ModelIDs
			var existing []models.Message
			h.db.Where("conversation_id = ? AND role = ? AND created_at > ?", source.ConversationID, "assistant", userMsg.CreatedAt).
				Order("created_at ASC, id ASC").Find(&existing)
			for _, msg := range existing {
				if msg.Model != "" {
					existingModels = appendMissingStrings(existingModels, msg.Model)
				}
			}
			created, err := h.createMessageGroup(source.ConversationID, userMsg.ID, existingModels)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "创建消息组失败"})
				return
			}
			group = *created
			for idx, msg := range existing {
				if msg.GroupID == 0 {
					h.db.Model(&models.Message{}).Where("id = ?", msg.ID).Updates(map[string]interface{}{"group_id": group.ID, "group_index": idx})
				}
			}
		}
	}
	if group.ID == 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "消息组不可用"})
		return
	}

	groupModels := appendMissingStrings(group.GetModels(), req.ModelIDs...)
	group.SetModels(groupModels)
	if err := h.db.Save(&group).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新消息组失败"})
		return
	}

	var history []models.Message
	if err := h.db.Where("conversation_id = ? AND created_at <= ?", source.ConversationID, userMsg.CreatedAt).
		Order("created_at ASC, id ASC").Find(&history).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取上下文失败"})
		return
	}
	messages := make([]services.Message, 0, len(history))
	for _, msg := range history {
		if msg.Role == "user" || msg.Role == "assistant" || msg.Role == "system" {
			messages = append(messages, services.Message{Role: msg.Role, Content: msg.Content})
		}
	}
	if len(messages) == 0 {
		messages = []services.Message{{Role: "user", Content: userMsg.Content}}
	}

	type forkResult struct {
		index int
		res   CompareResult
	}
	results := make(chan forkResult, len(req.ModelIDs))
	ctx := c.Request.Context()
	searchMessages, _, useSearch := h.preprocessSearch(messages, req.ModelIDs[0], req.Search, c.ClientIP())
	for i, modelID := range req.ModelIDs {
		go func(idx int, modelID string) {
			start := time.Now()
			modelMessages := searchMessages
			modelUseSearch := useSearch
			if req.Search {
				modelMessages, _, modelUseSearch = h.preprocessSearch(messages, modelID, req.Search, c.ClientIP())
			}
			content, err := h.callModel(ctx, modelID, modelMessages, req.Reasoning, req.ReasoningEffort, modelUseSearch)
			res := CompareResult{ModelID: modelID, ModelName: findModelName(modelID), ElapsedMs: time.Since(start).Milliseconds(), GroupID: group.ID}
			if err != nil {
				res.Error = err.Error()
			} else {
				res.Content = content
			}
			results <- forkResult{index: idx, res: res}
		}(i, modelID)
	}

	ordered := make([]CompareResult, len(req.ModelIDs))
	for range req.ModelIDs {
		r := <-results
		ordered[r.index] = r.res
	}

	startIndex := len(group.GetModels()) - len(req.ModelIDs)
	if startIndex < 0 {
		startIndex = 0
	}
	for idx, res := range ordered {
		now := time.Now()
		msg := models.Message{
			ConversationID: source.ConversationID,
			Role:           "assistant",
			Content:        res.Content,
			Model:          res.ModelID,
			GroupID:        group.ID,
			GroupIndex:     startIndex + idx,
			CompletedAt:    &now,
			CreatedAt:      now,
		}
		if err := h.db.Create(&msg).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存 fork 消息失败"})
			return
		}
		ordered[idx].MessageID = msg.ID
		ordered[idx].GroupID = group.ID
	}

	h.db.Model(&models.Conversation{}).Where("id = ?", source.ConversationID).Updates(map[string]interface{}{"compare": true, "compare_models": mustJSON(group.GetModels())})
	h.touchConversation(source.ConversationID)

	c.JSON(http.StatusOK, gin.H{
		"results":         ordered,
		"conversation_id": source.ConversationID,
		"group_id":        group.ID,
		"models":          group.GetModels(),
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
