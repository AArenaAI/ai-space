package services

import (
	"aipool-backend/internal/config"
	"context"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"time"

	openai "github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
)

type namedContentTypeReader struct {
	io.Reader
	filename    string
	contentType string
}

func (r namedContentTypeReader) Filename() string {
	return r.filename
}

func (r namedContentTypeReader) ContentType() string {
	return r.contentType
}

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
// 保持旧调用签名；内部走 OpenAI SDK EditStreaming，最终图片以 base64 返回给调用方保存。
func (s *ImageService) EditImage(ctx context.Context, prompt string, size string, referenceImagePaths []string) (imageURL string, b64Data string, err error) {
	return s.EditImageStream(ctx, prompt, size, "", referenceImagePaths, nil)
}

// EditImageStream 基于参考图编辑生成图片，走 OpenAI SDK Images EditStreaming。
// onEvent 会收到 image_edit.partial_image / image_edit.completed 的 base64 图片数据。
func (s *ImageService) EditImageStream(ctx context.Context, prompt string, size string, quality string, referenceImagePaths []string, onEvent func(ImageStreamEvent) error) (imageURL string, b64Data string, err error) {
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

	if size == "" {
		size = "1024x1024"
	}
	if len(referenceImagePaths) == 0 {
		return "", "", fmt.Errorf("未指定参考图文件路径")
	}

	model := s.cfg.ImageGenModel
	if model == "" || model == "qwen-image-2.0-2026-03-03" || model == "qwen-image" {
		model = "gpt-image-2"
	}

	files := make([]*os.File, 0, len(referenceImagePaths))
	readers := make([]io.Reader, 0, len(referenceImagePaths))
	for _, path := range referenceImagePaths {
		file, openErr := os.Open(path)
		if openErr != nil {
			for _, f := range files {
				_ = f.Close()
			}
			if os.IsNotExist(openErr) {
				return "", "", fmt.Errorf("参考图文件不存在: %s", path)
			}
			return "", "", fmt.Errorf("打开参考图文件失败: %w", openErr)
		}
		filename := filepath.Base(path)
		contentType := mime.TypeByExtension(filepath.Ext(filename))
		if contentType == "" {
			contentType = "image/png"
		}
		files = append(files, file)
		readers = append(readers, namedContentTypeReader{Reader: file, filename: filename, contentType: contentType})
	}
	defer func() {
		for _, f := range files {
			_ = f.Close()
		}
	}()

	imageParam := openai.ImageEditParamsImageUnion{}
	if len(readers) == 1 {
		imageParam.OfFile = readers[0]
	} else {
		imageParam.OfFileArray = readers
	}

	params := openai.ImageEditParams{
		Image:         imageParam,
		Prompt:        prompt,
		Model:         openai.ImageModel(model),
		N:             openai.Int(1),
		PartialImages: openai.Int(3),
		Size:          openai.ImageEditParamsSize(size),
	}
	if quality != "" {
		params.Quality = openai.ImageEditParamsQuality(quality)
	}

	client := openai.NewClient(
		option.WithBaseURL("https://api.openai.com/v1"),
		option.WithAPIKey(apiKey),
	)
	stream := client.Images.EditStreaming(ctx, params)
	defer stream.Close()

	var finalB64 string
	for stream.Next() {
		event := stream.Current()
		if event.B64JSON == "" {
			continue
		}
		if onEvent != nil {
			if cbErr := onEvent(ImageStreamEvent{Type: event.Type, B64JSON: event.B64JSON}); cbErr != nil {
				return "", "", cbErr
			}
		}
		if event.Type == "image_edit.completed" {
			finalB64 = event.B64JSON
		}
	}
	if stream.Err() != nil {
		return "", "", fmt.Errorf("OpenAI Images Edit stream 失败: %w", stream.Err())
	}
	if finalB64 == "" {
		return "", "", fmt.Errorf("未生成图片 (EditStreaming 未返回 completed 图片)")
	}
	return "", finalB64, nil
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

func (s *ImageService) GenerateImageStream(ctx context.Context, prompt string, size string, quality string, onEvent func(ImageStreamEvent) error) (imageURL string, b64Data string, err error) {
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
	url, err := s.imageGenSvc.GenerateOpenAICompatibleImageStream(ctx, "https://api.openai.com", apiKey, model, prompt, size, quality, onEvent)
	if err != nil {
		return "", "", err
	}
	return url, "", nil
}
