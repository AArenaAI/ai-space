package api

import (
	"aipool-backend/internal/models"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type WorkspaceHandler struct {
	db *gorm.DB
}

func NewWorkspaceHandler(db *gorm.DB) *WorkspaceHandler {
	return &WorkspaceHandler{db: db}
}

type WorkspaceCreateRequest struct {
	Name  string `json:"name" binding:"required,max=128"`
	Icon  string `json:"icon,omitempty"`
	Color string `json:"color,omitempty"`
}

type WorkspaceUpdateRequest struct {
	Name  *string `json:"name,omitempty"`
	Icon  *string `json:"icon,omitempty"`
	Color *string `json:"color,omitempty"`
}

// ListWorkspaces 获取用户的所有工作区
func (h *WorkspaceHandler) ListWorkspaces(c *gin.Context) {
	userID := getUserID(c)

	var workspaces []models.Workspace
	if err := h.db.Where("user_id = ?", userID).
		Order("is_default desc, created_at asc").
		Find(&workspaces).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询工作区失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"workspaces": workspaces})
}

// CreateWorkspace 创建工作区
func (h *WorkspaceHandler) CreateWorkspace(c *gin.Context) {
	userID := getUserID(c)

	var req WorkspaceCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Icon == "" {
		req.Icon = "📁"
	}
	if req.Color == "" {
		req.Color = "#6366f1"
	}

	workspace := models.Workspace{
		UserID: userID,
		Name:   req.Name,
		Icon:   req.Icon,
		Color:  req.Color,
	}

	if err := h.db.Create(&workspace).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建工作区失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"workspace": workspace})
}

// GetWorkspace 获取单个工作区
func (h *WorkspaceHandler) GetWorkspace(c *gin.Context) {
	userID := getUserID(c)
	workspaceID := c.Param("id")

	var workspace models.Workspace
	if err := h.db.Where("id = ? AND user_id = ?", workspaceID, userID).First(&workspace).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "工作区不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"workspace": workspace})
}

// UpdateWorkspace 更新工作区
func (h *WorkspaceHandler) UpdateWorkspace(c *gin.Context) {
	userID := getUserID(c)
	workspaceID := c.Param("id")

	var workspace models.Workspace
	if err := h.db.Where("id = ? AND user_id = ?", workspaceID, userID).First(&workspace).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "工作区不存在"})
		return
	}

	var req WorkspaceUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Icon != nil {
		updates["icon"] = *req.Icon
	}
	if req.Color != nil {
		updates["color"] = *req.Color
	}

	if len(updates) > 0 {
		if err := h.db.Model(&workspace).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "更新工作区失败"})
			return
		}
	}

	// 重新读取更新后的数据
	h.db.First(&workspace, workspace.ID)
	c.JSON(http.StatusOK, gin.H{"workspace": workspace})
}

// DeleteWorkspace 删除工作区（不允许删除默认工作区）
func (h *WorkspaceHandler) DeleteWorkspace(c *gin.Context) {
	userID := getUserID(c)
	workspaceID := c.Param("id")

	var workspace models.Workspace
	if err := h.db.Where("id = ? AND user_id = ?", workspaceID, userID).First(&workspace).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "工作区不存在"})
		return
	}

	if workspace.IsDefault {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能删除默认工作区"})
		return
	}

	// 软删除工作区及其关联数据
	h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&workspace).Error; err != nil {
			return err
		}
		// 将该工作区下的对话和文件移到默认工作区
		var defaultWS models.Workspace
		if err := tx.Where("user_id = ? AND is_default = ?", userID, true).First(&defaultWS).Error; err != nil {
			return err
		}
		tx.Model(&models.Conversation{}).Where("workspace_id = ?", workspace.ID).Update("workspace_id", defaultWS.ID)
		tx.Model(&models.File{}).Where("workspace_id = ?", workspace.ID).Update("workspace_id", defaultWS.ID)
		return nil
	})

	c.JSON(http.StatusOK, gin.H{"message": "工作区已删除"})
}
