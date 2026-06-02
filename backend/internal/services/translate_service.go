package services

import (
	"context"
	"errors"
	"fmt"
	"sort"
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

type SupportedLanguage struct {
	LanguageCode  string `json:"language_code"`
	DisplayName   string `json:"display_name"`
	SupportSource bool   `json:"support_source"`
	SupportTarget bool   `json:"support_target"`
}

type SupportedLanguagesResult struct {
	Languages           []SupportedLanguage `json:"languages"`
	DisplayLanguageCode string              `json:"display_language_code,omitempty"`
	Provider            string              `json:"provider"`
	Model               string              `json:"model,omitempty"`
	TranslationModel    string              `json:"translation_model,omitempty"`
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

func (s *TranslateService) SupportedLanguages(ctx context.Context, displayLanguageCode string) (*SupportedLanguagesResult, error) {
	if s.cfg.GoogleCloudProjectID == "" {
		return nil, errors.New("Google Cloud Translation 未配置 GOOGLE_CLOUD_PROJECT_ID")
	}

	location := strings.TrimSpace(s.cfg.GoogleTranslateLocation)
	if location == "" {
		location = "global"
	}
	translationModel := normalizeGoogleTranslateModel(s.cfg.GoogleTranslateModel, s.cfg.GoogleCloudProjectID, location)
	model := normalizeSupportedLanguagesModel(s.cfg.GoogleTranslateModel, s.cfg.GoogleCloudProjectID, location)
	displayLanguageCode = normalizeTranslateLang(displayLanguageCode)
	if displayLanguageCode == "" || displayLanguageCode == "auto" {
		displayLanguageCode = "zh-CN"
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTranslateTimeout)
	defer cancel()

	client, err := translate.NewTranslationClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("初始化 Google Translate 客户端失败: %w", err)
	}
	defer client.Close()

	resp, err := client.GetSupportedLanguages(ctx, &translatepb.GetSupportedLanguagesRequest{
		Parent:              fmt.Sprintf("projects/%s/locations/%s", s.cfg.GoogleCloudProjectID, location),
		DisplayLanguageCode: displayLanguageCode,
		Model:               model,
	})
	if err != nil {
		return nil, fmt.Errorf("Google Translate 支持语言列表调用失败: %w", err)
	}

	languages := make([]SupportedLanguage, 0, len(resp.GetLanguages()))
	for _, lang := range resp.GetLanguages() {
		code := strings.TrimSpace(lang.GetLanguageCode())
		if code == "" {
			continue
		}
		if isTranslationLLMModel(translationModel) && !isTranslationLLMSupportedLanguage(code) {
			continue
		}
		languages = append(languages, SupportedLanguage{
			LanguageCode:  code,
			DisplayName:   lang.GetDisplayName(),
			SupportSource: lang.GetSupportSource(),
			SupportTarget: lang.GetSupportTarget(),
		})
	}
	sort.SliceStable(languages, func(i, j int) bool {
		if languages[i].DisplayName == languages[j].DisplayName {
			return languages[i].LanguageCode < languages[j].LanguageCode
		}
		return languages[i].DisplayName < languages[j].DisplayName
	})

	return &SupportedLanguagesResult{
		Languages:           languages,
		DisplayLanguageCode: displayLanguageCode,
		Provider:            "google-cloud-translate-v3",
		Model:               model,
		TranslationModel:    translationModel,
	}, nil
}

func isTranslationLLMModel(model string) bool {
	return strings.Contains(strings.TrimSpace(model), "general/translation-llm")
}

func isTranslationLLMSupportedLanguage(code string) bool {
	_, ok := translationLLMSupportedLanguages[strings.ToLower(strings.TrimSpace(code))]
	return ok
}

// Google Cloud Translation LLM whitelist: languages marked as either
// "Official Support" or "Experimental Support" in the official table.
var translationLLMSupportedLanguages = map[string]struct{}{
	"af": {}, "sq": {}, "am": {}, "ar-sa": {}, "ar": {}, "hy": {}, "az": {}, "eu": {}, "be": {},
	"bn-in": {}, "bn": {}, "bs-cyrl": {}, "bs": {}, "bg": {}, "my": {}, "ca": {},
	"zh-cn": {}, "zh-hk": {}, "zh-hans": {}, "zh-tw": {}, "zh-hant": {}, "zh": {},
	"hr": {}, "cs": {}, "da": {}, "nl-be": {}, "nl": {},
	"en-au": {}, "en-ca": {}, "en-nz": {}, "en-ph": {}, "en-za": {}, "en-gb": {}, "en-us": {}, "en": {},
	"et": {}, "fil": {}, "fi": {}, "fr-ca": {}, "fr-ch": {}, "fr": {}, "fy": {}, "gl": {}, "ka": {},
	"de": {}, "el": {}, "gn": {}, "gu": {}, "ha": {}, "he": {}, "iw": {}, "hi": {}, "hu": {}, "is": {},
	"ig": {}, "id": {}, "ga": {}, "it": {}, "ja": {}, "kn": {}, "km": {}, "ko": {}, "ky": {}, "lo": {},
	"lv": {}, "ln": {}, "lt": {}, "lb": {}, "mk": {}, "ms": {}, "ml": {}, "mt": {}, "mr": {}, "mn": {},
	"ne": {}, "nb": {}, "no": {}, "or": {}, "fa": {}, "pl": {}, "pt-br": {}, "pt-pt": {}, "pt": {},
	"pa-pk": {}, "pa": {}, "ro": {}, "ru": {}, "gd": {}, "sr": {}, "sk": {}, "sl": {}, "so": {},
	"es-ar": {}, "es-cl": {}, "es-co": {}, "es-cr": {}, "es-ec": {}, "es-sv": {}, "es-gt": {}, "es-ht": {},
	"es-hn": {}, "es-419": {}, "es-mx": {}, "es-ni": {}, "es-pa": {}, "es-py": {}, "es-pe": {},
	"es-pr": {}, "es-es": {}, "es-us": {}, "es-uy": {}, "es-ve": {}, "es": {},
	"sw": {}, "sv": {}, "tl": {}, "tg": {}, "ta": {}, "te": {}, "th": {}, "tr": {}, "uk": {},
	"ur": {}, "uz": {}, "vi": {}, "cy": {}, "zu": {},
}

func normalizeSupportedLanguagesModel(model, projectID, location string) string {
	model = strings.TrimSpace(model)
	if isTranslationLLMModel(model) {
		model = "general/nmt"
	}
	return normalizeGoogleTranslateModel(model, projectID, location)
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
