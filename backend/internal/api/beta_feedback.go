package api

import (
	"net/http"
	"strings"

	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type BetaFeedbackHandler struct {
	db *gorm.DB
}

func NewBetaFeedbackHandler(db *gorm.DB) *BetaFeedbackHandler {
	return &BetaFeedbackHandler{db: db}
}

type SubmitBetaFeedbackRequest struct {
	Category            string `json:"category" binding:"required"`
	Title               string `json:"title" binding:"required"`
	Content             string `json:"content" binding:"required"`
	ExpectedImprovement string `json:"expected_improvement"`
}

func (h *BetaFeedbackHandler) Submit(c *gin.Context) {
	var req SubmitBetaFeedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写反馈类型、标题和详细内容"})
		return
	}

	req.Category = strings.TrimSpace(req.Category)
	req.Title = strings.TrimSpace(req.Title)
	req.Content = strings.TrimSpace(req.Content)
	req.ExpectedImprovement = strings.TrimSpace(req.ExpectedImprovement)

	if req.Category == "" || req.Title == "" || req.Content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写反馈类型、标题和详细内容"})
		return
	}
	if len([]rune(req.Title)) > 160 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "标题请控制在 160 字以内"})
		return
	}

	var userIDPtr *uint
	var email, name string
	if rawUserID, ok := c.Get("userID"); ok {
		if userID, ok := rawUserID.(uint); ok && userID > 0 {
			userIDPtr = &userID
			var user models.User
			if err := h.db.Select("id", "email", "name").First(&user, userID).Error; err == nil {
				email = user.Email
				name = user.Name
			}
		}
	}

	feedback := models.BetaFeedback{
		UserID:              userIDPtr,
		Email:               email,
		Name:                name,
		Category:            req.Category,
		Title:               req.Title,
		Content:             req.Content,
		ExpectedImprovement: req.ExpectedImprovement,
		Status:              "pending",
	}

	if err := h.db.Create(&feedback).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "反馈提交失败，请稍后重试"})
		return
	}

	if userIDPtr != nil {
		h.db.Create(&models.AnalyticsEvent{
			UserID:    *userIDPtr,
			EventType: "beta_feedback",
			EventName: "beta_feedback_submit",
			PagePath:  c.Request.URL.Path,
			Metadata:  `{"category":"` + strings.ReplaceAll(req.Category, `"`, `\"`) + `"}`,
		})
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":      feedback.ID,
		"status":  feedback.Status,
		"message": "反馈已提交，感谢你的建议。被采纳的高质量反馈可能获得免费积分或会员奖励。",
	})
}
