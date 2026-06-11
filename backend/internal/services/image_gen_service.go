package services

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ImageGenService 统一底层图片生成服务，支持 OpenAI 兼容接口和 DashScope 原生接口。
type ImageGenService struct{}

func NewImageGenService() *ImageGenService {
	return &ImageGenService{}
}

// --- OpenAI 兼容格式 ---

type imageGenRequest struct {
	Model   string `json:"model"`
	Prompt  string `json:"prompt"`
	Size    string `json:"size,omitempty"`
	Quality string `json:"quality,omitempty"`
	N       int    `json:"n"`
}

type imageGenResponse struct {
	Data []struct {
		URL     string `json:"url"`
		B64JSON string `json:"b64_json"`
	} `json:"data"`
}

type seedreamImageRequest struct {
	Model          string `json:"model"`
	Prompt         string `json:"prompt"`
	Size           string `json:"size,omitempty"`
	ResponseFormat string `json:"response_format,omitempty"`
	OutputFormat   string `json:"output_format,omitempty"`
	Watermark      bool   `json:"watermark"`
	N              int    `json:"n,omitempty"`
}

type ImageStreamEvent struct {
	Type    string
	B64JSON string
	URL     string
}

// --- DashScope 原生格式 ---

type dsContentItem struct {
	Text  string `json:"text,omitempty"`
	Image string `json:"image,omitempty"`
}

type dsMessage struct {
	Role    string          `json:"role"`
	Content []dsContentItem `json:"content"`
}

type dsInput struct {
	Messages []dsMessage `json:"messages"`
}

type dsParameters struct {
	N              int    `json:"n"`
	Size           string `json:"size"`
	ResultFormat   string `json:"result_format"`
	Watermark      bool   `json:"watermark,omitempty"`
	NegativePrompt string `json:"negative_prompt,omitempty"`
}

type dsImageGenRequest struct {
	Model      string       `json:"model"`
	Input      dsInput      `json:"input"`
	Parameters dsParameters `json:"parameters"`
}

type dsImageGenResponse struct {
	Output struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Content []struct {
					Text  string `json:"text,omitempty"`
					Image string `json:"image,omitempty"`
				} `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	} `json:"output"`
}

const imagesDir = "./data/images"

// Generate 生成图片入口。自动判断 provider：DashScope 原生或 OpenAI 兼容。
func (s *ImageGenService) Generate(ctx context.Context, baseURL, apiKey, model, prompt, size, quality string) (string, error) {
	if apiKey == "" {
		return "", fmt.Errorf("未配置图片生成 API Key")
	}
	// 判断是否为 DashScope Qwen Image
	if strings.Contains(baseURL, "dashscope") || strings.HasPrefix(model, "qwen-image") {
		return s.generateDashScopeImage(ctx, baseURL, apiKey, model, prompt, size)
	}
	if isSeedreamImageProvider(baseURL, model) {
		return s.generateSeedreamImage(ctx, baseURL, apiKey, model, prompt, size)
	}
	return s.generateOpenAICompatibleImage(ctx, baseURL, apiKey, model, prompt, size, quality)
}

// --- OpenAI 兼容实现 ---

func (s *ImageGenService) generateOpenAICompatibleImage(ctx context.Context, baseURL, apiKey, model, prompt, size, quality string) (string, error) {
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	if model == "" {
		model = "gpt-image-2"
	}
	if size == "" {
		size = "1024x1024"
	}

	reqBody := imageGenRequest{
		Model:  model,
		Prompt: prompt,
		Size:   size,
		N:      1,
	}
	if quality != "" {
		reqBody.Quality = quality
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("序列化请求失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/images/generations", bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求图片生成 API 失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取响应失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("图片生成 API 错误 (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result imageGenResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("解析响应失败: %w", err)
	}
	if len(result.Data) == 0 {
		return "", fmt.Errorf("未生成图片 (API 返回空数据)")
	}

	// 优先使用直链 URL
	if result.Data[0].URL != "" {
		return result.Data[0].URL, nil
	}

	// 处理 base64
	if result.Data[0].B64JSON != "" {
		url, err := s.saveBase64Image(result.Data[0].B64JSON)
		if err != nil {
			return "", fmt.Errorf("保存图片失败: %w", err)
		}
		return url, nil
	}

	return "", fmt.Errorf("图片生成失败: API 未返回 url 或 b64_json")
}

func (s *ImageGenService) GenerateOpenAICompatibleImageStream(ctx context.Context, baseURL, apiKey, model, prompt, size, quality string, onEvent func(ImageStreamEvent) error) (string, error) {
	if apiKey == "" {
		return "", fmt.Errorf("未配置图片生成 API Key")
	}
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	if model == "" {
		model = "gpt-image-2"
	}
	if size == "" {
		size = "1024x1024"
	}

	reqBody := map[string]any{
		"model":          model,
		"prompt":         prompt,
		"size":           size,
		"n":              1,
		"stream":         true,
		"partial_images": 3,
	}
	if quality != "" {
		reqBody["quality"] = quality
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("序列化请求失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/images/generations", bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求图片生成 API 失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("图片生成 API 错误 (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var finalURL string
	var finalB64 string
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 1024), 32*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") || !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "[DONE]" {
			break
		}

		var event map[string]any
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			return "", fmt.Errorf("解析图片流事件失败: %w", err)
		}
		eventType, _ := event["type"].(string)
		b64, _ := event["b64_json"].(string)
		url, _ := event["url"].(string)
		if b64 == "" {
			if partial, ok := event["partial_image"].(map[string]any); ok {
				b64, _ = partial["b64_json"].(string)
			}
		}
		if data, ok := event["data"].([]any); ok && len(data) > 0 {
			if first, ok := data[0].(map[string]any); ok {
				if b64 == "" {
					b64, _ = first["b64_json"].(string)
				}
				if url == "" {
					url, _ = first["url"].(string)
				}
			}
		}
		if eventType == "image_generation.partial_image" && b64 != "" {
			if onEvent != nil {
				if err := onEvent(ImageStreamEvent{Type: eventType, B64JSON: b64}); err != nil {
					return "", err
				}
			}
			continue
		}
		// 检测流内的 error 事件（如内容安全过滤）
		if errObj, ok := event["error"].(map[string]any); ok {
			code, _ := errObj["code"].(string)
			msg, _ := errObj["message"].(string)
			if msg != "" {
				return "", fmt.Errorf("图片生成 API 错误 (%s): %s", code, msg)
			}
			return "", fmt.Errorf("图片生成 API 返回错误事件")
		}
		if b64 != "" {
			finalB64 = b64
		}
		if url != "" {
			finalURL = url
		}
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("读取图片流失败: %w", err)
	}
	if finalURL != "" {
		return finalURL, nil
	}
	if finalB64 != "" {
		url, err := s.saveBase64Image(finalB64)
		if err != nil {
			return "", fmt.Errorf("保存最终图片失败: %w", err)
		}
		return url, nil
	}
	return "", fmt.Errorf("图片生成未完成，可能是提示词包含敏感或不合规内容，请修改后重试")
}

// --- Seedream / Volcengine Ark 实现 ---

func isSeedreamImageProvider(baseURL, model string) bool {
	base := strings.ToLower(strings.TrimSpace(baseURL))
	m := strings.ToLower(strings.TrimSpace(model))
	return strings.Contains(base, "volces.com") || strings.Contains(m, "seedream")
}

func normalizeSeedreamBaseURL(baseURL string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return "https://ark.cn-beijing.volces.com/api/v3"
	}
	if strings.HasSuffix(baseURL, "/images/generations") {
		return strings.TrimSuffix(baseURL, "/images/generations")
	}
	return baseURL
}

func normalizeSeedreamSize(size string) string {
	if size == "" || size == "auto" {
		return "2048x2048"
	}
	var width, height int
	if _, err := fmt.Sscanf(strings.TrimSpace(size), "%dx%d", &width, &height); err != nil || width <= 0 || height <= 0 {
		return "2048x2048"
	}
	const minPixels = 3686400
	if width*height >= minPixels {
		return fmt.Sprintf("%dx%d", width, height)
	}
	scale := math.Sqrt(float64(minPixels) / float64(width*height))
	width = roundUpToMultiple(int(math.Ceil(float64(width)*scale)), 64)
	height = roundUpToMultiple(int(math.Ceil(float64(height)*scale)), 64)
	return fmt.Sprintf("%dx%d", width, height)
}

func roundUpToMultiple(value, multiple int) int {
	if multiple <= 0 {
		return value
	}
	return ((value + multiple - 1) / multiple) * multiple

}

func (s *ImageGenService) generateSeedreamImage(ctx context.Context, baseURL, apiKey, model, prompt, size string) (string, error) {
	baseURL = normalizeSeedreamBaseURL(baseURL)
	if model == "" {
		model = "doubao-seedream-5-0-260128"
	}
	requestSize := normalizeSeedreamSize(size)

	reqBody := seedreamImageRequest{
		Model:          model,
		Prompt:         prompt,
		Size:           requestSize,
		ResponseFormat: "url",
		OutputFormat:   "png",
		Watermark:      false,
		N:              1,
	}
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("序列化 Seedream 请求失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/images/generations", bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", fmt.Errorf("创建 Seedream 请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求 Seedream 图片生成失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取 Seedream 响应失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Seedream 图片生成错误 (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result imageGenResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("解析 Seedream 响应失败: %w", err)
	}
	if len(result.Data) == 0 {
		return "", fmt.Errorf("Seedream 未生成图片 (返回空 data)")
	}

	if result.Data[0].URL != "" {
		localURL, err := s.saveImageFromURL(ctx, result.Data[0].URL)
		if err != nil {
			return "", fmt.Errorf("保存 Seedream 图片失败: %w", err)
		}
		return localURL, nil
	}
	if result.Data[0].B64JSON != "" {
		url, err := s.saveBase64Image(result.Data[0].B64JSON)
		if err != nil {
			return "", fmt.Errorf("保存 Seedream base64 图片失败: %w", err)
		}
		return url, nil
	}
	return "", fmt.Errorf("Seedream 图片生成失败: API 未返回 url 或 b64_json")
}

// --- DashScope 原生实现 ---

func (s *ImageGenService) generateDashScopeImage(ctx context.Context, baseURL, apiKey, model, prompt, size string) (string, error) {
	if baseURL == "" {
		baseURL = "https://dashscope-intl.aliyuncs.com/api/v1"
	}
	if model == "" {
		model = "qwen-image-2.0-2026-03-03"
	}

	// size: 1024x1024 → 1024*1024
	size = normalizeDashScopeSize(size)

	reqBody := dsImageGenRequest{
		Model: model,
		Input: dsInput{
			Messages: []dsMessage{
				{
					Role: "user",
					Content: []dsContentItem{
						{Text: prompt},
					},
				},
			},
		},
		Parameters: dsParameters{
			N:            1,
			Size:         size,
			ResultFormat: "message",
			Watermark:    true,
		},
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("序列化 DashScope 请求失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/services/aigc/multimodal-generation/generation", bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", fmt.Errorf("创建 DashScope 请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求 DashScope 图片生成失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取 DashScope 响应失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("DashScope 图片生成错误 (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result dsImageGenResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("解析 DashScope 响应失败: %w", err)
	}

	if len(result.Output.Choices) == 0 {
		return "", fmt.Errorf("DashScope 未生成图片 (返回空 choices)")
	}

	msg := result.Output.Choices[0].Message
	if len(msg.Content) == 0 {
		return "", fmt.Errorf("DashScope 未生成图片 (返回空 content)")
	}

	// 查找图片 URL
	var imageURL string
	for _, c := range msg.Content {
		if c.Image != "" {
			imageURL = c.Image
			break
		}
	}

	if imageURL == "" {
		return "", fmt.Errorf("DashScope 未返回图片 URL")
	}

	// DashScope 返回的是临时 OSS 链接，立即下载到本地保存
	localURL, err := s.saveImageFromURL(ctx, imageURL)
	if err != nil {
		// 如果下载失败，回退返回原始 URL（临时链接，会过期）
		return imageURL, nil
	}
	return localURL, nil
}

// normalizeDashScopeSize 将 OpenAI 风格的 size 转换为 DashScope 风格。
// 1024x1024 → 1024*1024
func normalizeDashScopeSize(size string) string {
	if size == "" {
		return "1024*1024"
	}
	return strings.ReplaceAll(size, "x", "*")
}

// --- 本地保存 ---

func (s *ImageGenService) saveBase64Image(b64Data string) (string, error) {
	if err := os.MkdirAll(imagesDir, 0755); err != nil {
		return "", fmt.Errorf("创建图片目录失败: %w", err)
	}
	filename := fmt.Sprintf("img_%d_%d.png", time.Now().Unix(), time.Now().Nanosecond())
	path := filepath.Join(imagesDir, filename)
	data, err := base64.StdEncoding.DecodeString(b64Data)
	if err != nil {
		return "", fmt.Errorf("base64 解码失败: %w", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		return "", fmt.Errorf("写入图片文件失败: %w", err)
	}
	return "/api/images/file/" + filename, nil
}

// saveImageFromURL 下载远程图片到本地，返回可访问的本地路径。
func (s *ImageGenService) saveImageFromURL(ctx context.Context, imageURL string) (string, error) {
	if err := os.MkdirAll(imagesDir, 0755); err != nil {
		return "", fmt.Errorf("创建图片目录失败: %w", err)
	}

	filename := fmt.Sprintf("img_%d_%d.png", time.Now().Unix(), time.Now().Nanosecond())
	path := filepath.Join(imagesDir, filename)

	req, err := http.NewRequestWithContext(ctx, "GET", imageURL, nil)
	if err != nil {
		return "", fmt.Errorf("创建下载请求失败: %w", err)
	}

	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("下载图片失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载图片失败 (HTTP %d)", resp.StatusCode)
	}

	file, err := os.Create(path)
	if err != nil {
		return "", fmt.Errorf("创建本地图片文件失败: %w", err)
	}
	defer file.Close()

	if _, err := io.Copy(file, resp.Body); err != nil {
		return "", fmt.Errorf("保存图片内容失败: %w", err)
	}

	return "/api/images/file/" + filename, nil
}
