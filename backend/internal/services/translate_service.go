package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	translate "cloud.google.com/go/translate/apiv3"
	"cloud.google.com/go/translate/apiv3/translatepb"

	"aipool-backend/internal/config"
)

const defaultTranslateTimeout = 30 * time.Second

type TranslateService struct {
	cfg *config.Config
}

type TranslateRequest struct {
	Text       string
	SourceLang string
	TargetLang string
	MimeType   string
}

type TranslateResult struct {
	TranslatedText     string `json:"translated_text"`
	DetectedSourceLang string `json:"detected_source_language,omitempty"`
	SourceLang         string `json:"source_language,omitempty"`
	TargetLang         string `json:"target_language"`
	Provider           string `json:"provider"`
	Model              string `json:"model,omitempty"`
}

func NewTranslateService(cfg *config.Config) *TranslateService {
	return &TranslateService{cfg: cfg}
}

func (s *TranslateService) Translate(ctx context.Context, req TranslateRequest) (*TranslateResult, error) {
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return nil, errors.New("待翻译文本不能为空")
	}

	targetLang := normalizeTranslateLang(req.TargetLang)
	if targetLang == "" || targetLang == "auto" {
		return nil, errors.New("目标语言不能为空")
	}
	if s.cfg.GoogleCloudProjectID == "" {
		return nil, errors.New("Google Cloud Translation 未配置 GOOGLE_CLOUD_PROJECT_ID")
	}

	mimeType := strings.TrimSpace(req.MimeType)
	if mimeType == "" {
		mimeType = "text/plain"
	}
	location := strings.TrimSpace(s.cfg.GoogleTranslateLocation)
	if location == "" {
		location = "global"
	}
	model := normalizeGoogleTranslateModel(s.cfg.GoogleTranslateModel, s.cfg.GoogleCloudProjectID, location)

	ctx, cancel := context.WithTimeout(ctx, defaultTranslateTimeout)
	defer cancel()

	client, err := translate.NewTranslationClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("初始化 Google Translate 客户端失败: %w", err)
	}
	defer client.Close()

	apiReq := &translatepb.TranslateTextRequest{
		Parent:             fmt.Sprintf("projects/%s/locations/%s", s.cfg.GoogleCloudProjectID, location),
		Contents:           []string{text},
		TargetLanguageCode: targetLang,
		MimeType:           mimeType,
		Model:              model,
	}
	if sourceLang := normalizeTranslateLang(req.SourceLang); sourceLang != "" && sourceLang != "auto" {
		apiReq.SourceLanguageCode = sourceLang
	}

	resp, err := client.TranslateText(ctx, apiReq)
	if err != nil {
		return nil, fmt.Errorf("Google Translate 调用失败: %w", err)
	}
	if len(resp.GetTranslations()) == 0 {
		return nil, errors.New("Google Translate 未返回译文")
	}

	translation := resp.GetTranslations()[0]
	return &TranslateResult{
		TranslatedText:     translation.GetTranslatedText(),
		DetectedSourceLang: translation.GetDetectedLanguageCode(),
		SourceLang:         apiReq.GetSourceLanguageCode(),
		TargetLang:         targetLang,
		Provider:           "google-cloud-translate-v3",
		Model:              model,
	}, nil
}

func normalizeGoogleTranslateModel(model, projectID, location string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		model = "general/nmt"
	}
	if strings.HasPrefix(model, "projects/") {
		return model
	}
	return fmt.Sprintf("projects/%s/locations/%s/models/%s", projectID, location, model)
}

func normalizeTranslateLang(lang string) string {
	lang = strings.TrimSpace(strings.ToLower(lang))
	if lang == "" {
		return ""
	}
	switch lang {
	case "zh":
		return "zh-CN"
	case "zh_cn", "zh-cn", "cn":
		return "zh-CN"
	case "zh_tw", "zh-tw":
		return "zh-TW"
	case "fil":
		return "tl"
	case "auto":
		return "auto"
	default:
		return lang
	}
}
