package api

import (
	"net/http"
	"strings"
	"time"

	"aipool-backend/internal/middleware"
	"aipool-backend/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const translatorCreditModelID = "google-cloud-translate-v3:general/translation-llm"

type TranslateHandler struct {
	db           *gorm.DB
	service      *services.TranslateService
	usageService *services.UsageService
}

func NewTranslateHandler(db *gorm.DB, service *services.TranslateService, usageService *services.UsageService) *TranslateHandler {
	return &TranslateHandler{db: db, service: service, usageService: usageService}
}

type translateAPIRequest struct {
	Text           string `json:"text" binding:"required"`
	SourceLanguage string `json:"source_language"`
	TargetLanguage string `json:"target_language" binding:"required"`
	MimeType       string `json:"mime_type"`
}

func (h *TranslateHandler) Translate(c *gin.Context) {
	var req translateAPIRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 翻译同样属于模型能力，必须走统一内测激活/积分扣减链路，避免未激活用户绕过 /chat 校验。
	if !ensureModelAccess(c, h.db, getUserID(c), translatorCreditModelID, 0) {
		return
	}

	startedAt := time.Now()
	result, err := h.service.Translate(c.Request.Context(), services.TranslateRequest{
		Text:       req.Text,
		SourceLang: strings.TrimSpace(req.SourceLanguage),
		TargetLang: strings.TrimSpace(req.TargetLanguage),
		MimeType:   strings.TrimSpace(req.MimeType),
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	if h.usageService != nil {
		userID := uint(0)
		if v, ok := c.Get("userID"); ok {
			if id, ok := v.(uint); ok {
				userID = id
			}
		}
		guestID := middleware.GetGuestID(c)
		if userID > 0 {
			guestID = ""
		}
		_ = h.usageService.RecordTranslationUsage(services.TranslationUsageInput{
			UserID:             userID,
			GuestID:            guestID,
			Provider:           result.Provider,
			Model:              result.Model,
			SourceLanguage:     strings.TrimSpace(req.SourceLanguage),
			TargetLanguage:     result.TargetLang,
			InputCharacters:    len([]rune(req.Text)),
			OutputCharacters:   len([]rune(result.TranslatedText)),
			DetectedSourceLang: result.DetectedSourceLang,
			LatencyMs:          int(time.Since(startedAt).Milliseconds()),
			Raw: map[string]any{
				"mime_type": strings.TrimSpace(req.MimeType),
			},
		})
	}

	c.JSON(http.StatusOK, result)
}

func (h *TranslateHandler) SupportedLanguages(c *gin.Context) {
	displayLanguage := strings.TrimSpace(c.Query("display_language"))
	if displayLanguage == "" {
		displayLanguage = strings.TrimSpace(c.Query("display_language_code"))
	}

	result, err := h.service.SupportedLanguages(c.Request.Context(), displayLanguage)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}
