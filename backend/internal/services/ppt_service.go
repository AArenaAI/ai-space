package services

import (
	"aipool-backend/internal/config"
	"aipool-backend/internal/models"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"
)

type PPTService struct {
	db           *gorm.DB
	cfg          *config.Config
	imageService *ImageService
	imageGenSvc  *ImageGenService
}

// FullSlide 完整幻片片结构（包含 layout / image prompt / speaker notes）
 type FullSlide struct {
	Page         int              `json:"page"`
	Type         string           `json:"type"`
	Title        string           `json:"title"`
	Subtitle     string           `json:"subtitle,omitempty"`
	Content      []string         `json:"content"`
	Layout       string           `json:"layout"`
	Image        *SlideImage      `json:"image,omitempty"`
	Chart        *SlideChart      `json:"chart,omitempty"`
	SpeakerNotes string           `json:"speaker_notes,omitempty"`
	SourceRefs   []string         `json:"source_refs,omitempty"`
}

// SlideImage 图片配置
 type SlideImage struct {
	Needed    bool   `json:"needed"`
	Type      string `json:"type,omitempty"`
	Prompt    string `json:"prompt,omitempty"`
	Placement string `json:"placement,omitempty"` // background, right, left, bottom, full
	URL       string `json:"url,omitempty"`
}

// SlideChart 图表配置
 type SlideChart struct {
	Type   string     `json:"type,omitempty"`
	Title  string     `json:"title,omitempty"`
	Labels []string   `json:"labels,omitempty"`
	Values [][]string `json:"values,omitempty"`
}

// PPTOutline 大纲结构
 type PPTOutline struct {
	Title       string           `json:"title"`
	Subtitle    string           `json:"subtitle,omitempty"`
	Audience    string           `json:"audience,omitempty"`
	Purpose     string           `json:"purpose,omitempty"`
	Slides      []OutlineSlide   `json:"slides"`
	ImagePlan   string           `json:"image_plan,omitempty"`
}

// OutlineSlide 大纲单页
 type OutlineSlide struct {
	Page      int    `json:"page"`
	Type      string `json:"type"`
	Title     string `json:"title"`
	OneLiner  string `json:"one_liner"`
	NeedImage bool   `json:"need_image"`
}

func NewPPTService(db *gorm.DB, cfg *config.Config, imageService *ImageService, imageGenSvc *ImageGenService) *PPTService {
	s := &PPTService{db: db, cfg: cfg, imageService: imageService, imageGenSvc: imageGenSvc}
	go s.startImageWorker()
	return s
}

func (s *PPTService) DocGenModel() string {
	return s.cfg.DocGenModel
}

type GPTMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type GPTRequest struct {
	Model    string       `json:"model"`
	Messages []GPTMessage `json:"messages"`
	Stream   bool         `json:"stream"`
}

type GPTResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// callLLM 调用文本生成 API
func (s *PPTService) callLLM(ctx context.Context, systemPrompt, userPrompt string) (string, *TokenUsage, error) {
	apiKey := s.cfg.DocGenAPIKey
	baseURL := s.cfg.DocGenBaseURL
	model := s.cfg.DocGenModel
	if apiKey == "" {
		apiKey = s.cfg.OpenAIKey
	}
	if baseURL == "" {
		baseURL = s.cfg.OpenAIBaseURL
	}
	if model == "" {
		model = "gpt-4o-mini"
	}
	if apiKey == "" {
		return "", nil, fmt.Errorf("未配置 Document Generation API Key")
	}
	reqBody := GPTRequest{
		Model: model,
		Messages: []GPTMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Stream: false,
	}
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/chat/completions", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("LLM API 错误: %s", string(body))
	}
	var result GPTResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", nil, err
	}
	if len(result.Choices) == 0 {
		return "", nil, fmt.Errorf("未生成内容")
	}
	var usage *TokenUsage
	if result.Usage.TotalTokens > 0 {
		usage = &TokenUsage{
			PromptTokens:     result.Usage.PromptTokens,
			CompletionTokens: result.Usage.CompletionTokens,
			TotalTokens:      result.Usage.TotalTokens,
		}
	}
	return result.Choices[0].Message.Content, usage, nil
}

// GenerateOutline 生成 PPT 大纲
 func (s *PPTService) GenerateOutline(ctx context.Context, topic string, slideCount int, templateID, audience, purpose, language, sourceSummary string) (*PPTOutline, *TokenUsage, error) {
	if slideCount < 3 {
		slideCount = 5
	}
	if slideCount > 20 {
		slideCount = 20
	}
	systemPrompt := `你是专业 PPT 策划师。请根据主题生成 PPT 大纲结构。
以 JSON 格式返回，不要 Markdown 代码块，不要说明，只返纯 JSON：
{
  "title": "PPT 标题",
  "subtitle": "副标题",
  "audience": "受众",
  "purpose": "用途",
  "slides": [
    {"page":1,"type":"cover","title":"封面标题","one_liner":"简短描述","need_image":true},
    {"page":2,"type":"agenda","title":"目录","one_liner":"本次分享的四个部分","need_image":false},
    {"page":3,"type":"section","title":"第一部分标题","one_liner":"介绍","need_image":false},
    ...
  ],
  "image_plan": "key_slides"
}
要求：
1. 第一页 cover，第二页 agenda，最后一页 summary 或 end
2. 中间有 section 章节页分隔
3. 每页包含 page/type/title/one_liner/need_image
4. need_image 只在 cover、section、key content 页置 true
5. 内容与主题高度相关`

	userPrompt := fmt.Sprintf(`请为主题"%s"生成一份%d页的PPT大纲。
风格模板: %s
受众: %s
用途: %s
语言: %s`, topic, slideCount, templateID, audience, purpose, language)
	if sourceSummary != "" {
		userPrompt += "\n\n参考资料摘要:\n" + sourceSummary
	}
	content, usage, err := s.callLLM(ctx, systemPrompt, userPrompt)
	if err != nil {
		return nil, usage, err
	}
	var outline PPTOutline
	if err := s.extractJSON(content, &outline); err != nil {
		return nil, usage, fmt.Errorf("解析大纲失败: %w", err)
	}
	if outline.Title == "" {
		outline.Title = topic
	}
	return &outline, usage, nil
}

// GenerateFullPPT 根据大纲生成完整 PPT
 func (s *PPTService) GenerateFullPPT(ctx context.Context, outline *PPTOutline, templateID, audience, purpose, language, withImages string, withNotes bool) ([]FullSlide, *TokenUsage, error) {
	systemPrompt := `你是专业 PPT 内容策划师和视觉设计师。请根据大纲生成完整 PPT JSON。
以 JSON 格式返回，不要 Markdown 代码块，不要解释，只返纯 JSON：
{
  "title": "PPT 标题",
  "subtitle": "副标题",
  "slides": [
    {
      "page": 1,
      "type": "cover",
      "title": "页面标题",
      "subtitle": "副标题",
      "content": [],
      "layout": "cover_hero",
      "image": {
        "needed": true,
        "type": "hero",
        "prompt": "英文图片生成 prompt，描述厨房...",
        "placement": "background"
      },
      "speaker_notes": "演讲者备注"
    },
    {
      "page": 2,
      "type": "agenda",
      "title": "目录",
      "content": ["要点1","要点2","要点3"],
      "layout": "agenda_list",
      "image": {"needed":false,"prompt":"","placement":""},
      "speaker_notes": ""
    },
    ...
  ]
}
要求：
1. 每页必须包含: page, type, title, content, layout, image, speaker_notes
2. 页面 type: cover, agenda, section, content, chart, summary, end
3. layout 建议: cover_hero, cover_split, agenda_list, agenda_cards, section_center, content_left_right, content_top_bottom, chart_center, summary_bullets, end_thanks
4. image.needed 只在 cover、section、重点 content 页置 true
5. image.prompt 必须是英文描述，适合图片生成模型
6. image.placement: background, right, left, bottom
7. speaker_notes 是给演讲者看的，不显示在页面上
8. content 数组装要点，每页 3-5 个
9. 如果适合图表，添加 chart 字段并填充示例数据`

	outlineJSON, _ := json.Marshal(outline)
	userPrompt := fmt.Sprintf(`请根据以下大纲生成完整 PPT内容。
大纲: %s
模板: %s
受众: %s
用途: %s
语言: %s
配图策略: %s
演讲备注: %v`, string(outlineJSON), templateID, audience, purpose, language, withImages, withNotes)

	content, usage, err := s.callLLM(ctx, systemPrompt, userPrompt)
	if err != nil {
		return nil, usage, err
	}
	var result struct {
		Title  string      `json:"title"`
		Slides []FullSlide `json:"slides"`
	}
	if err := s.extractJSON(content, &result); err != nil {
		return nil, usage, fmt.Errorf("解析完整 PPT 失败: %w", err)
	}
	return result.Slides, usage, nil
}

// RewriteSlide 重写单页
 func (s *PPTService) RewriteSlide(ctx context.Context, slide FullSlide, instruction, audience, purpose string) (FullSlide, *TokenUsage, error) {
	systemPrompt := `你是专业 PPT 内容优化师。请根据用户指令修改单个幻灯片的内容。
以 JSON 格式返回完整 slide 对象，保持字段结构不变。
不要输出解释文字，只输出 JSON。`
	slideJSON, _ := json.Marshal(slide)
	userPrompt := fmt.Sprintf(`请修改以下幻灯片。
指令: %s
受众: %s
用途: %s
原幻灯片 JSON: %s`, instruction, audience, purpose, string(slideJSON))
	content, usage, err := s.callLLM(ctx, systemPrompt, userPrompt)
	if err != nil {
		return slide, usage, err
	}
	var newSlide FullSlide
	if err := s.extractJSON(content, &newSlide); err != nil {
		return slide, usage, fmt.Errorf("解析重写结果失败: %w", err)
	}
	// 保留原页码
	newSlide.Page = slide.Page
	return newSlide, usage, nil
}

// GenerateImagePrompt 为图片生成精修 prompt
 func (s *PPTService) GenerateImagePrompt(ctx context.Context, slide FullSlide, instruction string) (string, *TokenUsage, error) {
	systemPrompt := `你是专业视觉设计师。请为 PPT 页面编写图片生成 prompt。
输出一个简短的英文描述，直接用于图片生成模型。
不要输出任何解释文字，只输出英文 prompt。`
	slideJSON, _ := json.Marshal(slide)
	userPrompt := fmt.Sprintf(`页面内容: %s
画面指令: %s`, string(slideJSON), instruction)
	content, usage, err := s.callLLM(ctx, systemPrompt, userPrompt)
	if err != nil {
		return "", usage, err
	}
	return strings.TrimSpace(content), usage, nil
}

// GenerateImage 使用独立的 PPT 图片生成配置调用图片生成 API，底层走 ImageGenService，统一处理 base64 保存和本地 URL 构建。
func (s *PPTService) GenerateImage(ctx context.Context, prompt string) (string, *TokenUsage, error) {
	apiKey := s.cfg.PPTImageGenAPIKey
	baseURL := s.cfg.PPTImageGenBaseURL
	model := s.cfg.PPTImageGenModel

	// 回退链：PPT_IMAGE_GEN → VISION_API_KEY → OPENAI_KEY
	if apiKey == "" {
		apiKey = s.cfg.VisionAPIKey
	}
	if apiKey == "" {
		apiKey = s.cfg.OpenAIKey
	}
	if apiKey == "" {
		return "", nil, fmt.Errorf("未配置 PPT Image Generation API Key（回退链也为空）")
	}
	if baseURL == "" {
		baseURL = "https://dashscope-intl.aliyuncs.com/api/v1"
	}
	if model == "" {
		model = "qwen-image-2.0-2026-03-03"
	}

	url, err := s.imageGenSvc.Generate(ctx, baseURL, apiKey, model, prompt, "1024x1024", "")
	if err != nil {
		return "", nil, err
	}
	return url, nil, nil
}

// ExportToMarkdown 导出 Markdown
 func (s *PPTService) ExportToMarkdown(title string, slides []FullSlide) string {
	var md strings.Builder
	md.WriteString("# " + title + "\n\n")
	for _, slide := range slides {
		if slide.Type == "cover" {
			md.WriteString("## " + slide.Title + "\n")
			if slide.Subtitle != "" {
				md.WriteString("*" + slide.Subtitle + "*\n")
			}
		} else if slide.Type == "end" {
			md.WriteString("## " + slide.Title + "\n")
		} else {
			md.WriteString("## " + slide.Title + "\n")
			for _, item := range slide.Content {
				md.WriteString("- " + item + "\n")
			}
		}
		if slide.SpeakerNotes != "" {
			md.WriteString("\n> 演讲备注: " + slide.SpeakerNotes + "\n")
		}
		md.WriteString("\n---\n\n")
	}
	return md.String()
}

// GetTemplateStyle 获取模板样式
 func (s *PPTService) GetTemplateStyle(template string) map[string]interface{} {
	templates := map[string]map[string]interface{}{
		"modern": {
			"id":             "modern",
			"name":           "现代简约",
			"category":       "科技/互联网",
			"primaryColor":   "#3B82F6",
			"secondaryColor": "#1E293B",
			"bgColor":        "#FFFFFF",
			"fontHeading":    "Inter",
			"fontBody":       "Inter",
			"imageStyle":     "clean futuristic business illustration",
		},
		"business": {
			"id":             "business",
			"name":           "商务正式",
			"category":       "商务/汇报",
			"primaryColor":   "#1E3A5F",
			"secondaryColor": "#4A5568",
			"bgColor":        "#F7FAFC",
			"fontHeading":    "Georgia",
			"fontBody":       "Arial",
			"imageStyle":     "professional corporate photography",
		},
		"creative": {
			"id":             "creative",
			"name":           "创意活力",
			"category":       "营销/设计",
			"primaryColor":   "#EC4899",
			"secondaryColor": "#8B5CF6",
			"bgColor":        "#FFF5F7",
			"fontHeading":    "Helvetica",
			"fontBody":       "Arial",
			"imageStyle":     "colorful creative gradient illustration",
		},
		"minimal": {
			"id":             "minimal",
			"name":           "极简纯净",
			"category":       "严肃/高端",
			"primaryColor":   "#000000",
			"secondaryColor": "#666666",
			"bgColor":        "#FFFFFF",
			"fontHeading":    "Helvetica",
			"fontBody":       "Helvetica",
			"imageStyle":     "minimalist black and white photography",
		},
	}
	if style, ok := templates[template]; ok {
		return style
	}
	return templates["modern"]
}

// extractJSON 从文本中提取 JSON
 func (s *PPTService) extractJSON(content string, v interface{}) error {
	content = strings.TrimSpace(content)
	// 去掉 Markdown 代码块标记
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)
	// 提取第一个 JSON 对象
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start != -1 && end != -1 && end > start {
		return json.Unmarshal([]byte(content[start:end+1]), v)
	}
	return json.Unmarshal([]byte(content), v)
}

// FullSlidesToSlides 将完整 slides 转换为简化 slides（兼容旧结构）
 func FullSlidesToSlides(fullSlides []FullSlide) []models.Slide {
	slides := make([]models.Slide, len(fullSlides))
	for i, fs := range fullSlides {
		slides[i] = models.Slide{
			Title:    fs.Title,
			Content:  fs.Content,
			Subtitle: fs.Subtitle,
		}
	}
	return slides
}

// ==================== Image Worker ====================

const imageJobMaxAttempts = 3

// startImageWorker 后台定期轮询处理 PPT 图片生成 job
func (s *PPTService) startImageWorker() {
	// 等待服务初始化完成
	time.Sleep(3 * time.Second)

	// 恢复重启前未完成的 jobs
	s.recoverImageJobs()

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		var jobs []models.PPTImageJob
		if err := s.db.Where("status IN ? AND attempts < ?", []string{"pending", "failed"}, imageJobMaxAttempts).
			Order("created_at ASC").Limit(5).Find(&jobs).Error; err != nil {
			continue
		}
		if len(jobs) == 0 {
			continue
		}
		for _, job := range jobs {
			if err := s.processImageJob(job); err != nil {
				fmt.Printf("[PPT Image Worker] job %d 失败: %v\n", job.ID, err)
			}
		}
	}
}

// recoverImageJobs 将服务重启前处于 processing 状态的 job 恢复为 pending
func (s *PPTService) recoverImageJobs() {
	result := s.db.Model(&models.PPTImageJob{}).
		Where("status = ?", "processing").
		Updates(map[string]interface{}{"status": "pending"})
	if result.Error != nil {
		fmt.Printf("[PPT Image Worker] 恢复 jobs 失败: %v\n", result.Error)
	} else if result.RowsAffected > 0 {
		fmt.Printf("[PPT Image Worker] 恢复 %d 个未完成的图片生成 job\n", result.RowsAffected)
	}
}

// processImageJob 处理单个图片生成 job
func (s *PPTService) processImageJob(job models.PPTImageJob) error {
	ctx := context.Background()

	// 标记为 processing，尝试次数 +1
	if err := s.db.Model(&job).Updates(map[string]interface{}{
		"status":   "processing",
		"attempts": job.Attempts + 1,
	}).Error; err != nil {
		return fmt.Errorf("更新 job 状态失败: %w", err)
	}

	// 生成图片
	url, _, err := s.GenerateImage(ctx, job.Prompt)
	if err != nil {
		// 失败：更新为 failed
		s.db.Model(&job).Updates(map[string]interface{}{
			"status":    "failed",
			"error_msg": err.Error(),
		})
		// 更新 PPT 进度
		s.updatePPTImageProgress(job.PPTID)
		return err
	}

	// 成功：更新 job 和 PPT
	s.db.Model(&job).Updates(map[string]interface{}{
		"status":     "completed",
		"image_url":  url,
		"error_msg":  "",
	})

	// 更新 PPTGeneration 的 SlidesJSON 和 PPTSlide 表
	if err := s.updateSlideImageURL(job.PPTID, job.Page, url); err != nil {
		fmt.Printf("[PPT Image Worker] 更新 slide URL 失败: %v\n", err)
	}

	// 更新 PPT 进度
	s.updatePPTImageProgress(job.PPTID)

	return nil
}

// updateSlideImageURL 更新指定 PPT 指定页的图片 URL
func (s *PPTService) updateSlideImageURL(pptID uint, page int, url string) error {
	var gen models.PPTGeneration
	if err := s.db.First(&gen, pptID).Error; err != nil {
		return err
	}

	var slides []FullSlide
	if gen.SlidesJSON != "" {
		if err := json.Unmarshal([]byte(gen.SlidesJSON), &slides); err != nil {
			return err
		}
	}

	for i := range slides {
		if slides[i].Page == page {
			if slides[i].Image == nil {
				slides[i].Image = &SlideImage{}
			}
			slides[i].Image.URL = url
			break
		}
	}

	newJSON, _ := json.Marshal(slides)
	gen.SlidesJSON = string(newJSON)
	if err := s.db.Save(&gen).Error; err != nil {
		return err
	}

	// 更新 ppt_slides 表
	return s.db.Model(&models.PPTSlide{}).
		Where("ppt_id = ? AND page = ?", pptID, page).
		Update("image_url", url).Error
}

// updatePPTImageProgress 统计并更新 PPT 图片生成进度
func (s *PPTService) updatePPTImageProgress(pptID uint) {
	var total, completed, failed int64
	s.db.Model(&models.PPTImageJob{}).Where("ppt_id = ?", pptID).Count(&total)
	s.db.Model(&models.PPTImageJob{}).Where("ppt_id = ? AND status = ?", pptID, "completed").Count(&completed)
	s.db.Model(&models.PPTImageJob{}).Where("ppt_id = ? AND status = ? AND attempts >= ?", pptID, "failed", imageJobMaxAttempts).Count(&failed)

	if total == 0 {
		return
	}

	var gen models.PPTGeneration
	if err := s.db.First(&gen, pptID).Error; err != nil {
		return
	}

	progress := int((completed + failed) * 100 / total)
	if progress > 100 {
		progress = 100
	}

	gen.Progress = progress
	gen.ProgressMsg = fmt.Sprintf("配图生成中 %d/%d", completed+failed, total)

	// 全部完成：确定最终状态
	if completed+failed == total {
		finalStatus := models.PPTStatusCompleted
		finalMsg := "PPT 生成完成"
		if failed > 0 && completed == 0 {
			finalStatus = models.PPTStatusImageFailed
			finalMsg = "内容已生成，但配图全部失败"
		} else if failed > 0 {
			finalStatus = models.PPTStatusPartialCompleted
			finalMsg = fmt.Sprintf("内容已生成，%d 张配图失败", failed)
		}
		gen.Status = finalStatus
		gen.ProgressMsg = finalMsg
		gen.Progress = 100
	}

	s.db.Save(&gen)
}

// CreateImageJobs 为 PPT 创建图片生成 jobs（替换原裸 goroutine）
func (s *PPTService) CreateImageJobs(pptID uint, slides []FullSlide) error {
	for _, slide := range slides {
		if slide.Image != nil && slide.Image.Needed && slide.Image.Prompt != "" {
			job := models.PPTImageJob{
				PPTID:  pptID,
				Page:   slide.Page,
				Prompt: slide.Image.Prompt,
				Status: "pending",
			}
			if err := s.db.Create(&job).Error; err != nil {
				return fmt.Errorf("创建 image job 失败 (page %d): %w", slide.Page, err)
			}
		}
	}
	return nil
}
