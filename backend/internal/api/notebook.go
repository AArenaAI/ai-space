package api

import (
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type NotebookHandler struct {
	db           *gorm.DB
	fileService  *services.FileService
	aiService    chatAIService
	imageService *services.ImageService
}

func NewNotebookHandler(db *gorm.DB, fileService *services.FileService, aiService chatAIService, imageService *services.ImageService) *NotebookHandler {
	return &NotebookHandler{db: db, fileService: fileService, aiService: aiService, imageService: imageService}
}

type NotebookListItem struct {
	models.Notebook
	FileCount int64         `json:"file_count"`
	Files     []models.File `json:"files,omitempty"`
}

type NotebookFileItem struct {
	ID         uint        `json:"id"`
	NotebookID uint        `json:"notebook_id"`
	FileID     uint        `json:"file_id"`
	SortOrder  int         `json:"sort_order"`
	CreatedAt  time.Time   `json:"created_at"`
	UpdatedAt  time.Time   `json:"updated_at"`
	File       models.File `json:"file"`
}

type NotebookFileContentResponse struct {
	File    NotebookFileContentMeta    `json:"file"`
	Text    string                     `json:"content"`
	Chunks  []NotebookFileContentChunk `json:"chunks"`
	HasMore bool                       `json:"has_more"`
}

type NotebookFileContentMeta struct {
	ID              uint      `json:"id"`
	PublicID        string    `json:"public_id"`
	Filename        string    `json:"filename"`
	MimeType        string    `json:"mime_type"`
	Size            int64     `json:"size"`
	ParseStatus     string    `json:"parse_status"`
	EmbeddingStatus string    `json:"embedding_status"`
	ErrorMessage    string    `json:"error_message,omitempty"`
	Summary         string    `json:"summary,omitempty"`
	PageCount       int       `json:"page_count,omitempty"`
	TokenCount      int       `json:"token_count,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type NotebookFileContentChunk struct {
	Index     int    `json:"index"`
	Page      int    `json:"page,omitempty"`
	Slide     int    `json:"slide,omitempty"`
	SheetName string `json:"sheet_name,omitempty"`
	BlockType string `json:"block_type,omitempty"`
	Content   string `json:"content"`
}

type NotebookArtifactResponse struct {
	ID          uint            `json:"id"`
	NotebookID  uint            `json:"notebook_id"`
	Type        string          `json:"type"`
	Title       string          `json:"title"`
	Subtitle    string          `json:"subtitle"`
	Content     json.RawMessage `json:"content"`
	SourceCount int             `json:"source_count"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

func (h *NotebookHandler) List(c *gin.Context) {
	userID := getUserID(c)
	workspaceID := parseUintQuery(c, "workspace_id")

	query := h.db.Model(&models.Notebook{}).Where("user_id = ?", userID)
	if workspaceID > 0 {
		query = query.Where("workspace_id = ?", workspaceID)
	}

	var notebooks []models.Notebook
	if err := query.Order("updated_at DESC").Find(&notebooks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取笔记本列表失败"})
		return
	}

	items := make([]NotebookListItem, 0, len(notebooks))
	for _, nb := range notebooks {
		var count int64
		h.db.Model(&models.NotebookFile{}).Where("notebook_id = ?", nb.ID).Count(&count)
		items = append(items, NotebookListItem{Notebook: nb, FileCount: count})
	}
	c.JSON(http.StatusOK, gin.H{"notebooks": items})
}

func (h *NotebookHandler) Create(c *gin.Context) {
	userID := getUserID(c)
	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		CoverIcon   string `json:"cover_icon"`
		WorkspaceID uint   `json:"workspace_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "未命名笔记本"
	}
	workspaceID := req.WorkspaceID
	if workspaceID == 0 {
		workspaceID = defaultWorkspaceID(h.db, userID)
	}
	nb := models.Notebook{
		UserID:      userID,
		WorkspaceID: workspaceID,
		Title:       title,
		Description: strings.TrimSpace(req.Description),
		CoverIcon:   strings.TrimSpace(req.CoverIcon),
	}
	if nb.CoverIcon == "" {
		nb.CoverIcon = "book-open"
	}
	if err := h.db.Create(&nb).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建笔记本失败"})
		return
	}
	c.JSON(http.StatusOK, nb)
}

func (h *NotebookHandler) Get(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	files := h.listNotebookFiles(nb.ID)
	c.JSON(http.StatusOK, gin.H{"notebook": nb, "files": files})
}

func (h *NotebookHandler) Update(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	var req struct {
		Title       *string `json:"title"`
		Description *string `json:"description"`
		CoverIcon   *string `json:"cover_icon"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	updates := map[string]any{}
	if req.Title != nil && strings.TrimSpace(*req.Title) != "" {
		updates["title"] = strings.TrimSpace(*req.Title)
	}
	if req.Description != nil {
		updates["description"] = strings.TrimSpace(*req.Description)
	}
	if req.CoverIcon != nil {
		updates["cover_icon"] = strings.TrimSpace(*req.CoverIcon)
	}
	if len(updates) > 0 {
		if err := h.db.Model(&nb).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "更新笔记本失败"})
			return
		}
	}
	c.JSON(http.StatusOK, nb)
}

func (h *NotebookHandler) Delete(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("notebook_id = ?", nb.ID).Delete(&models.NotebookFile{}).Error; err != nil {
			return err
		}
		if err := tx.Where("notebook_id = ?", nb.ID).Delete(&models.NotebookConversation{}).Error; err != nil {
			return err
		}
		return tx.Delete(&nb).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除笔记本失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *NotebookHandler) ListFiles(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"files": h.listNotebookFiles(nb.ID)})
}

func (h *NotebookHandler) AddFile(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	userID := getUserID(c)
	var req struct {
		PublicID  string `json:"public_id"`
		SortOrder int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	publicID := strings.TrimSpace(req.PublicID)
	if publicID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少文件 ID"})
		return
	}
	var file models.File
	if err := h.db.Where("public_id = ? AND user_id = ?", publicID, userID).First(&file).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在或无权访问"})
		return
	}
	if nb.WorkspaceID > 0 && file.WorkspaceID > 0 && nb.WorkspaceID != file.WorkspaceID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件不属于当前工作区"})
		return
	}
	link := models.NotebookFile{NotebookID: nb.ID, FileID: file.ID, SortOrder: req.SortOrder}
	if err := h.db.Where("notebook_id = ? AND file_id = ?", nb.ID, file.ID).FirstOrCreate(&link).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "添加资料失败"})
		return
	}
	h.db.Model(&models.Notebook{}).Where("id = ?", nb.ID).Update("updated_at", time.Now())
	link.File = file
	c.JSON(http.StatusOK, link)
}

func (h *NotebookHandler) AddURLSource(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	if h.fileService == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "资料处理服务暂不可用"})
		return
	}
	userID := getUserID(c)
	var req struct {
		URL       string `json:"url"`
		SortOrder int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	inputURL := strings.TrimSpace(req.URL)
	if inputURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请输入网页链接"})
		return
	}
	page, err := fetchNotebookURLSource(c.Request.Context(), inputURL)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	filename := notebookURLSourceFilename(page.Title, page.URL)
	content := fmt.Sprintf("# %s\n\n来源：%s\n\n%s\n", page.Title, page.URL, page.Content)
	file, err := h.fileService.UploadAndParse(c.Request.Context(), userID, "", filename, []byte(content), nb.WorkspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "网页资料处理失败"})
		return
	}
	link := models.NotebookFile{NotebookID: nb.ID, FileID: file.ID, SortOrder: req.SortOrder}
	if err := h.db.Where("notebook_id = ? AND file_id = ?", nb.ID, file.ID).FirstOrCreate(&link).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "添加网页资料失败"})
		return
	}
	h.db.Model(&models.Notebook{}).Where("id = ?", nb.ID).Update("updated_at", time.Now())
	link.File = *file
	c.JSON(http.StatusOK, link)
}

func (h *NotebookHandler) GetFileContent(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	fileIDParam := c.Param("file_id")
	fid64, err := strconv.ParseUint(fileIDParam, 10, 32)
	if err != nil || fid64 == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的文件 ID"})
		return
	}

	var link models.NotebookFile
	if err := h.db.Preload("File").Where("notebook_id = ? AND file_id = ?", nb.ID, uint(fid64)).First(&link).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "资料不存在或无权访问"})
		return
	}
	file := link.File
	content := file.Content
	hasMore := false
	const maxContentChars = 120000
	if len(content) > maxContentChars {
		content = content[:maxContentChars]
		hasMore = true
	}

	var chunks []models.FileChunk
	h.db.Where("file_id = ?", file.ID).Order("chunk_index ASC").Limit(200).Find(&chunks)
	chunkItems := make([]NotebookFileContentChunk, 0, len(chunks))
	for _, chunk := range chunks {
		text := strings.TrimSpace(chunk.Markdown)
		if text == "" {
			text = strings.TrimSpace(chunk.Content)
		}
		if text == "" {
			continue
		}
		if len(text) > 8000 {
			text = text[:8000]
		}
		chunkItems = append(chunkItems, NotebookFileContentChunk{
			Index:     chunk.ChunkIndex,
			Page:      chunk.Page,
			Slide:     chunk.Slide,
			SheetName: chunk.SheetName,
			BlockType: chunk.BlockType,
			Content:   text,
		})
	}

	c.JSON(http.StatusOK, NotebookFileContentResponse{
		File: NotebookFileContentMeta{
			ID:              file.ID,
			PublicID:        file.PublicID,
			Filename:        file.Filename,
			MimeType:        file.MimeType,
			Size:            file.Size,
			ParseStatus:     file.ParseStatus,
			EmbeddingStatus: file.EmbeddingStatus,
			ErrorMessage:    file.ErrorMessage,
			Summary:         file.Summary,
			PageCount:       file.PageCount,
			TokenCount:      file.TokenCount,
			CreatedAt:       file.CreatedAt,
			UpdatedAt:       file.UpdatedAt,
		},
		Text:    content,
		Chunks:  chunkItems,
		HasMore: hasMore,
	})
}

func (h *NotebookHandler) UpdateFile(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	fileIDParam := c.Param("file_id")
	fid64, err := strconv.ParseUint(fileIDParam, 10, 32)
	if err != nil || fid64 == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的文件 ID"})
		return
	}
	var req struct {
		Filename string `json:"filename"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	filename := strings.TrimSpace(req.Filename)
	if filename == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请输入来源名称"})
		return
	}
	if len([]rune(filename)) > 240 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "来源名称过长"})
		return
	}
	var link models.NotebookFile
	if err := h.db.Preload("File").Where("notebook_id = ? AND file_id = ?", nb.ID, uint(fid64)).First(&link).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "资料不存在或无权访问"})
		return
	}
	if link.File.UserID != nb.UserID {
		c.JSON(http.StatusNotFound, gin.H{"error": "资料不存在或无权访问"})
		return
	}
	if err := h.db.Model(&models.File{}).Where("id = ? AND user_id = ?", link.File.ID, nb.UserID).Update("filename", filename).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "重命名资料失败"})
		return
	}
	h.db.Model(&models.Notebook{}).Where("id = ?", nb.ID).Update("updated_at", time.Now())
	link.File.Filename = filename
	c.JSON(http.StatusOK, link)
}

func (h *NotebookHandler) RemoveFile(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	fileIDParam := c.Param("file_id")
	fid64, err := strconv.ParseUint(fileIDParam, 10, 32)
	if err != nil || fid64 == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的文件 ID"})
		return
	}
	if err := h.db.Where("notebook_id = ? AND file_id = ?", nb.ID, uint(fid64)).Delete(&models.NotebookFile{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "移除资料失败"})
		return
	}
	h.db.Model(&models.Notebook{}).Where("id = ?", nb.ID).Update("updated_at", time.Now())
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *NotebookHandler) ListArtifacts(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	var artifacts []models.NotebookArtifact
	query := h.db.Where("notebook_id = ? AND user_id = ?", nb.ID, getUserID(c))
	if artifactType := strings.TrimSpace(c.Query("type")); artifactType != "" {
		query = query.Where("type = ?", artifactType)
	}
	if err := query.Order("created_at DESC").Limit(100).Find(&artifacts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取输出文件失败"})
		return
	}
	items := make([]NotebookArtifactResponse, 0, len(artifacts))
	for _, artifact := range artifacts {
		items = append(items, notebookArtifactResponse(artifact))
	}
	c.JSON(http.StatusOK, gin.H{"artifacts": items})
}

func (h *NotebookHandler) CreateArtifact(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	var req struct {
		Type        string          `json:"type"`
		Title       string          `json:"title"`
		Subtitle    string          `json:"subtitle"`
		Content     json.RawMessage `json:"content"`
		SourceCount int             `json:"source_count"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	artifactType := strings.TrimSpace(req.Type)
	title := strings.TrimSpace(req.Title)
	artifact, ok := h.saveNotebookArtifact(c, nb, artifactType, title, strings.TrimSpace(req.Subtitle), req.Content, req.SourceCount)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, notebookArtifactResponse(artifact))
}

func (h *NotebookHandler) SuggestReportFormats(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	var req struct {
		FileIDs  []uint `json:"file_ids"`
		Language string `json:"language"`
	}
	if err := c.ShouldBindJSON(&req); err != nil && err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	files := h.loadNotebookGenerationFiles(nb.ID, getUserID(c))
	formats := suggestAINotebookReportFormats(c.Request.Context(), h.aiService, files, req.FileIDs, req.Language)
	c.JSON(http.StatusOK, gin.H{"formats": formats})
}

func (h *NotebookHandler) GenerateArtifact(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	var req struct {
		Type        string `json:"type"`
		FileIDs     []uint `json:"file_ids"`
		Language    string `json:"language"`
		Orientation string `json:"orientation"`
		Style       string `json:"style"`
		DetailLevel string `json:"detail_level"`
		Prompt      string `json:"prompt"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	files := h.loadNotebookGenerationFiles(nb.ID, getUserID(c))
	opts := notebookArtifactGenerationOptions{
		Orientation: strings.TrimSpace(req.Orientation),
		Style:       strings.TrimSpace(req.Style),
		DetailLevel: strings.TrimSpace(req.DetailLevel),
		Prompt:      strings.TrimSpace(req.Prompt),
	}
	draft, err := buildAINotebookArtifactDraft(c.Request.Context(), h.aiService, h.imageService, req.Type, nb.Title, files, req.FileIDs, req.Language, opts)
	if err != nil {
		fmt.Printf("[Notebook Artifact] generate failed notebook_id=%d type=%s file_count=%d selected_files=%d error=%v\n", nb.ID, req.Type, len(files), len(req.FileIDs), err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	artifact, ok := h.saveNotebookArtifact(c, nb, draft.Type, draft.Title, draft.Subtitle, draft.Content, draft.SourceCount)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, notebookArtifactResponse(artifact))
}

func (h *NotebookHandler) UpdateArtifact(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	id, err := strconv.ParseUint(c.Param("artifact_id"), 10, 32)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输出文件 ID"})
		return
	}
	var req struct {
		Title    string `json:"title"`
		Subtitle string `json:"subtitle"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少输出文件标题"})
		return
	}
	if len(title) > 255 || len(req.Subtitle) > 255 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "输出文件标题过长"})
		return
	}
	var artifact models.NotebookArtifact
	if err := h.db.Where("id = ? AND notebook_id = ? AND user_id = ?", uint(id), nb.ID, getUserID(c)).First(&artifact).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "输出文件不存在或无权访问"})
		return
	}
	artifact.Title = title
	artifact.Subtitle = strings.TrimSpace(req.Subtitle)
	if err := h.db.Save(&artifact).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新输出文件失败"})
		return
	}
	h.db.Model(&models.Notebook{}).Where("id = ?", nb.ID).Update("updated_at", time.Now())
	c.JSON(http.StatusOK, notebookArtifactResponse(artifact))
}

func (h *NotebookHandler) DeleteArtifact(c *gin.Context) {
	nb, ok := h.loadNotebook(c)
	if !ok {
		return
	}
	id, err := strconv.ParseUint(c.Param("artifact_id"), 10, 32)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输出文件 ID"})
		return
	}
	result := h.db.Where("id = ? AND notebook_id = ? AND user_id = ?", uint(id), nb.ID, getUserID(c)).Delete(&models.NotebookArtifact{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除输出文件失败"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "输出文件不存在或无权访问"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *NotebookHandler) saveNotebookArtifact(c *gin.Context, nb models.Notebook, artifactType string, title string, subtitle string, rawContent json.RawMessage, sourceCount int) (models.NotebookArtifact, bool) {
	artifactType = strings.TrimSpace(artifactType)
	title = strings.TrimSpace(title)
	if artifactType == "" || len(artifactType) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输出类型"})
		return models.NotebookArtifact{}, false
	}
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少输出文件标题"})
		return models.NotebookArtifact{}, false
	}
	content := []byte(strings.TrimSpace(string(rawContent)))
	if len(content) == 0 || string(content) == "null" {
		content = []byte("{}")
	}
	if len(content) > 1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "输出文件内容过大"})
		return models.NotebookArtifact{}, false
	}
	var decoded any
	if err := json.Unmarshal(content, &decoded); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "输出文件内容不是有效 JSON"})
		return models.NotebookArtifact{}, false
	}
	artifact := models.NotebookArtifact{
		NotebookID:  nb.ID,
		UserID:      getUserID(c),
		Type:        artifactType,
		Title:       title,
		Subtitle:    strings.TrimSpace(subtitle),
		Content:     string(content),
		SourceCount: sourceCount,
	}
	if artifact.SourceCount < 0 {
		artifact.SourceCount = 0
	}
	if err := h.db.Create(&artifact).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存输出文件失败"})
		return models.NotebookArtifact{}, false
	}
	h.db.Model(&models.Notebook{}).Where("id = ?", nb.ID).Update("updated_at", time.Now())
	return artifact, true
}

func (h *NotebookHandler) loadNotebookGenerationFiles(notebookID uint, userID uint) []models.File {
	var files []models.File
	h.db.Table("notebook_files").
		Select("files.*").
		Joins("JOIN files ON files.id = notebook_files.file_id").
		Where("notebook_files.notebook_id = ? AND files.user_id = ?", notebookID, userID).
		Order("notebook_files.sort_order ASC, notebook_files.id DESC").
		Scan(&files)
	return files
}

func notebookArtifactResponse(artifact models.NotebookArtifact) NotebookArtifactResponse {
	content := json.RawMessage(strings.TrimSpace(artifact.Content))
	if len(content) == 0 {
		content = json.RawMessage("{}")
	}
	return NotebookArtifactResponse{
		ID: artifact.ID, NotebookID: artifact.NotebookID, Type: artifact.Type,
		Title: artifact.Title, Subtitle: artifact.Subtitle, Content: content,
		SourceCount: artifact.SourceCount, CreatedAt: artifact.CreatedAt, UpdatedAt: artifact.UpdatedAt,
	}
}

func (h *NotebookHandler) listNotebookFiles(notebookID uint) []NotebookFileItem {
	var links []models.NotebookFile
	if err := h.db.Preload("File").Where("notebook_id = ?", notebookID).Order("sort_order ASC, id DESC").Find(&links).Error; err != nil {
		return nil
	}
	items := make([]NotebookFileItem, 0, len(links))
	for _, link := range links {
		items = append(items, NotebookFileItem{
			ID: link.ID, NotebookID: link.NotebookID, FileID: link.FileID,
			SortOrder: link.SortOrder, CreatedAt: link.CreatedAt, UpdatedAt: link.UpdatedAt,
			File: link.File,
		})
	}
	return items
}

func (h *NotebookHandler) loadNotebook(c *gin.Context) (models.Notebook, bool) {
	userID := getUserID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的笔记本 ID"})
		return models.Notebook{}, false
	}
	var nb models.Notebook
	if err := h.db.Where("id = ? AND user_id = ?", uint(id), userID).First(&nb).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "笔记本不存在或无权访问"})
		return models.Notebook{}, false
	}
	return nb, true
}

func defaultWorkspaceID(db *gorm.DB, userID uint) uint {
	if userID == 0 {
		return 0
	}
	var ws models.Workspace
	if err := db.Where("user_id = ? AND is_default = ?", userID, true).First(&ws).Error; err == nil {
		return ws.ID
	}
	return 0
}

func parseUintQuery(c *gin.Context, key string) uint {
	value := c.Query(key)
	if value == "" {
		return 0
	}
	parsed, err := strconv.ParseUint(value, 10, 32)
	if err != nil {
		return 0
	}
	return uint(parsed)
}

type notebookURLPage struct {
	URL     string
	Title   string
	Content string
}

func fetchNotebookURLSource(ctx context.Context, rawURL string) (notebookURLPage, error) {
	parsed, err := url.ParseRequestURI(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return notebookURLPage{}, fmt.Errorf("请输入有效的网页链接")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return notebookURLPage{}, fmt.Errorf("仅支持 http 或 https 网页链接")
	}
	if isPrivateNotebookURLHost(parsed.Hostname()) {
		return notebookURLPage{}, fmt.Errorf("不支持添加内网或本机地址")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return notebookURLPage{}, fmt.Errorf("无法读取网页链接")
	}
	req.Header.Set("User-Agent", "AI-Space-Notebook/1.0")
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return notebookURLPage{}, fmt.Errorf("网页抓取失败，请稍后重试")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return notebookURLPage{}, fmt.Errorf("网页抓取失败，状态码 %d", resp.StatusCode)
	}
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if contentType != "" && !strings.Contains(contentType, "text/html") && !strings.Contains(contentType, "text/plain") {
		return notebookURLPage{}, fmt.Errorf("暂不支持这个网页内容类型")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return notebookURLPage{}, fmt.Errorf("读取网页内容失败")
	}
	title, content := extractNotebookURLText(string(body), parsed.String())
	if strings.TrimSpace(content) == "" || len(strings.TrimSpace(content)) < 80 {
		return notebookURLPage{}, fmt.Errorf("网页正文内容为空或过短")
	}
	return notebookURLPage{URL: parsed.String(), Title: title, Content: content}, nil
}

func isPrivateNotebookURLHost(host string) bool {
	host = strings.TrimSpace(strings.ToLower(host))
	if host == "localhost" || host == "" {
		return true
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		return true
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return true
		}
	}
	return false
}

func extractNotebookURLText(html string, fallbackTitle string) (string, string) {
	text := html
	title := firstRegexGroup(`(?is)<title[^>]*>(.*?)</title>`, html)
	text = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`).ReplaceAllString(text, " ")
	text = regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`).ReplaceAllString(text, " ")
	text = regexp.MustCompile(`(?is)<noscript[^>]*>.*?</noscript>`).ReplaceAllString(text, " ")
	text = regexp.MustCompile(`(?is)</(p|div|section|article|header|footer|li|h[1-6]|tr)>`).ReplaceAllString(text, "\n")
	text = regexp.MustCompile(`(?is)<br\s*/?>`).ReplaceAllString(text, "\n")
	text = regexp.MustCompile(`(?is)<[^>]+>`).ReplaceAllString(text, " ")
	text = htmlEntityDecode(text)
	text = normalizeNotebookURLWhitespace(text)
	title = normalizeNotebookURLWhitespace(htmlEntityDecode(title))
	if title == "" {
		title = fallbackTitle
	}
	if len(text) > 120000 {
		text = text[:120000]
	}
	return title, text
}

func firstRegexGroup(pattern, text string) string {
	matches := regexp.MustCompile(pattern).FindStringSubmatch(text)
	if len(matches) < 2 {
		return ""
	}
	return matches[1]
}

func htmlEntityDecode(text string) string {
	replacements := map[string]string{
		"&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'",
	}
	for old, next := range replacements {
		text = strings.ReplaceAll(text, old, next)
	}
	return text
}

func normalizeNotebookURLWhitespace(text string) string {
	lines := strings.Split(text, "\n")
	var out []string
	for _, line := range lines {
		line = strings.Join(strings.Fields(line), " ")
		if line != "" {
			out = append(out, line)
		}
	}
	return strings.Join(out, "\n")
}

func notebookURLSourceFilename(title string, sourceURL string) string {
	name := strings.TrimSpace(title)
	if name == "" {
		name = sourceURL
	}
	name = regexp.MustCompile(`[^\p{Han}\p{L}\p{N}._-]+`).ReplaceAllString(name, "-")
	name = strings.Trim(name, "-._")
	if name == "" {
		name = "web-source"
	}
	if len(name) > 80 {
		name = name[:80]
	}
	return name + ".md"
}

func (h *ChatHandler) loadNotebookFiles(notebookID uint, userID uint, guestID string) []models.File {
	if notebookID == 0 || userID == 0 {
		return nil
	}
	var files []models.File
	query := h.db.Table("notebook_files").
		Select("files.*").
		Joins("JOIN notebooks ON notebooks.id = notebook_files.notebook_id").
		Joins("JOIN files ON files.id = notebook_files.file_id").
		Where("notebook_files.notebook_id = ? AND notebooks.user_id = ?", notebookID, userID).
		Order("notebook_files.sort_order ASC, notebook_files.id DESC")
	if guestID != "" {
		query = query.Where("files.guest_id = ? OR files.user_id = ?", guestID, userID)
	}
	if err := query.Scan(&files).Error; err != nil {
		return nil
	}
	return files
}

func (h *ChatHandler) attachNotebookConversation(notebookID uint, conversationID uint, userID uint) {
	if notebookID == 0 || conversationID == 0 || userID == 0 {
		return
	}
	var count int64
	if err := h.db.Model(&models.Notebook{}).Where("id = ? AND user_id = ?", notebookID, userID).Count(&count).Error; err != nil || count == 0 {
		return
	}
	link := models.NotebookConversation{NotebookID: notebookID, ConversationID: conversationID}
	h.db.Where("notebook_id = ? AND conversation_id = ?", notebookID, conversationID).FirstOrCreate(&link)
}
