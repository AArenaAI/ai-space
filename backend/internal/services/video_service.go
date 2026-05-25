package services

import (
	"context"
	"fmt"
	"github.com/volcengine/volcengine-go-sdk/service/arkruntime"
	"github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"
	"github.com/volcengine/volcengine-go-sdk/volcengine"
)

// VideoService 封装火山引擎 Ark 视频生成 API（使用官方 SDK）
type VideoService struct {
	client *arkruntime.Client
}

// NewVideoService 创建视频生成服务
func NewVideoService(apiKey string, baseURL string) *VideoService {
	opts := []arkruntime.ConfigOption{}
	if baseURL != "" {
		opts = append(opts, arkruntime.WithBaseUrl(baseURL))
	}
	client := arkruntime.NewClientWithApiKey(apiKey, opts...)
	return &VideoService{client: client}
}

// CreateVideoTaskRequest 创建视频任务请求参数
type CreateVideoTaskRequest struct {
	Model           string
	Prompt          string
	Ratio           string
	Resolution      string
	Duration        int64
	GenerateAudio   bool
	Watermark       bool
	ReferenceImages []string // 可选的参考图 URL
	ReferenceVideos []string // 可选的参考视频 URL（当前 SDK 分支暂不下发，仅保留 API 兼容）
	ReferenceAudios []string // 可选的参考音频 URL（当前 SDK 分支暂不下发，仅保留 API 兼容）
}

// CreateVideoTaskResult 创建视频任务返回结果
type CreateVideoTaskResult struct {
	TaskID string
	Status string
}

// CreateVideoTask 创建视频生成任务
func (s *VideoService) CreateVideoTask(ctx context.Context, req CreateVideoTaskRequest) (*CreateVideoTaskResult, error) {
	content := []*model.CreateContentGenerationContentItem{
		{
			Type: model.ContentGenerationContentItemTypeText,
			Text: volcengine.String(req.Prompt),
		},
	}

	// 添加参考图
	for _, url := range req.ReferenceImages {
		content = append(content, &model.CreateContentGenerationContentItem{
			Type: model.ContentGenerationContentItemType("image_url"),
			ImageURL: &model.ImageURL{
				URL: url,
			},
			Role: volcengine.String("reference_image"),
		})
	}

	createReq := model.CreateContentGenerationTaskRequest{
		Model:         req.Model,
		GenerateAudio: volcengine.Bool(req.GenerateAudio),
		Duration:      volcengine.Int64(req.Duration),
		Watermark:     volcengine.Bool(req.Watermark),
		Content:       content,
	}
	if req.Resolution != "" {
		createReq.Resolution = volcengine.String(req.Resolution)
	}
	if req.Ratio != "" {
		createReq.Ratio = volcengine.String(req.Ratio)
	}

	resp, err := s.client.CreateContentGenerationTask(ctx, createReq)
	if err != nil {
		return nil, fmt.Errorf("create video task failed: %w", err)
	}

	return &CreateVideoTaskResult{
		TaskID: resp.ID,
		Status: "pending",
	}, nil
}

// VideoTaskResult 查询视频任务结果
type VideoTaskResult struct {
	TaskID           string
	Status           string // pending | running | succeeded | failed
	VideoURL         string
	CompletionTokens int
	CreatedAt        int64
	UpdatedAt        int64
	ErrorCode        string
	ErrorMessage     string
}

// GetVideoTask 查询视频生成任务状态
func (s *VideoService) GetVideoTask(ctx context.Context, taskID string) (*VideoTaskResult, error) {
	getReq := model.GetContentGenerationTaskRequest{ID: taskID}
	resp, err := s.client.GetContentGenerationTask(ctx, getReq)
	if err != nil {
		return nil, fmt.Errorf("get video task failed: %w", err)
	}

	result := &VideoTaskResult{
		TaskID:           resp.ID,
		Status:           resp.Status,
		CompletionTokens: resp.Usage.CompletionTokens,
		CreatedAt:        resp.CreatedAt,
		UpdatedAt:        resp.UpdatedAt,
	}

	result.VideoURL = resp.Content.VideoURL

	if resp.Error != nil {
		result.ErrorCode = resp.Error.Code
		result.ErrorMessage = resp.Error.Message
	}

	return result, nil
}
