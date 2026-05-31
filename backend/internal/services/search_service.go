package services

import (
	"aipool-backend/internal/config"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var (
	htmlTagRe    = regexp.MustCompile(`<[^>]+>`)
	scriptRe     = regexp.MustCompile(`(?is)<script\b[^>]*>.*?</script>`)
	styleRe      = regexp.MustCompile(`(?is)<style\b[^>]*>.*?</style>`)
	noscriptRe   = regexp.MustCompile(`(?is)<noscript\b[^>]*>.*?</noscript>`)
	whitespaceRe = regexp.MustCompile(`\s+`)
)

type SearchService struct {
	cfg *config.Config
}

func NewSearchService(cfg *config.Config) *SearchService {
	return &SearchService{cfg: cfg}
}

type SearchResult struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Description string `json:"description"`
}

// --- Tavily API ---

type tavilyRequest struct {
	APIKey            string `json:"api_key"`
	Query             string `json:"query"`
	SearchDepth       string `json:"search_depth"`
	IncludeAnswer     bool   `json:"include_answer"`
	IncludeImages     bool   `json:"include_images"`
	IncludeRawContent bool   `json:"include_raw_content"`
	MaxResults        int    `json:"max_results"`
}

type tavilySource struct {
	Title      string `json:"title"`
	URL        string `json:"url"`
	Content    string `json:"content"`
	RawContent string `json:"raw_content"`
}

type tavilyResponse struct {
	Query        string         `json:"query"`
	Answer       string         `json:"answer"`
	Results      []tavilySource `json:"results"`
	ResponseTime float64        `json:"response_time"`
}

func (s *SearchService) searchTavily(query string) (string, []SearchResult, error) {
	apiKey := s.cfg.TavilySearchKey
	if apiKey == "" {
		return "", nil, fmt.Errorf("Tavily API Key 未配置")
	}

	reqBody := tavilyRequest{
		APIKey:            apiKey,
		Query:             query,
		SearchDepth:       "basic",
		IncludeAnswer:     true,
		IncludeImages:     false,
		IncludeRawContent: false,
		MaxResults:        8,
	}
	// 默认优先中文搜索结果
	reqBody.Query = query + " 中国"

	bodyBytes, _ := json.Marshal(reqBody)
	req, err := http.NewRequest("POST", "https://api.tavily.com/search", bytes.NewReader(bodyBytes))
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Tavily] HTTP 请求失败: %v", err)
		return "", nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		preview := string(body)
		if len(preview) > 200 {
			preview = preview[:200]
		}
		log.Printf("[Tavily] API 返回状态码: %d, body: %s", resp.StatusCode, preview)
		return "", nil, fmt.Errorf("Tavily API 返回状态码: %d", resp.StatusCode)
	}

	var result tavilyResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[Tavily] JSON 解析失败: %v", err)
		return "", nil, err
	}

	if len(result.Results) == 0 {
		log.Printf("[Tavily] 未找到任何结果: %s", query)
		return "", nil, fmt.Errorf("未找到相关搜索结果")
	}

	log.Printf("[Tavily] 查询 '%s' 返回 %d 条结果 (%.2fs)", query, len(result.Results), result.ResponseTime)

	var sb strings.Builder
	sb.WriteString("【任务指令】你已通过联网搜索获取了实时信息，以下是搜索结果。你必须基于这些搜索结果来回答用户问题，不能说自己没有联网功能或知识截止于某个日期。如果搜索结果中的信息足以回答，请直接基于结果回答。如果结果不足，请基于结果能回答多少回答多少。\n\n")
	sb.WriteString("以下是实时网络搜索结果：\n\n")

	var sources []SearchResult
	for i, r := range result.Results {
		title := stripHTML(r.Title)
		content := stripHTML(r.Content)
		if content == "" {
			content = stripHTML(r.RawContent)
		}
		if len(content) > 500 {
			content = content[:500]
		}

		sources = append(sources, SearchResult{
			Title:       title,
			URL:         r.URL,
			Description: content,
		})
		sb.WriteString(fmt.Sprintf("[%d] %s\nURL: %s\n内容: %s\n\n", i+1, title, r.URL, content))
	}

	// 如果有 Tavily 的 summarised answer，也放进去
	if result.Answer != "" {
		sb.WriteString(fmt.Sprintf("综合摘要: %s\n\n", result.Answer))
	}

	sb.WriteString("【回答要求】\n1. 基于上述搜索结果回答用户问题\n2. 在相关事实后标注 [1] [2] 等引用编号\n3. 回答末尾列出所有引用的来源\n4. 你必须基于搜索结果回答，不能说'我没有联网功能'或'知识截止于'或类似话术——你确实已经联网了，搜索结果就在上面")

	return sb.String(), sources, nil
}

// --- Brave Search (fallback) ---

type braveWebResult struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Description string `json:"description"`
}

type braveNewsResult struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Description string `json:"description"`
}

type braveResponse struct {
	Web struct {
		Results []braveWebResult `json:"results"`
	} `json:"web"`
	News struct {
		Results []braveNewsResult `json:"results"`
	} `json:"news"`
}

func (s *SearchService) searchBrave(query string) (string, []SearchResult, error) {
	if s.cfg.BraveSearchKey == "" {
		return "", nil, fmt.Errorf("未配置 Brave Search API Key")
	}

	if strings.TrimSpace(query) == "" {
		return "", nil, fmt.Errorf("搜索查询为空")
	}

	baseURL := "https://api.search.brave.com/res/v1/web/search"
	u, _ := url.Parse(baseURL)
	q := u.Query()
	q.Set("q", query)
	q.Set("count", "8")
	q.Set("offset", "0")
	u.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Subscription-Token", s.cfg.BraveSearchKey)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Brave Search] HTTP 请求失败: %v", err)
		return "", nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[Brave Search] API 返回状态码: %d", resp.StatusCode)
		return "", nil, fmt.Errorf("Brave Search API 返回状态码: %d", resp.StatusCode)
	}

	var result braveResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[Brave Search] JSON 解析失败: %v", err)
		return "", nil, err
	}

	var allResults []braveWebResult
	allResults = append(allResults, result.Web.Results...)
	for _, n := range result.News.Results {
		if len(allResults) >= 10 {
			break
		}
		allResults = append(allResults, braveWebResult{
			Title:       n.Title,
			URL:         n.URL,
			Description: n.Description,
		})
	}

	if len(allResults) == 0 {
		log.Printf("[Brave Search] 未找到任何结果: %s", query)
		return "", nil, fmt.Errorf("未找到相关搜索结果")
	}

	log.Printf("[Brave Search] 查询 '%s' 返回 %d 条结果", query, len(allResults))

	var sb strings.Builder
	sb.WriteString("【任务指令】你已通过联网搜索获取了实时信息，以下是搜索结果。你必须基于这些搜索结果来回答用户问题，不能说自己没有联网功能或知识截止于某个日期。如果搜索结果中的信息足以回答，请直接基于结果回答。如果结果不足，请基于结果能回答多少回答多少。\n\n")
	sb.WriteString("以下是实时网络搜索结果：\n\n")

	var sources []SearchResult
	for i, r := range allResults {
		if i >= 8 {
			break
		}
		title := stripHTML(r.Title)
		desc := stripHTML(r.Description)
		sources = append(sources, SearchResult{
			Title:       title,
			URL:         r.URL,
			Description: desc,
		})
		sb.WriteString(fmt.Sprintf("[%d] %s\nURL: %s\n摘要: %s\n\n", i+1, title, r.URL, desc))

		// 只对前3条抓正文
		if i < 3 {
			pageText := fetchPageText(r.URL)
			if pageText != "" {
				sb.WriteString(fmt.Sprintf("正文: %s\n", pageText))
			}
		}
	}
	sb.WriteString("【回答要求】\n1. 基于上述搜索结果回答用户问题\n2. 在相关事实后标注 [1] [2] 等引用编号\n3. 回答末尾列出所有引用的来源\n4. 不许说自己没有联网功能或知识截止于某个日期")

	return sb.String(), sources, nil
}

// Search 联网搜索入口 — Tavily 为主，Brave 为 fallback
// timezone 可选参数，传用户的时区（如 "Asia/Shanghai"），用于注入本地时间信息
func (s *SearchService) Search(query, timezone string) (string, []SearchResult, error) {
	// 优先 Tavily
	if s.cfg.TavilySearchKey != "" {
		content, sources, err := s.searchTavily(query)
		if err == nil {
			content, sources = s.injectTimezone(content, sources, timezone)
			return content, sources, nil
		}
		log.Printf("[Search] Tavily 搜索失败，降级到 Brave: %v", err)
	}

	// Fallback 到 Brave
	content, sources, err := s.searchBrave(query)
	if err != nil {
		return "", nil, err
	}
	content, sources = s.injectTimezone(content, sources, timezone)
	return content, sources, nil
}

// injectTimezone 在搜索结果末尾追加用户时区信息
func (s *SearchService) injectTimezone(searchContent string, sources []SearchResult, timezone string) (string, []SearchResult) {
	if timezone == "" {
		return searchContent, sources
	}
	localTime := CurrentTimeInTimezone(timezone)
	if localTime == "" {
		return searchContent, sources
	}

	var sb strings.Builder
	sb.WriteString(searchContent)
	sb.WriteString("\n\n用户本地时间信息（通过 IP 自动获取）:\n")
	sb.WriteString(fmt.Sprintf("- 时区: %s\n", timezone))
	sb.WriteString(fmt.Sprintf("- 当前本地时间: %s\n", localTime))
	sb.WriteString(fmt.Sprintf("- 与 UTC 偏移: 请根据时区 %s 自行计算\n\n", timezone))

	sb.WriteString("【关于时间的特别说明】如果用户的问题涉及时间查询，用户就在时区 " + timezone + "，当前本地时间是 " + localTime + "。请直接用这个时间回答，不需要再问用户在哪里。\n")

	return sb.String(), sources
}

// GetUserTimezoneByIP 通过 IP 获取用户时区
func GetUserTimezoneByIP(clientIP string) string {
	if clientIP == "" || clientIP == "127.0.0.1" || clientIP == "::1" || strings.HasPrefix(clientIP, "10.") || strings.HasPrefix(clientIP, "172.") || strings.HasPrefix(clientIP, "192.168.") {
		return "Asia/Shanghai"
	}

	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("GET", "http://ip-api.com/json/"+clientIP, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	var result struct {
		Status   string `json:"status"`
		Timezone string `json:"timezone"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return ""
	}
	if result.Status != "success" {
		return ""
	}
	return result.Timezone
}

// CurrentTimeInTimezone 获取指定时区的当前时间字符串
func CurrentTimeInTimezone(timezone string) string {
	if timezone == "" {
		return ""
	}
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return ""
	}
	return time.Now().In(loc).Format("2006-01-02 15:04:05 Monday")
}

func stripHTML(s string) string {
	return htmlTagRe.ReplaceAllString(s, "")
}

// fetchPageText 获取网页正文内容（用于 Brave fallback 的正文抓取）
func fetchPageText(pageURL string) string {
	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0")

	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ""
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return ""
	}

	text := string(body)
	text = scriptRe.ReplaceAllString(text, " ")
	text = styleRe.ReplaceAllString(text, " ")
	text = noscriptRe.ReplaceAllString(text, " ")
	text = htmlTagRe.ReplaceAllString(text, " ")
	text = whitespaceRe.ReplaceAllString(text, " ")
	text = strings.TrimSpace(text)

	const maxLen = 3000
	if len(text) > maxLen {
		cut := text[:maxLen]
		if idx := strings.LastIndexAny(cut, "。.!?"); idx > maxLen/2 {
			cut = cut[:idx+1]
		}
		text = cut
	}
	return text
}
