package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type gaokaoAdvisorModelCfg struct {
	Provider string
	APIKey   string
	BaseURL  string
	Model    string
}

type gaokaoAdvisorModelJSON struct {
	Summary   string   `json:"summary"`
	Tradeoffs []string `json:"tradeoffs"`
	RiskFlags []string `json:"risk_flags"`
	Questions []string `json:"questions"`
}

func extractGaokaoAdvisorJSON(content string) string {
	content = strings.TrimSpace(content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start >= 0 && end >= start {
		return strings.TrimSpace(content[start : end+1])
	}
	return content
}

func truncateGaokaoAdvisorText(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return text[:limit] + "..."
}

func gaokaoAdvisorModelConfig(provider string) (gaokaoAdvisorModelCfg, bool) {
	p := strings.ToLower(strings.TrimSpace(provider))
	if p == "" {
		p = "deepseek"
	}
	prefix := map[string]string{"deepseek": "DEEPSEEK", "openai": "OPENAI", "gpt": "OPENAI", "kimi": "MOONSHOT", "moonshot": "MOONSHOT", "gemini": "GEMINI"}[p]
	if prefix == "" {
		prefix = strings.ToUpper(p)
	}
	key := strings.TrimSpace(os.Getenv(prefix + "_API_KEY"))
	base := strings.TrimRight(strings.TrimSpace(os.Getenv(prefix+"_BASE_URL")), "/")
	model := strings.TrimSpace(os.Getenv(prefix + "_MODEL"))
	if prefix == "OPENAI" {
		officialKey := strings.TrimSpace(os.Getenv("OPENAI_OFFICIAL_API_KEY"))
		if officialKey != "" && (base == "" || strings.Contains(base, "cli-proxy-api") || strings.Contains(base, "127.0.0.1:8317")) {
			key = officialKey
			base = "https://api.openai.com/v1"
		}
	}
	if prefix == "DEEPSEEK" {
		if key == "" {
			key = strings.TrimSpace(os.Getenv("DOC_GEN_API_KEY"))
		}
		if base == "" {
			base = strings.TrimRight(strings.TrimSpace(os.Getenv("DOC_GEN_BASE_URL")), "/")
		}
		// Advisor needs fast bounded analysis, not the slower document-generation model.
		// Use DEEPSEEK_MODEL only when explicitly set; otherwise fall back to deepseek-chat.
		if model == "" {
			model = "deepseek-chat"
		}
	}
	if model == "" {
		switch prefix {
		case "DEEPSEEK":
			model = "deepseek-chat"
		case "MOONSHOT":
			model = "moonshot-v1-8k"
		case "GEMINI":
			model = "gemini-1.5-flash"
		default:
			model = "gpt-4o-mini"
		}
	}
	if key == "" || base == "" {
		if prefix == "DEEPSEEK" {
			if cfg, ok := gaokaoAdvisorModelConfig("openai"); ok {
				cfg.Provider = "openai-fallback"
				return cfg, true
			}
		}
		return gaokaoAdvisorModelCfg{Provider: p, APIKey: key, BaseURL: base, Model: model}, false
	}
	return gaokaoAdvisorModelCfg{Provider: p, APIKey: key, BaseURL: base, Model: model}, true
}

func buildGaokaoAdvisorModelPrompt(profile GaokaoProfile, message string, recs []GaokaoRecommendation) string {
	rows := make([]map[string]interface{}, 0, minGaokaoInt(len(recs), 12))
	for i, rec := range recs {
		if i >= 12 {
			break
		}
		rows = append(rows, map[string]interface{}{
			"band": rec.Band, "school": rec.School, "group": rec.MajorGroup, "major": rec.Major,
			"ranks": rec.Ranks, "city": rec.City, "level": rec.DataLevel,
			"priority": rec.MajorPoolTier.Priority, "rejected": rec.MajorPoolTier.Rejected,
		})
	}
	payload, _ := json.Marshal(rows)
	return fmt.Sprintf(`你是高考志愿 Advisor。只基于候选数据、用户档案和可见来源做分析；不得编造学校、分数线、位次、招生计划或来源；不得把推测当事实。
必须返回 JSON，格式：{"summary":"...","tradeoffs":["..."],"risk_flags":["..."],"questions":["..."]}。
用户档案：省份=%s，科类/选科=%s，位次=%d，偏好专业=%s，排除专业=%s，策略=%s。
用户补充：%s
候选数据(JSON)：%s`, profile.Province, profile.Subjects, profile.Rank, strings.Join(profile.PreferredMajors, "、"), strings.Join(profile.RejectedMajors, "、"), profile.Strategy, message, string(payload))
}

func CallGaokaoAdvisorModel(ctx context.Context, provider string, profile GaokaoProfile, message string, recs []GaokaoRecommendation) (GaokaoAdvisorAnalysis, string, error) {
	cfg, ok := gaokaoAdvisorModelConfig(provider)
	if !ok {
		return GaokaoAdvisorAnalysis{}, "not_configured", fmt.Errorf("advisor model provider not configured")
	}
	prompt := buildGaokaoAdvisorModelPrompt(profile, message, recs)
	body := map[string]interface{}{
		"model":       cfg.Model,
		"messages":    []map[string]string{{"role": "system", "content": "你是严谨的高考志愿顾问，只做基于数据的分析。"}, {"role": "user", "content": prompt}},
		"temperature": 0.2,
		"max_tokens":  1200,
	}
	raw, _ := json.Marshal(body)
	url := cfg.BaseURL
	if !strings.HasSuffix(url, "/chat/completions") {
		url += "/chat/completions"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return GaokaoAdvisorAnalysis{}, "error", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return GaokaoAdvisorAnalysis{}, "error", err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return GaokaoAdvisorAnalysis{}, "error", fmt.Errorf("advisor model http %d: %s", resp.StatusCode, string(data))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil || len(parsed.Choices) == 0 {
		return GaokaoAdvisorAnalysis{}, "error", fmt.Errorf("invalid advisor model response: status=%d bytes=%d body=%s", resp.StatusCode, len(data), truncateGaokaoAdvisorText(string(data), 240))
	}
	content := extractGaokaoAdvisorJSON(strings.TrimSpace(parsed.Choices[0].Message.Content))
	var modelOut gaokaoAdvisorModelJSON
	if err := json.Unmarshal([]byte(content), &modelOut); err != nil {
		return GaokaoAdvisorAnalysis{}, "error", fmt.Errorf("invalid advisor model json: %w; content=%s", err, truncateGaokaoAdvisorText(content, 240))
	}
	return GaokaoAdvisorAnalysis{Summary: modelOut.Summary, Tradeoffs: modelOut.Tradeoffs, RiskFlags: modelOut.RiskFlags, Questions: modelOut.Questions}, "called:" + cfg.Provider + ":" + cfg.Model, nil
}
