package services

import (
	"aipool-backend/internal/config"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
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
	Size              string    `json:"size"`    // 1024x1024, 1024x1792, 1792x1024
	Quality           string    `json:"quality"` // low, medium, high, auto
	ImageURL          string    `json:"image_url"`
	ReferenceImageURL string    `json:"reference_image_url"`            // 参考图 URL（用于 image-to-image）
	Status            string    `json:"status"`                         // pending, completed, failed
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
	return s.EditImage(ctx, prompt, size, []string{imageFilePath})
}

// GenerateEditImage 通用图片编辑 (基于参考图修改，全适配 gpt-image-2)
// 返回 (OpenAI 直链 URL, base64 数据, 错误)
func (s *ImageService) GenerateEditImage(ctx context.Context, prompt string, size string, imageFilePath string) (imageURL string, b64Data string, err error) {
	return s.EditImage(ctx, prompt, size, []string{imageFilePath})
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
// 支持单张或多张参考图，使用 multipart/form-data 文件上传格式调用 /v1/images/edits
func (s *ImageService) EditImage(ctx context.Context, prompt string, size string, referenceImagePaths []string) (imageURL string, b64Data string, err error) {
	apiKey := s.cfg.OpenAIOfficialKey
	if apiKey == "" {
		apiKey = s.cfg.ImageGenAPIKey
	}
	if apiKey == "" {
		apiKey = s.cfg.OpenAIKey
	}
	if apiKey == "" {
		return "", "", fmt.Errorf("未配置 Image Generation API Key")
	}

	// 默认尺寸
	if size == "" {
		size = "1024x1024"
	}

	// 验证参考图文件
	if len(referenceImagePaths) == 0 {
		return "", "", fmt.Errorf("未指定参考图文件路径")
	}

	baseURL := "https://api.openai.com"

	model := s.cfg.ImageGenModel
	if model == "" || model == "qwen-image-2.0-2026-03-03" || model == "qwen-image" {
		model = "gpt-image-2"
	}

	// OpenAI Images Edit API 要求 multipart/form-data 上传 image 文件；不能用 JSON + base64。
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("model", model)
	_ = writer.WriteField("prompt", prompt)
	_ = writer.WriteField("size", size)
	_ = writer.WriteField("n", "1")

	for i, path := range referenceImagePaths {
		file, err := os.Open(path)
		if err != nil {
			if os.IsNotExist(err) {
				return "", "", fmt.Errorf("参考图文件不存在: %s", path)
			}
			return "", "", fmt.Errorf("打开参考图文件失败: %w", err)
		}

		fieldName := "image"
		if len(referenceImagePaths) > 1 {
			fieldName = fmt.Sprintf("image[%d]", i)
		}
		part, err := writer.CreateFormFile(fieldName, filepath.Base(path))
		if err != nil {
			file.Close()
			return "", "", fmt.Errorf("创建图片表单失败: %w", err)
		}
		if _, err := io.Copy(part, file); err != nil {
			file.Close()
			return "", "", fmt.Errorf("写入图片表单失败: %w", err)
		}
		file.Close()
	}
	if err := writer.Close(); err != nil {
		return "", "", fmt.Errorf("关闭图片表单失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/images/edits", &body)
	if err != nil {
		return "", "", fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())

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
	apiKey := s.cfg.OpenAIOfficialKey
	if apiKey == "" {
		apiKey = s.cfg.ImageGenAPIKey
	}
	if apiKey == "" {
		apiKey = s.cfg.OpenAIKey
	}
	model := s.cfg.ImageGenModel
	if model == "" || model == "qwen-image-2.0-2026-03-03" || model == "qwen-image" {
		model = "gpt-image-2"
	}
	url, err := s.imageGenSvc.Generate(ctx, "https://api.openai.com", apiKey, model, prompt, size, quality)
	if err != nil {
		return "", "", err
	}
	return url, "", nil
}
