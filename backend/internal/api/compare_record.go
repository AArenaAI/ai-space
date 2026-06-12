package api

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"time"

	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type CompareRecordHandler struct {
	db *gorm.DB
}

func NewCompareRecordHandler(db *gorm.DB) *CompareRecordHandler {
	return &CompareRecordHandler{db: db}
}

func genSlug() string {
	b := make([]byte, 12)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)[:16]
}

// POST /api/compare/record — 保存对比记录
func (h *CompareRecordHandler) Save(c *gin.Context) {
	userID := getUserID(c)

	var req struct {
		Query   string   `json:"query" binding:"required"`
		Models  []string `json:"models" binding:"required"`
		Results string   `json:"results" binding:"required"` // JSON string of results array
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	modelsJSON, _ := json.Marshal(req.Models)

	record := models.CompareRecord{
		UserID:    userID,
		Query:     req.Query,
		Models:    string(modelsJSON),
		Results:   req.Results,
		Slug:      genSlug(),
		CreatedAt: time.Now(),
	}

	if err := h.db.Create(&record).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存对比记录失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":   record.ID,
		"slug": record.Slug,
	})
}

// GET /api/compare/records — 获取当前用户的对比记录列表（简要）
func (h *CompareRecordHandler) List(c *gin.Context) {
	userID := getUserID(c)

	var records []models.CompareRecord
	if err := h.db.Where("user_id = ?", userID).Order("created_at desc").Find(&records).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取对比记录失败"})
		return
	}

	// 返回简洁列表（不含完整 results）
	type RecordItem struct {
		ID        uint      `json:"id"`
		Query     string    `json:"query"`
		Models    []string  `json:"models"`
		Slug      string    `json:"slug"`
		CreatedAt time.Time `json:"created_at"`
	}

	items := make([]RecordItem, 0, len(records))
	for _, r := range records {
		var models []string
		json.Unmarshal([]byte(r.Models), &models)
		items = append(items, RecordItem{
			ID:        r.ID,
			Query:     r.Query,
			Models:    models,
			Slug:      r.Slug,
			CreatedAt: r.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, items)
}

// GET /api/compare/share/:slug — 通过 slug 获取完整对比记录
func (h *CompareRecordHandler) GetBySlug(c *gin.Context) {
	slug := c.Param("slug")

	var record models.CompareRecord
	if err := h.db.Where("slug = ?", slug).First(&record).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "对比记录不存在"})
		return
	}

	// 解析 models
	var models []string
	json.Unmarshal([]byte(record.Models), &models)

	// 解析 results
	var results interface{}
	json.Unmarshal([]byte(record.Results), &results)

	c.JSON(http.StatusOK, gin.H{
		"id":         record.ID,
		"query":      record.Query,
		"models":     models,
		"results":    results,
		"slug":       record.Slug,
		"created_at": record.CreatedAt,
	})
}

// DELETE /api/compare/record/:id — 删除对比记录
func (h *CompareRecordHandler) Delete(c *gin.Context) {
	userID := getUserID(c)
	id := c.Param("id")

	if err := h.db.Where("id = ? AND user_id = ?", id, userID).Delete(&models.CompareRecord{}).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}
