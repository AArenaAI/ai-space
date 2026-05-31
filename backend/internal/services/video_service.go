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
	ReferenceVideos []string // 可选的参考视频 URL
	ReferenceAudios []string // 可选的参考音频 URL（当前暂不下发，仅保留 API 兼容）
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

	// 添加参考图。
	// 1 张图：强约束为首帧；2 张图：强约束为首尾帧；3 张及以上：按官方多模态参考图处理。
	imageRole := func(index, total int) string {
		// 火山 Seedance 不允许 first_frame/last_frame 与 reference_video 同时下发。
		// 同时有参考视频时，图片统一作为弱参考图；只有纯图片参考时才强约束首/尾帧。
		if len(req.ReferenceVideos) > 0 {
			return "reference_image"
		}
		if total == 1 {
			return "first_frame"
		}
		if total == 2 {
			if index == 0 {
				return "first_frame"
			}
			return "last_frame"
		}
		return "reference_image"
	}
	for index, url := range req.ReferenceImages {
		content = append(content, &model.CreateContentGenerationContentItem{
			Type: model.ContentGenerationContentItemTypeImage,
			ImageURL: &model.ImageURL{
				URL: url,
			},
			Role: volcengine.String(imageRole(index, len(req.ReferenceImages))),
		})
	}

	// 添加参考视频
	for _, url := range req.ReferenceVideos {
		content = append(content, &model.CreateContentGenerationContentItem{
			Type: model.ContentGenerationContentItemTypeVideo,
			VideoURL: &model.VideoUrl{
				Url: url,
			},
			Role: volcengine.String("reference_video"),
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
