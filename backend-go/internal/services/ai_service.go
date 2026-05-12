package services

import (
	"aipool-backend/internal/config"
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type AIService struct {
	cfg *config.Config
}

func NewAIService(cfg *config.Config) *AIService {
	return &AIService{cfg: cfg}
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`
	Stream   bool      `json:"stream"`
}

func (s *AIService) ChatCompletion(ctx context.Context, model string, messages []Message, stream bool, reasoning bool, reasoningEffort string, search bool) (io.ReadCloser, error) {
	switch {
	case isOpenAI(model):
		// GPT 系列走 Responses API (/v1/responses)，传入 search 以启用工具调用
		return s.callOpenAIResponses(ctx, model, messages, stream, reasoning, reasoningEffort, search)
	case isAnthropic(model):
		return s.callAnthropic(ctx, model, messages, stream, reasoning)
	case isGemini(model):
		return s.callGemini(ctx, model, messages, stream, reasoning)
	case isDeepSeek(model):
		return s.callDeepSeek(ctx, model, messages, stream, reasoning, reasoningEffort)
	case isMoonshot(model):
		return s.callMoonshot(ctx, model, messages, stream, reasoning)
	default:
		return s.callOpenAIResponses(ctx, "gpt-5.4-mini", messages, stream, reasoning, reasoningEffort, search)
	}
}

func isOpenAI(model string) bool {
	return strings.HasPrefix(model, "gpt-5") || strings.HasPrefix(model, "o1-") || strings.HasPrefix(model, "o3-") || strings.HasPrefix(model, "o4-")
}

// IsOpenAIResponsesModel 公开判断——该模型使用 Responses API (/v1/responses)
func IsOpenAIResponsesModel(model string) bool {
	return isOpenAI(model)
}

func isAnthropic(model string) bool {
	return strings.HasPrefix(model, "claude-")
}

func isGemini(model string) bool {
	return strings.HasPrefix(model, "gemini-")
}

func isDeepSeek(model string) bool {
	return strings.HasPrefix(model, "deepseek-")
}

func isMoonshot(model string) bool {
	return strings.HasPrefix(model, "moonshot-") || strings.HasPrefix(model, "kimi")
}

func (s *AIService) callOpenAIResponses(ctx context.Context, model string, messages []Message, stream bool, reasoning bool, reasoningEffort string, search bool) (io.ReadCloser, error) {
	if s.cfg.OpenAIKey == "" {
		return nil, fmt.Errorf("未配置 OpenAI API Key")
	}

	baseURL := "https://api.openai.com"
	if s.cfg.OpenAIBaseURL != "" {
		baseURL = s.cfg.OpenAIBaseURL
	}

	// 提取 system 消息到 input 开头
	var systemInstruction string
	var userMessages []Message
	for _, m := range messages {
		if m.Role == "system" {
			systemInstruction = m.Content
		} else {
			userMessages = append(userMessages, m)
		}
	}

	// input 数组 — 把 user/assistant 消息按原样传入
	inputItems := make([]map[string]interface{}, 0, len(userMessages))
	for _, m := range userMessages {
		inputItems = append(inputItems, map[string]interface{}{
			"role":    m.Role,
			"content": m.Content,
		})
	}

	reqBody := map[string]interface{}{
		"model":             model,
		"input":             inputItems,
		"stream":            stream,
		"max_output_tokens": 8192,
	}

	// instructions 字段处理 system prompt
	if systemInstruction != "" {
		reqBody["instructions"] = systemInstruction
	}

	// Reasoning / thinking 配置 — Responses API 使用嵌套对象
	if reasoning {
		reasoningConfig := map[string]any{}
		isGPT5 := strings.HasPrefix(model, "gpt-5")
		isOSeries := strings.Contains(model, "o1-") || strings.Contains(model, "o3-") || strings.Contains(model, "o4-")
		isGPT5Search := model == "gpt-5-search-api"

		if isOSeries || isGPT5 || isGPT5Search {
			effort := "medium"
			switch reasoningEffort {
			case "light":
				effort = "low"
			case "standard":
				effort = "medium"
			case "extended", "high":
				effort = "high"
			case "heavy", "max", "xhigh":
				effort = "xhigh"
			case "":
				effort = "medium"
			default:
				effort = reasoningEffort
			}
			reasoningConfig["effort"] = effort
			reasoningConfig["summary"] = "detailed"
			reqBody["reasoning"] = reasoningConfig
		}
	}

	// web_search tools — 仅对 GPT-5x 系列启用（Responses API 原生工具调用）
	if search {
		reqBody["tools"] = []map[string]any{
			{"type": "web_search"},
		}
	}

	jsonBody, _ := json.Marshal(reqBody)
	fmt.Printf("[OpenAI Responses] model=%s reasoning=%v effort=%s search=%v\n", model, reasoning, reasoningEffort, search)
	req, _ := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/responses", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.cfg.OpenAIKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("OpenAI Responses API 错误: %s", string(body))
	}

	return resp.Body, nil
}

func (s *AIService) callAnthropic(ctx context.Context, model string, messages []Message, stream bool, reasoning bool) (io.ReadCloser, error) {
	if s.cfg.AnthropicKey == "" {
		return nil, fmt.Errorf("未配置 Anthropic API Key")
	}

	baseURL := "https://api.anthropic.com"
	if s.cfg.AnthropicBaseURL != "" {
		baseURL = s.cfg.AnthropicBaseURL
	}

	// 提取 system 消息
	var systemMsg string
	var userMsgs []Message
	for _, m := range messages {
		if m.Role == "system" {
			systemMsg = m.Content
		} else {
			userMsgs = append(userMsgs, m)
		}
	}

	reqBody := map[string]interface{}{
		"model":      model,
		"messages":   userMsgs,
		"stream":     stream,
		"max_tokens": 4096,
	}
	if systemMsg != "" {
		reqBody["system"] = systemMsg
	}

	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/messages", bytes.NewBuffer(jsonBody))
	req.Header.Set("x-api-key", s.cfg.AnthropicKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("Anthropic API 错误: %s", string(body))
	}

	return resp.Body, nil
}

func (s *AIService) callGemini(ctx context.Context, model string, messages []Message, stream bool, reasoning bool) (io.ReadCloser, error) {
	return nil, fmt.Errorf("Gemini 暂未实现")
}

func (s *AIService) callDeepSeek(ctx context.Context, model string, messages []Message, stream bool, reasoning bool, reasoningEffort string) (io.ReadCloser, error) {
	if s.cfg.DeepSeekKey == "" {
		return nil, fmt.Errorf("未配置 DeepSeek API Key")
	}

	baseURL := "https://api.deepseek.com"
	if s.cfg.DeepSeekBaseURL != "" {
		baseURL = s.cfg.DeepSeekBaseURL
	}

	reqBody := map[string]interface{}{
		"model":    model,
		"messages": messages,
		"stream":   stream,
	}

	// DeepSeek V4 Pro 默认启用 thinking，必须显式指定 type 来控制
	if reasoning {
		reqBody["thinking"] = map[string]string{"type": "enabled"}
		// 默认 high，只有显式传入 max 才用 max
		effort := "high"
		if reasoningEffort == "max" {
			effort = "max"
		}
		reqBody["reasoning_effort"] = effort
	} else {
		reqBody["thinking"] = map[string]string{"type": "disabled"}
	}

	jsonBody, _ := json.Marshal(reqBody)
	// 日志记录实际发送的参数，便于排查
	fmt.Printf("[DeepSeek] model=%s reasoning=%v effort=%s body_len=%d\n", model, reasoning, reasoningEffort, len(jsonBody))
	req, _ := http.NewRequestWithContext(ctx, "POST", baseURL+"/v1/chat/completions", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.cfg.DeepSeekKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("DeepSeek API 错误: %s", string(body))
	}

	return resp.Body, nil
}

func (s *AIService) callMoonshot(ctx context.Context, model string, messages []Message, stream bool, reasoning bool) (io.ReadCloser, error) {
	return nil, fmt.Errorf("Moonshot 暂未实现")
}

// StreamOpenAIResponses 解析 Responses API 的流式 SSE 事件，将其转换为
// 前端 Chat Completions 格式的 data: {...} SSE，保持前端无痛迁移。
func (s *AIService) StreamOpenAIResponses(body io.ReadCloser, w io.Writer, reasoningEnabled bool) (string, error) {
	defer body.Close()
	scanner := bufio.NewScanner(body)

	var eventType string
	var fullContent strings.Builder
	var sentDone bool
	var webSearchCount int
	var thinkOpened bool // 是否已输出 <think>（只输出一次）

	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "event: ") {
			eventType = strings.TrimPrefix(line, "event: ")
			continue
		}

		if strings.HasPrefix(line, "data: ") {
			data := line[6:]
			if data == "" {
				continue
			}

			switch eventType {
			case "response.output_text.delta":
				var evt struct {
					Delta string `json:"delta"`
					Index int    `json:"index"`
				}
				if err := json.Unmarshal([]byte(data), &evt); err != nil || evt.Delta == "" {
					continue
				}
				// 最终答案开始前，关闭 <think>（如果有）
				if reasoningEnabled && thinkOpened {
					thinkOpened = false
					s.writeContent(w, "</think>")
					fullContent.WriteString("</think>")
				}
				s.writeContent(w, evt.Delta)
				fullContent.WriteString(evt.Delta)

			case "response.reasoning_summary_text.delta", "response.reasoning_summary.delta", "response.reasoning.delta":
				var evt struct {
					Delta string `json:"delta"`
					Index int    `json:"index"`
				}
				if err := json.Unmarshal([]byte(data), &evt); err != nil || evt.Delta == "" {
					continue
				}
				if reasoningEnabled {
					if !thinkOpened {
						// 如果 think 已关闭（output_text 已经开始），后续 reasoning 事件不再重新开 <think>
						// 否则正文中会混入不带 <think> 包裹的思考内容
						fullContent.WriteString(evt.Delta)
						continue
					}
					s.writeContent(w, evt.Delta)
					fullContent.WriteString(evt.Delta)
				}

			case "response.done":
				if reasoningEnabled && thinkOpened {
					thinkOpened = false
					s.writeContent(w, "</think>")
					fullContent.WriteString("</think>")
				}
				s.writeSSE(w, "[DONE]")
				sentDone = true
				continue

			case "response.output_item.added":
				if reasoningEnabled {
					var evt struct {
						Item struct {
							Type string `json:"type"`
						} `json:"item"`
					}
					if err := json.Unmarshal([]byte(data), &evt); err == nil {
						if evt.Item.Type == "function_call" || evt.Item.Type == "web_search_call" {
							// 搜索提示输出在 <think> 内
						if !thinkOpened {
							thinkOpened = true
							s.writeContent(w, "<think>")
							fullContent.WriteString("<think>")
						}
							webSearchCount++
							if webSearchCount == 1 {
								s.writeContent(w, "🔍 正在搜索相关信息...\\n\\n")
								fullContent.WriteString("🔍 正在搜索相关信息...\\n\\n")
							} else {
								s.writeContent(w, "🔍 补充搜索...\\n\\n")
								fullContent.WriteString("🔍 补充搜索...\\n\\n")
							}
						}
					}
				}
				continue

			case "response.web_search_call.in_progress", "response.web_search_call.searching":
				continue

			case "response.web_search_call.completed":
				if reasoningEnabled {
					if !thinkOpened {
						thinkOpened = true
						s.writeContent(w, "<think>")
						fullContent.WriteString("<think>")
					}
					s.writeContent(w, "✅ 搜索完成，正在分析结果...\\n\\n")
					fullContent.WriteString("✅ 搜索完成，正在分析结果...\\n\\n")
				}
				continue

			case "response.output_item.done":
				// 不再处理 reasoning 的关闭，由 output_text.delta 或 response.done 统一关闭
				continue

			case "response.error":
				var evt struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				}
				json.Unmarshal([]byte(data), &evt)
				s.writeContent(w, fmt.Sprintf("❌ API 错误: %s - %s", evt.Code, evt.Message))
				fullContent.WriteString(fmt.Sprintf("❌ API 错误: %s - %s", evt.Code, evt.Message))
				s.writeSSE(w, "[DONE]")
				sentDone = true
				continue

			default:
				// 忽略其他事件（response.created, response.in_progress, response.output_item.added 等）
				continue
			}
		}
	}

	// 安全兜底：如果流结束还没收到 response.done，补发 [DONE]
	if !sentDone {
		if reasoningEnabled && thinkOpened {
			s.writeContent(w, "</think>")
			fullContent.WriteString("</think>")
		}
		s.writeSSE(w, "[DONE]")
	}

	return strings.TrimSpace(fullContent.String()), scanner.Err()
}

func (s *AIService) writeContent(w io.Writer, text string) {
	// 输出为前端兼容的 Chat Completions data 格式
	out, _ := json.Marshal(map[string]interface{}{
		"choices": []map[string]interface{}{
			{
				"index": 0,
				"delta": map[string]string{
					"content": text,
				},
			},
		},
	})
	w.Write([]byte("data: " + string(out) + "\n\n"))
}

func (s *AIService) writeSSE(w io.Writer, msg string) {
	w.Write([]byte("data: " + msg + "\n\n"))
}
