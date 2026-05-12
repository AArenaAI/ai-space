package services

import (
	"aipool-backend/internal/config"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type PPTService struct {
	cfg *config.Config
}

// Slide PPT幻灯片
type Slide struct {
	Title    string   `json:"title"`
	Content  []string `json:"content"`
	Subtitle string   `json:"subtitle,omitempty"`
}

// PPTGeneration PPT生成记录
type PPTGeneration struct {
	ID         uint   `json:"id" gorm:"primaryKey"`
	UserID     uint   `json:"user_id"`
	Topic      string `json:"topic"`
	Template   string `json:"template"`
	SlidesJSON string `json:"slides_json"`
	SlideCount int    `json:"slide_count"`
	Status     string `json:"status"`
	CreatedAt  string `json:"created_at"`
}

func NewPPTService(cfg *config.Config) *PPTService {
	return &PPTService{cfg: cfg}
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
}

// GeneratePPT 生成PPT内容
func (s *PPTService) GeneratePPT(ctx context.Context, topic string, slideCount int, template string) ([]Slide, error) {
	if s.cfg.OpenAIKey == "" {
		return nil, fmt.Errorf("未配置 OpenAI API Key")
	}

	if slideCount < 3 {
		slideCount = 5
	}
	if slideCount > 20 {
		slideCount = 20
	}

	systemPrompt := `你是一个专业的PPT设计师。请根据主题生成PPT大纲和内容。
请以JSON格式返回，格式如下:
{
  "slides": [
    {
      "title": "页面标题",
      "subtitle": "副标题（可选）",
      "content": ["要点1", "要点2", "要点3"]
    }
  ]
}
要求:
1. 第一页是封面，包含title和subtitle
2. 最后一页是结束页，内容是总结或感谢
3. 中间页面要有清晰的逻辑结构
4. 每页内容不要超过5个要点
5. 内容要简洁有力，适合演讲`

	userPrompt := fmt.Sprintf("请为主题: %s 生成一份%d页的PPT大纲。风格模板: %s", topic, slideCount, template)

	reqBody := GPTRequest{
		Model: "gpt-4o-mini",
		Messages: []GPTMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Stream: false,
	}

	baseURL := "https://api.openai.com"
	if s.cfg.OpenAIBaseURL != "" {
		baseURL = s.cfg.OpenAIBaseURL
	}

	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/chat/completions", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.cfg.OpenAIKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("OpenAI API 错误: %s", string(body))
	}

	var result GPTResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}

	if len(result.Choices) == 0 {
		return nil, fmt.Errorf("未生成内容")
	}

	content := result.Choices[0].Message.Content
	var pptData struct {
		Slides []Slide `json:"slides"`
	}

	if err := json.Unmarshal([]byte(content), &pptData); err != nil {
		start := bytes.Index([]byte(content), []byte("{"))
		end := bytes.LastIndex([]byte(content), []byte("}"))
		if start != -1 && end != -1 && end > start {
			if err := json.Unmarshal([]byte(content[start:end+1]), &pptData); err != nil {
				return nil, fmt.Errorf("解析PPT内容失败: %v", err)
			}
		} else {
			return nil, fmt.Errorf("解析PPT内容失败")
		}
	}

	return pptData.Slides, nil
}

// GetTemplateStyle 获取模板样式配置
func (s *PPTService) GetTemplateStyle(template string) map[string]interface{} {
	templates := map[string]map[string]interface{}{
		"modern": {
			"name":           "现代简约",
			"primaryColor":   "#3B82F6",
			"secondaryColor": "#1E293B",
			"bgColor":        "#FFFFFF",
			"fontHeading":    "Arial",
			"fontBody":       "Arial",
		},
		"business": {
			"name":           "商务正式",
			"primaryColor":   "#1E3A5F",
			"secondaryColor": "#4A5568",
			"bgColor":        "#F7FAFC",
			"fontHeading":    "Georgia",
			"fontBody":       "Arial",
		},
		"creative": {
			"name":           "创意活力",
			"primaryColor":   "#EC4899",
			"secondaryColor": "#8B5CF6",
			"bgColor":        "#FFF5F7",
			"fontHeading":    "Helvetica",
			"fontBody":       "Arial",
		},
		"minimal": {
			"name":           "极简纯净",
			"primaryColor":   "#000000",
			"secondaryColor": "#666666",
			"bgColor":        "#FFFFFF",
			"fontHeading":    "Helvetica",
			"fontBody":       "Helvetica",
		},
	}

	if style, ok := templates[template]; ok {
		return style
	}
	return templates["modern"]
}
