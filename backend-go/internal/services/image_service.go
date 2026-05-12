package services

import (
	"aipool-backend/internal/config"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type ImageService struct {
	cfg *config.Config
}

type ImageGeneration struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	UserID      uint      `json:"user_id"`
	Prompt      string    `json:"prompt"`
	Size        string    `json:"size"` // 1024x1024, 1024x1792, 1792x1024
	ImageURL    string    `json:"image_url"`
	Status      string    `json:"status"` // pending, completed, failed
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func NewImageService(cfg *config.Config) *ImageService {
	return &ImageService{cfg: cfg}
}

type DALLEImageRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	Size   string `json:"size"`
	N      int    `json:"n"`
}

type DALLEImageResponse struct {
	Data []struct {
		URL string `json:"url"`
	} `json:"data"`
}

// GenerateImage 生成图片
func (s *ImageService) GenerateImage(ctx context.Context, prompt string, size string) (string, error) {
	if s.cfg.OpenAIKey == "" {
		return "", fmt.Errorf("未配置 OpenAI API Key")
	}

	// 默认尺寸
	if size == "" {
		size = "1024x1024"
	}

	reqBody := DALLEImageRequest{
		Model:  "gpt-image-2",
		Prompt: prompt,
		Size:   size,
		N:      1,
	}

	baseURL := "https://api.openai.com"
	if s.cfg.OpenAIBaseURL != "" {
		baseURL = s.cfg.OpenAIBaseURL
	}

	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/images/generations", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.cfg.OpenAIKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("DALL-E API 错误: %s", string(body))
	}

	var result DALLEImageResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}

	if len(result.Data) == 0 {
		return "", fmt.Errorf("未生成图片")
	}

	return result.Data[0].URL, nil
}
