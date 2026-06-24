package api

import (
	"net/http"
	"strings"
	"time"

	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type CompareInitRequest struct {
	Content        string   `json:"content" binding:"required"`
	Model          string   `json:"model" binding:"required"`
	CompareModels  []string `json:"compare_models" binding:"required"`
	ConversationID uint     `json:"conversation_id,omitempty"`
	WorkspaceID    uint     `json:"workspace_id,omitempty"`
	SkillKey       string   `json:"skill_key,omitempty"`
}

func normalizeCompareInitModels(model string, modelIDs []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(modelIDs)+1)
	for _, id := range append(modelIDs, model) {
		id = strings.TrimSpace(id)
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

func compareInitTitle(content string) string {
	content = strings.TrimSpace(content)
	if len([]rune(content)) <= 20 {
		return content
	}
	runes := []rune(content)
	return string(runes[:20]) + "..."
}

func (h *ChatHandler) InitCompareChat(c *gin.Context) {
	var req CompareInitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content_required"})
		return
	}
	compareModels := normalizeCompareInitModels(req.Model, req.CompareModels)
	if len(compareModels) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "compare_models_required", "message": "对比模式至少需要两个模型"})
		return
	}

	userID, _ := c.Get("userID")
	uid, _ := userID.(uint)
	if uid == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}

	var conv models.Conversation
	var userMsg models.Message
	var group models.MessageGroup
	err := h.db.Transaction(func(tx *gorm.DB) error {
		if req.ConversationID > 0 {
			if err := tx.Where("id = ? AND user_id = ?", req.ConversationID, uid).First(&conv).Error; err != nil {
				return err
			}
			conv.Compare = true
			conv.Model = compareModels[0]
			conv.WorkspaceID = req.WorkspaceID
			conv.SkillKey = req.SkillKey
			conv.SetCompareModels(compareModels)
			if err := tx.Model(&conv).Updates(map[string]interface{}{
				"compare":        true,
				"model":          conv.Model,
				"workspace_id":   conv.WorkspaceID,
				"skill_key":      conv.SkillKey,
				"compare_models": conv.CompareModels,
				"updated_at":     time.Now(),
			}).Error; err != nil {
				return err
			}
		} else {
			conv = models.Conversation{
				UserID:      uid,
				WorkspaceID: req.WorkspaceID,
				Title:       compareInitTitle(content),
				Model:       compareModels[0],
				Compare:     true,
				SkillKey:    strings.TrimSpace(req.SkillKey),
				CreatedAt:   time.Now(),
				UpdatedAt:   time.Now(),
			}
			conv.SetCompareModels(compareModels)
			if err := tx.Create(&conv).Error; err != nil {
				return err
			}
		}

		userMsg = models.Message{
			ConversationID: conv.ID,
			Role:           "user",
			Content:        content,
			Model:          compareModels[0],
			CreatedAt:      time.Now(),
		}
		if err := tx.Create(&userMsg).Error; err != nil {
			return err
		}
		group = models.MessageGroup{ConversationID: conv.ID, UserMessageID: userMsg.ID, CreatedAt: time.Now()}
		group.SetModels(compareModels)
		if err := tx.Create(&group).Error; err != nil {
			return err
		}
		return tx.Model(&conv).Update("updated_at", time.Now()).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "compare_init_failed", "message": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"conversation_id": conv.ID,
		"user_message": gin.H{
			"id":              userMsg.ID,
			"conversation_id": conv.ID,
			"role":            userMsg.Role,
			"content":         userMsg.Content,
			"model":           userMsg.Model,
			"created_at":      userMsg.CreatedAt,
		},
		"group": gin.H{
			"id":              group.ID,
			"conversation_id": conv.ID,
			"user_message_id": userMsg.ID,
			"group_models":    compareModels,
		},
		"compare_models": compareModels,
	})
}
