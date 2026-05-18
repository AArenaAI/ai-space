package services

import (
	"aipool-backend/internal/config"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

type ImageService struct {
	cfg         *config.Config
	imageGenSvc *ImageGenService
}

type ImageGeneration struct {
	ID                uint      `json:"id" gorm:"primaryKey"`
	UserID            uint      `json:"user_id"`
	Prompt            string    `json:"prompt"`
	Size              string    `json:"size"` // 1024x1024, 1024x1792, 1792x1024
	Quality           string    `json:"quality"` // low, medium, high, auto
	ImageURL          string    `json:"image_url"`
	ReferenceImageURL string    `json:"reference_image_url"` // 参考图 URL（用于 image-to-image）
	Status            string    `json:"status"` // pending, completed, failed
	ErrorMessage      string    `json:"error_message" gorm:"type:text"` // 失败原因
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

func NewImageService(cfg *config.Config) *ImageService {
	return &ImageService{cfg: cfg, imageGenSvc: NewImageGenService()}
}

// RemoveBackground 图片背景移除 (利用 gpt-image-2 的编辑能力)
// 返回 (OpenAI 直链 URL, base64 数据, 错误)
func (s *ImageService) RemoveBackground(ctx context.Context, size string, imageFilePath string) (imageURL string, b64Data string, err error) {
	prompt := "Remove the background of this image. Make the background transparent. Keep only the main subject."
	return s.EditImage(ctx, prompt, size, imageFilePath)
}

// GenerateEditImage 通用图片编辑 (基于参考图修改，全适配 gpt-image-2)
// 返回 (OpenAI 直链 URL, base64 数据, 错误)
func (s *ImageService) GenerateEditImage(ctx context.Context, prompt string, size string, imageFilePath string) (imageURL string, b64Data string, err error) {
	return s.EditImage(ctx, prompt, size, imageFilePath)
}

type DALLEImageRequest struct {
	Model   string `json:"model"`
	Prompt  string `json:"prompt"`
	Size    string `json:"size"`
	Quality string `json:"quality,omitempty"`
	N       int    `json:"n"`
}

type DALLEImageResponse struct {
	Data []struct {
		URL     string `json:"url"`
		B64JSON string `json:"b64_json"`
	} `json:"data"`
}

// EditImage 基于参考图编辑生成图片，返回 (OpenAI 直链 URL, base64 数据, 错误)
// 使用 JSON + base64 data URL 格式调用 /v1/images/edits，兼容中转代理的 images[] 格式
func (s *ImageService) EditImage(ctx context.Context, prompt string, size string, referenceImagePath string) (imageURL string, b64Data string, err error) {
	apiKey := s.cfg.ImageGenAPIKey
	if apiKey == "" {
		return "", "", fmt.Errorf("未配置 Image Generation API Key")
	}

	// 默认尺寸
	if size == "" {
		size = "1024x1024"
	}

	// 验证参考图文件
	if referenceImagePath == "" {
		return "", "", fmt.Errorf("未指定参考图文件路径")
	}
	imgData, err := os.ReadFile(referenceImagePath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", "", fmt.Errorf("参考图文件不存在: %s", referenceImagePath)
		}
		return "", "", fmt.Errorf("读取参考图文件失败: %w", err)
	}

	// 检测 MIME 类型
	mimeType := http.DetectContentType(imgData)
	switch mimeType {
	case "image/jpeg":
	case "image/webp":
	}

	// 转为 base64 data URL
	b64 := base64.StdEncoding.EncodeToString(imgData)
	dataURL := fmt.Sprintf("data:%s;base64,%s", mimeType, b64)

	baseURL := "https://api.openai.com"
	if s.cfg.ImageGenBaseURL != "" {
		baseURL = s.cfg.ImageGenBaseURL
	}

	model := s.cfg.ImageGenModel
	if model == "" {
		model = "gpt-image-2"
	}

	// 构建 JSON 请求 - 兼容中转代理的 images[] 格式
	reqBody := map[string]interface{}{
		"model":  model,
		"prompt": prompt,
		"size":   size,
		"n":      1,
		"images": []map[string]string{
			{"image_url": dataURL},
		},
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", "", fmt.Errorf("序列化请求失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/images/edits", bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", "", fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("请求 OpenAI Images Edit API 失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", fmt.Errorf("读取响应失败: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("Images Edit API 错误 (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	var result DALLEImageResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", "", fmt.Errorf("解析响应失败: %w", err)
	}

	if len(result.Data) == 0 {
		return "", "", fmt.Errorf("未生成图片 (API 返回空数据)")
	}

	return result.Data[0].URL, result.Data[0].B64JSON, nil
}

// GenerateImage 生成图片，返回 (OpenAI 直链 URL, base64 数据, 错误)
// 实际底层走 ImageGenService，统一处理各 provider 兼容 /v1/images/generations 接口。
func (s *ImageService) GenerateImage(ctx context.Context, prompt string, size string, quality string) (imageURL string, b64Data string, err error) {
	url, err := s.imageGenSvc.Generate(ctx, s.cfg.ImageGenBaseURL, s.cfg.ImageGenAPIKey, s.cfg.ImageGenModel, prompt, size, quality)
	if err != nil {
		return "", "", err
	}
	return url, "", nil
}
