package api

import (
	"aipool-backend/internal/models"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type NotebookHandler struct {
	db *gorm.DB
}

func NewNotebookHandler(db *gorm.DB) *NotebookHandler {
	return &NotebookHandler{db: db}
}

type NotebookListItem struct {
	models.Notebook
	FileCount int64        `json:"file_count"`
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
