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
	"net/textproto"
	"os"
	"time"
)

type ImageService struct {
	cfg *config.Config
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
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

func NewImageService(cfg *config.Config) *ImageService {
	return &ImageService{cfg: cfg}
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
// 使用官方 multipart/form-data 格式调用 /v1/images/edits，兼容中转代理的透传模式
func (s *ImageService) EditImage(ctx context.Context, prompt string, size string, referenceImagePath string) (imageURL string, b64Data string, err error) {
	if s.cfg.OpenAIKey == "" {
		return "", "", fmt.Errorf("未配置 OpenAI API Key")
	}

	// 默认尺寸
	if size == "" {
		size = "1024x1024"
	}

	// 验证参考图文件
	if referenceImagePath == "" {
		return "", "", fmt.Errorf("未指定参考图文件路径")
	}
	imgFile, err := os.Open(referenceImagePath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", "", fmt.Errorf("参考图文件不存在: %s", referenceImagePath)
		}
		return "", "", fmt.Errorf("打开参考图文件失败: %w", err)
	}
	defer imgFile.Close()

	// 检测 MIME 类型
	imgHead := make([]byte, 512)
	n, _ := imgFile.Read(imgHead)
	mimeType := http.DetectContentType(imgHead[:n])
	imgFile.Seek(0, io.SeekStart)

	// 确定文件扩展名
	ext := ".png"
	switch mimeType {
	case "image/jpeg":
		ext = ".jpg"
	case "image/webp":
		ext = ".webp"
	}

	baseURL := "https://api.openai.com"
	if s.cfg.OpenAIBaseURL != "" {
		baseURL = s.cfg.OpenAIBaseURL
	}

	// 构建 multipart/form-data 请求体
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	// image 文件字段
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="image"; filename="reference%s"`, ext))
	h.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(h)
	if err != nil {
		return "", "", fmt.Errorf("创建文件字段失败: %w", err)
	}
	if _, err := io.Copy(part, imgFile); err != nil {
		return "", "", fmt.Errorf("写入文件内容失败: %w", err)
	}

	// 其他字段
	fields := map[string]string{
		"model":  "gpt-image-2",
		"prompt": prompt,
		"size":   size,
		"n":      "1",
	}
	for key, val := range fields {
		if err := writer.WriteField(key, val); err != nil {
			return "", "", fmt.Errorf("写入字段 %s 失败: %w", key, err)
		}
	}
	if err := writer.Close(); err != nil {
		return "", "", fmt.Errorf("关闭 multipart writer 失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/images/edits", &body)
	if err != nil {
		return "", "", fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.OpenAIKey)
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
// 如果 OpenAI 返回 url，则 imageURL 有值；如果返回 b64_json，则 b64Data 有值
func (s *ImageService) GenerateImage(ctx context.Context, prompt string, size string, quality string) (imageURL string, b64Data string, err error) {
	if s.cfg.OpenAIKey == "" {
		return "", "", fmt.Errorf("未配置 OpenAI API Key")
	}

	// 默认尺寸
	if size == "" {
		size = "1024x1024"
	}
	// 默认质量
	if quality == "" {
		quality = "medium"
	}

	reqBody := DALLEImageRequest{
		Model:   "gpt-image-2",
		Prompt:  prompt,
		Size:    size,
		Quality: quality,
		N:       1,
	}

	baseURL := "https://api.openai.com"
	if s.cfg.OpenAIBaseURL != "" {
		baseURL = s.cfg.OpenAIBaseURL
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", "", fmt.Errorf("序列化请求失败: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/images/generations", bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", "", fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.OpenAIKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("请求 OpenAI Images API 失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", fmt.Errorf("读取响应失败: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("Images API 错误 (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result DALLEImageResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", "", fmt.Errorf("解析响应失败: %w", err)
	}

	if len(result.Data) == 0 {
		return "", "", fmt.Errorf("未生成图片 (API 返回空数据)")
	}

	return result.Data[0].URL, result.Data[0].B64JSON, nil
}
