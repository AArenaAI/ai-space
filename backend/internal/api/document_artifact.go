package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type DocumentArtifactHandler struct {
	db *gorm.DB
}

func NewDocumentArtifactHandler(db *gorm.DB) *DocumentArtifactHandler {
	return &DocumentArtifactHandler{db: db}
}

func (h *DocumentArtifactHandler) AutoMigrate() error {
	return h.db.AutoMigrate(&models.DocumentArtifact{})
}

type documentArtifactCreateRequest struct {
	FilePublicID string          `json:"file_public_id" binding:"required"`
	Kind         string          `json:"kind" binding:"required"`
	Title        string          `json:"title"`
	Summary      string          `json:"summary"`
	Payload      json.RawMessage `json:"payload" binding:"required"`
	Raw          string          `json:"raw"`
}

type documentArtifactResponse struct {
	ID           uint            `json:"id"`
	Kind         string          `json:"kind"`
	Title        string          `json:"title"`
	Summary      string          `json:"summary"`
	Payload      json.RawMessage `json:"payload"`
	Raw          string          `json:"raw,omitempty"`
	FilePublicID string          `json:"file_public_id"`
	CreatedAt    string          `json:"created_at"`
	UpdatedAt    string          `json:"updated_at"`
}

func normalizeArtifactKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case "knowledge_graph", "graph":
		return "knowledge_graph"
	case "infographic":
		return "infographic"
	default:
		return ""
	}
}

func artifactSummary(payload json.RawMessage, fallback string) string {
	if strings.TrimSpace(fallback) != "" {
		return fallback
	}
	var obj map[string]any
	if err := json.Unmarshal(payload, &obj); err != nil {
		return ""
	}
	if s, ok := obj["summary"].(string); ok {
		return s
	}
	if arr, ok := obj["summary"].([]any); ok && len(arr) > 0 {
		parts := make([]string, 0, len(arr))
		for _, item := range arr {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "；")
	}
	return ""
}

func artifactTitle(payload json.RawMessage, fallback string, kind string) string {
	if strings.TrimSpace(fallback) != "" {
		return fallback
	}
	var obj map[string]any
	if err := json.Unmarshal(payload, &obj); err == nil {
		if s, ok := obj["title"].(string); ok && strings.TrimSpace(s) != "" {
			return s
		}
	}
	if kind == "infographic" {
		return "信息图"
	}
	return "知识图谱"
}

func toArtifactResponse(item models.DocumentArtifact, publicID string) documentArtifactResponse {
	payload := json.RawMessage(item.Payload)
	if !json.Valid(payload) {
		payload = json.RawMessage(`{}`)
	}
	return documentArtifactResponse{
		ID:           item.ID,
		Kind:         item.Kind,
		Title:        item.Title,
		Summary:      item.Summary,
		Payload:      payload,
		Raw:          item.Raw,
		FilePublicID: publicID,
		CreatedAt:    item.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:    item.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func (h *DocumentArtifactHandler) List(c *gin.Context) {
	userID := getUserID(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		return
	}

	filePublicID := strings.TrimSpace(c.Query("file_public_id"))
	kind := normalizeArtifactKind(c.Query("kind"))
	query := h.db.Where("user_id = ?", userID)
	if filePublicID != "" {
		var file models.File
		if err := h.db.Where("public_id = ? AND user_id = ?", filePublicID, userID).First(&file).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在或无权访问"})
			return
		}
		query = query.Where("file_id = ?", file.ID)
	}
	if kind != "" {
		query = query.Where("kind = ?", kind)
	}
	var items []models.DocumentArtifact
	if err := query.Order("updated_at DESC").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取生成文件失败"})
		return
	}

	fileIDs := make([]uint, 0, len(items))
	for _, item := range items {
		fileIDs = append(fileIDs, item.FileID)
	}
	filePublicIDs := map[uint]string{}
	if len(fileIDs) > 0 {
		var files []models.File
		if err := h.db.Select("id", "public_id").Where("id IN ? AND user_id = ?", fileIDs, userID).Find(&files).Error; err == nil {
			for _, file := range files {
				filePublicIDs[file.ID] = file.PublicID
			}
		}
	}

	responses := make([]documentArtifactResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, toArtifactResponse(item, filePublicIDs[item.FileID]))
	}
	c.JSON(http.StatusOK, gin.H{"artifacts": responses})
}

func (h *DocumentArtifactHandler) Create(c *gin.Context) {
	userID := getUserID(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		return
	}

	var req documentArtifactCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	kind := normalizeArtifactKind(req.Kind)
	if kind == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的生成类型"})
		return
	}
	if !json.Valid(req.Payload) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "生成内容不是合法 JSON"})
		return
	}

	var file models.File
	if err := h.db.Where("public_id = ? AND user_id = ?", req.FilePublicID, userID).First(&file).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "文件不存在或无权访问"})
		return
	}

	item := models.DocumentArtifact{
		UserID:  userID,
		FileID:  file.ID,
		Kind:    kind,
		Title:   artifactTitle(req.Payload, req.Title, kind),
		Summary: artifactSummary(req.Payload, req.Summary),
		Payload: string(req.Payload),
		Raw:     req.Raw,
	}
	if err := h.db.Create(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存生成文件失败"})
		return
	}
	c.JSON(http.StatusOK, toArtifactResponse(item, file.PublicID))
}

func (h *DocumentArtifactHandler) Get(c *gin.Context) {
	userID := getUserID(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		return
	}

	var item models.DocumentArtifact
	if err := h.db.Where("id = ? AND user_id = ?", c.Param("id"), userID).First(&item).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "生成文件不存在"})
		return
	}
	var file models.File
	_ = h.db.Select("public_id").First(&file, item.FileID).Error
	c.JSON(http.StatusOK, toArtifactResponse(item, file.PublicID))
}

func (h *DocumentArtifactHandler) Delete(c *gin.Context) {
	userID := getUserID(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		return
	}
	if err := h.db.Where("id = ? AND user_id = ?", c.Param("id"), userID).Delete(&models.DocumentArtifact{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除生成文件失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
