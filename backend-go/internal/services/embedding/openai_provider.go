package embedding

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"aipool-backend/internal/config"
)

// OpenAIProvider OpenAI embedding 实现
type OpenAIProvider struct {
	cfg      *config.Config
	baseURL  string
	apiKey   string
	model    string
	dimension int
	client   *http.Client
}

// NewOpenAIProvider 创建 OpenAI embedding provider
func NewOpenAIProvider(cfg *config.Config) *OpenAIProvider {
	baseURL := "https://api.openai.com"
	if cfg.EmbeddingBaseURL != "" {
		baseURL = cfg.EmbeddingBaseURL
	}
	if cfg.OpenAIBaseURL != "" && cfg.EmbeddingBaseURL == "" {
		baseURL = cfg.OpenAIBaseURL
	}

	apiKey := cfg.EmbeddingAPIKey
	if apiKey == "" {
		apiKey = cfg.OpenAIKey
	}

	model := cfg.EmbeddingModel
	if model == "" {
		model = "text-embedding-3-small"
	}

	dimension := cfg.EmbeddingDimensions
	if dimension <= 0 {
		dimension = 1536
	}

	return &OpenAIProvider{
		cfg:       cfg,
		baseURL:   baseURL,
		apiKey:    apiKey,
		model:     model,
		dimension: dimension,
		client:    &http.Client{Timeout: 120 * time.Second},
	}
}

// EmbedDocuments 批量将文本列表转为向量
func (p *OpenAIProvider) EmbedDocuments(ctx context.Context, texts []string) ([]EmbeddingVector, error) {
	return p.embed(ctx, texts)
}

// EmbedQuery 将查询文本转为向量
func (p *OpenAIProvider) EmbedQuery(ctx context.Context, query string) (EmbeddingVector, error) {
	vectors, err := p.embed(ctx, []string{query})
	if err != nil {
		return nil, err
	}
	if len(vectors) == 0 {
		return nil, fmt.Errorf("空的 embedding 返回")
	}
	return vectors[0], nil
}

// ModelInfo 返回当前 provider 的模型信息
func (p *OpenAIProvider) ModelInfo() ModelInfo {
	return ModelInfo{
		Provider:  "openai",
		Model:     p.model,
		Dimension: p.dimension,
	}
}

// embed 内部实现：调用 OpenAI /v1/embeddings API
func (p *OpenAIProvider) embed(ctx context.Context, inputs []string) ([]EmbeddingVector, error) {
	if p.apiKey == "" {
		return nil, fmt.Errorf("未配置 OpenAI API Key")
	}

	reqBody := map[string]interface{}{
		"model": p.model,
		"input": inputs,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/v1/embeddings", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 embedding API 失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("embedding API 返回错误: status=%d body=%s", resp.StatusCode, string(body))
	}

	var result struct {
		Data []struct {
			Embedding []float32 `json:"embedding"`
			Index     int       `json:"index"`
		} `json:"data"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	if result.Error != nil && result.Error.Message != "" {
		return nil, fmt.Errorf("embedding API 错误: %s", result.Error.Message)
	}

	// 按 index 排序
	vectors := make([]EmbeddingVector, len(inputs))
	for _, item := range result.Data {
		if item.Index >= 0 && item.Index < len(vectors) {
			vectors[item.Index] = item.Embedding
		}
	}

	return vectors, nil
}
