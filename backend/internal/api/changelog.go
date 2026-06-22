package api

import (
	"net/http"
	"strconv"
	"time"

	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ChangelogHandler 产品更新日志管理
type ChangelogHandler struct {
	DB *gorm.DB
}

// NewChangelogHandler 创建处理器
func NewChangelogHandler(db *gorm.DB) *ChangelogHandler {
	return &ChangelogHandler{DB: db}
}

// CreateChangelog 创建更新日志（admin）
func (h *ChangelogHandler) CreateChangelog(c *gin.Context) {
	var req struct {
		Version  string `json:"version" binding:"required"`
		Title    string `json:"title" binding:"required"`
		Content  string `json:"content" binding:"required"`
		Category string `json:"category" binding:"required"` // feature / fix / optimize / breaking
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	changelog := models.Changelog{
		Version:  req.Version,
		Title:    req.Title,
		Content:  req.Content,
		Category: req.Category,
	}
	if err := h.DB.Create(&changelog).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"changelog": changelog})
}

// UpdateChangelog 更新更新日志（admin）
func (h *ChangelogHandler) UpdateChangelog(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var changelog models.Changelog
	if err := h.DB.First(&changelog, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
		return
	}

	var req struct {
		Version  string `json:"version"`
		Title    string `json:"title"`
		Content  string `json:"content"`
		Category string `json:"category"`
		IsPinned *bool  `json:"is_pinned"`
		SortOrder *int  `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Version != "" {
		changelog.Version = req.Version
	}
	if req.Title != "" {
		changelog.Title = req.Title
	}
	if req.Content != "" {
		changelog.Content = req.Content
	}
	if req.Category != "" {
		changelog.Category = req.Category
	}
	if req.IsPinned != nil {
		changelog.IsPinned = *req.IsPinned
	}
	if req.SortOrder != nil {
		changelog.SortOrder = *req.SortOrder
	}

	if err := h.DB.Save(&changelog).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"changelog": changelog})
}

// PublishChangelog 发布更新日志（admin）
func (h *ChangelogHandler) PublishChangelog(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var changelog models.Changelog
	if err := h.DB.First(&changelog, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
		return
	}

	now := time.Now()
	changelog.IsPublished = true
	changelog.PublishedAt = &now

	if err := h.DB.Save(&changelog).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "发布失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"changelog": changelog})
}

// UnpublishChangelog 取消发布（admin）
func (h *ChangelogHandler) UnpublishChangelog(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var changelog models.Changelog
	if err := h.DB.First(&changelog, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
		return
	}

	changelog.IsPublished = false
	changelog.PublishedAt = nil

	if err := h.DB.Save(&changelog).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "操作失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"changelog": changelog})
}

// DeleteChangelog 删除更新日志（admin）
func (h *ChangelogHandler) DeleteChangelog(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if err := h.DB.Delete(&models.Changelog{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// ListChangelogsAdmin 后台列表（admin）
func (h *ChangelogHandler) ListChangelogsAdmin(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	category := c.Query("category")
	status := c.Query("status") // published / draft / all

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	var changelogs []models.Changelog
	var total int64

	query := h.DB.Model(&models.Changelog{})
	if category != "" {
		query = query.Where("category = ?", category)
	}
	if status == "published" {
		query = query.Where("is_published = ?", true)
	} else if status == "draft" {
		query = query.Where("is_published = ?", false)
	}

	query.Count(&total)
	query.Order("is_pinned DESC, sort_order ASC, published_at DESC, created_at DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&changelogs)

	c.JSON(http.StatusOK, gin.H{
		"changelogs": changelogs,
		"total":      total,
		"page":       page,
		"page_size":  pageSize,
	})
}

// ListChangelogsPublic 用户端列表（公开）
func (h *ChangelogHandler) ListChangelogsPublic(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	category := c.Query("category")

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 10
	}

	var changelogs []models.Changelog
	var total int64

	query := h.DB.Model(&models.Changelog{}).Where("is_published = ?", true)
	if category != "" {
		query = query.Where("category = ?", category)
	}

	query.Count(&total)
	query.Order("is_pinned DESC, sort_order ASC, published_at DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&changelogs)

	c.JSON(http.StatusOK, gin.H{
		"changelogs": changelogs,
		"total":      total,
		"page":       page,
		"page_size":  pageSize,
	})
}

// GetChangelogUnreadCount 获取未读更新数量
func (h *ChangelogHandler) GetChangelogUnreadCount(c *gin.Context) {
	userID := c.GetUint("userID")
	if userID == 0 {
		c.JSON(http.StatusOK, gin.H{"count": 0})
		return
	}

	var count int64
	h.DB.Model(&models.Changelog{}).
		Where("is_published = ?", true).
		Where("id NOT IN (SELECT changelog_id FROM changelog_reads WHERE user_id = ?)", userID).
		Count(&count)

	c.JSON(http.StatusOK, gin.H{"count": count})
}

// MarkChangelogRead 标记已读
func (h *ChangelogHandler) MarkChangelogRead(c *gin.Context) {
	userID := c.GetUint("userID")
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}

	id, _ := strconv.Atoi(c.Param("id"))
	var changelog models.Changelog
	if err := h.DB.First(&changelog, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
		return
	}

	// 检查是否已读
	var existing models.ChangelogRead
	if err := h.DB.Where("user_id = ? AND changelog_id = ?", userID, id).First(&existing).Error; err == nil {
		c.JSON(http.StatusOK, gin.H{"message": "已标记"})
		return
	}

	read := models.ChangelogRead{
		UserID:      userID,
		ChangelogID: uint(id),
		ReadAt:      time.Now(),
	}
	if err := h.DB.Create(&read).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "标记失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已标记已读"})
}

// MarkAllChangelogsRead 标记全部已读
func (h *ChangelogHandler) MarkAllChangelogsRead(c *gin.Context) {
	userID := c.GetUint("userID")
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}

	// 获取所有未读且已发布的更新日志
	var changelogs []models.Changelog
	h.DB.Where("is_published = ?", true).
		Where("id NOT IN (SELECT changelog_id FROM changelog_reads WHERE user_id = ?)", userID).
		Find(&changelogs)

	for _, cl := range changelogs {
		read := models.ChangelogRead{
			UserID:      userID,
			ChangelogID: cl.ID,
			ReadAt:      time.Now(),
		}
		h.DB.Create(&read)
	}

	c.JSON(http.StatusOK, gin.H{"message": "全部已读"})
}

// GetChangelogDetail 获取详情（公开）
func (h *ChangelogHandler) GetChangelogDetail(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var changelog models.Changelog
	if err := h.DB.First(&changelog, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
		return
	}

	if !changelog.IsPublished {
		c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"changelog": changelog})
}
