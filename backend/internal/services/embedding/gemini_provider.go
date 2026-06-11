package embedding

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"aipool-backend/internal/config"
)

// GeminiProvider implements Google Gemini text embeddings.
type GeminiProvider struct {
	apiKey    string
	model     string
	dimension int
	baseURL   string
	client    *http.Client
}

func NewGeminiProvider(cfg *config.Config) *GeminiProvider {
	// Prefer the provider-native Gemini key. TEXT_EMBEDDING_API_KEY may be
	// inherited from OpenAI/DashScope deployments and is not necessarily valid
	// for Google Generative Language APIs.
	apiKey := strings.TrimSpace(cfg.GeminiKey)
	if apiKey == "" {
		apiKey = strings.TrimSpace(cfg.TextEmbeddingAPIKey)
	}
	model := strings.TrimSpace(cfg.TextEmbeddingModel)
	if model == "" || strings.HasPrefix(model, "text-embedding-") {
		model = "gemini-embedding-001"
	}
	model = strings.TrimPrefix(model, "models/")
	dimension := cfg.TextEmbeddingDimensions
	if dimension <= 0 || dimension == 1536 {
		dimension = 3072
	}
	baseURL := strings.TrimRight(cfg.TextEmbeddingBaseURL, "/")
	if baseURL == "" || strings.Contains(baseURL, "dashscope") || strings.Contains(baseURL, "openai") {
		baseURL = "https://generativelanguage.googleapis.com/v1beta"
	}
	return &GeminiProvider{
		apiKey:    apiKey,
		model:     model,
		dimension: dimension,
		baseURL:   baseURL,
		client:    &http.Client{Timeout: 120 * time.Second},
	}
}

func (p *GeminiProvider) EmbedDocuments(ctx context.Context, texts []string) ([]EmbeddingVector, *Usage, error) {
	vectors := make([]EmbeddingVector, 0, len(texts))
	batchSize := 50
	for start := 0; start < len(texts); start += batchSize {
		end := start + batchSize
		if end > len(texts) {
			end = len(texts)
		}
		batchVectors, err := p.embedBatch(ctx, texts[start:end])
		if err != nil {
			return nil, nil, err
		}
		vectors = append(vectors, batchVectors...)
	}
	return vectors, nil, nil
}

func (p *GeminiProvider) EmbedQuery(ctx context.Context, query string) (EmbeddingVector, *Usage, error) {
	vectors, usage, err := p.EmbedDocuments(ctx, []string{query})
	if err != nil {
		return nil, nil, err
	}
	if len(vectors) == 0 {
		return nil, usage, fmt.Errorf("空的 embedding 返回")
	}
	return vectors[0], usage, nil
}

func (p *GeminiProvider) ModelInfo() ModelInfo {
	return ModelInfo{Provider: "gemini", Model: p.model, Dimension: p.dimension}
}

func (p *GeminiProvider) embedBatch(ctx context.Context, texts []string) ([]EmbeddingVector, error) {
	if p.apiKey == "" {
		return nil, fmt.Errorf("未配置 Gemini Embedding API Key")
	}
	if len(texts) == 0 {
		return nil, nil
	}
	modelName := "models/" + p.model
	reqBody := struct {
		Requests []struct {
			Model   string `json:"model"`
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"requests"`
	}{Requests: make([]struct {
		Model   string `json:"model"`
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
	}, len(texts))}
	for i, text := range texts {
		reqBody.Requests[i].Model = modelName
		reqBody.Requests[i].Content.Parts = []struct {
			Text string `json:"text"`
		}{{Text: text}}
	}
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("序列化 Gemini embedding 请求失败: %w", err)
	}
	endpoint := fmt.Sprintf("%s/models/%s:batchEmbedContents?key=%s", p.baseURL, p.model, url.QueryEscape(p.apiKey))
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("创建 Gemini embedding 请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 Gemini embedding API 失败: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取 Gemini embedding 响应失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Gemini embedding API 返回错误: status=%d body=%s", resp.StatusCode, string(body))
	}
	var result struct {
		Embeddings []struct {
			Values []float32 `json:"values"`
		} `json:"embeddings"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("解析 Gemini embedding 响应失败: %w", err)
	}
	if result.Error != nil && result.Error.Message != "" {
		return nil, fmt.Errorf("Gemini embedding API 错误: %s", result.Error.Message)
	}
	if len(result.Embeddings) != len(texts) {
		return nil, fmt.Errorf("Gemini embedding 返回数量不匹配: got=%d want=%d", len(result.Embeddings), len(texts))
	}
	vectors := make([]EmbeddingVector, len(result.Embeddings))
	for i, item := range result.Embeddings {
		vectors[i] = item.Values
	}
	return vectors, nil
}
