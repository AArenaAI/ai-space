package api

import (
	"net/http"
	"strings"

	"aipool-backend/internal/services"

	"github.com/gin-gonic/gin"
)

type TranslateHandler struct {
	service *services.TranslateService
}

func NewTranslateHandler(service *services.TranslateService) *TranslateHandler {
	return &TranslateHandler{service: service}
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
