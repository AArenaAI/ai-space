package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type GaokaoAdvisorExternalSourceHit struct {
	Query      string `json:"query"`
	Title      string `json:"title"`
	URL        string `json:"url"`
	SourceType string `json:"source_type"`
	Status     string `json:"status"` // found | planned | error
	Note       string `json:"note"`
}

func BuildGaokaoAdvisorLookupQueries(profile GaokaoProfile, message string) []string {
	province := defaultGaokaoAdvisorString(strings.TrimSpace(profile.Province), "广东")
	subjects := defaultGaokaoAdvisorString(strings.TrimSpace(profile.Subjects), "物理类")
	major := ""
	if len(profile.PreferredMajors) > 0 {
		major = profile.PreferredMajors[0]
	}
	queries := []string{
		fmt.Sprintf("%s 2025 %s 本科批 投档线 最低位次 职业技术大学", province, subjects),
		fmt.Sprintf("%s 2025 %s 本科批 民办本科 最低位次", province, subjects),
		fmt.Sprintf("%s 教育考试院 2025 本科批 投档情况 %s 位次", province, subjects),
	}
	if major != "" {
		queries = append(queries, fmt.Sprintf("%s 2025 %s 本科批 %s 民办本科 职业技术大学 最低位次", province, subjects, major))
	}
	if profile.Rank > 0 {
		queries = append(queries, fmt.Sprintf("%s %s %d 位次 本科 边缘 志愿 推荐 官方 投档线", province, subjects, profile.Rank))
	}
	if containsFold(message, "省内") || containsFold(message, province) {
		queries = append(queries, fmt.Sprintf("%s 2025 省内 职业技术大学 本科批 %s 最低位次", province, subjects))
	}
	if len(queries) > 6 {
		queries = queries[:6]
	}
	return queries
}

func LookupGaokaoAdvisorSources(ctx context.Context, profile GaokaoProfile, message string) []GaokaoAdvisorExternalSourceHit {
	queries := BuildGaokaoAdvisorLookupQueries(profile, message)
	hits := []GaokaoAdvisorExternalSourceHit{}
	client := &http.Client{Timeout: 6 * time.Second}
	for _, q := range queries {
		found, err := searchGaokaoAdvisorDuckDuckGo(ctx, client, q)
		if err != nil || len(found) == 0 {
			note := "已生成补查查询，搜索暂未返回可解析来源"
			if err != nil {
				note = err.Error()
			}
			hits = append(hits, GaokaoAdvisorExternalSourceHit{Query: q, Status: "planned", SourceType: "search_query", Note: note})
			continue
		}
		for _, hit := range found {
			hits = append(hits, hit)
			if len(hits) >= 12 {
				return hits
			}
		}
	}
	return hits
}

func searchGaokaoAdvisorDuckDuckGo(ctx context.Context, client *http.Client, query string) ([]GaokaoAdvisorExternalSourceHit, error) {
	endpoint := "https://duckduckgo.com/html/?q=" + url.QueryEscape(query)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 AI-Space-Gaokao-Advisor/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("search http %d", resp.StatusCode)
	}
	var raw struct {
		Results []struct{ Title, URL string } `json:"results"`
	}
	_ = json.Unmarshal(data, &raw)
	if len(raw.Results) > 0 {
		hits := []GaokaoAdvisorExternalSourceHit{}
		for _, item := range raw.Results {
			u := normalizeGaokaoAdvisorURL(item.URL)
			hits = append(hits, GaokaoAdvisorExternalSourceHit{Query: query, Title: item.Title, URL: u, SourceType: classifyGaokaoAdvisorSource(u), Status: "found", Note: "来源发现，尚未抽取录取线"})
		}
		return hits, nil
	}
	return parseGaokaoAdvisorLinks(query, string(data)), nil
}

func parseGaokaoAdvisorLinks(query, html string) []GaokaoAdvisorExternalSourceHit {
	if html == "" {
		return nil
	}
	re := regexp.MustCompile(`<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>`)
	matches := re.FindAllStringSubmatch(html, 3)
	hits := []GaokaoAdvisorExternalSourceHit{}
	for _, m := range matches {
		title := stripGaokaoAdvisorHTML(m[2])
		u := normalizeGaokaoAdvisorURL(htmlUnescapeLite(m[1]))
		hits = append(hits, GaokaoAdvisorExternalSourceHit{Query: query, Title: title, URL: u, SourceType: classifyGaokaoAdvisorSource(u), Status: "found", Note: "来源发现，尚未抽取录取线"})
	}
	return hits
}

func stripGaokaoAdvisorHTML(s string) string {
	re := regexp.MustCompile(`<[^>]+>`)
	return strings.TrimSpace(htmlUnescapeLite(re.ReplaceAllString(s, "")))
}

func htmlUnescapeLite(s string) string {
	repl := strings.NewReplacer("&amp;", "&", "&quot;", "\"", "&#39;", "'", "&lt;", "<", "&gt;", ">")
	return repl.Replace(s)
}

func classifyGaokaoAdvisorSource(u string) string {
	lower := strings.ToLower(u)
	switch {
	case strings.Contains(lower, "eea") || strings.Contains(lower, "zsks") || strings.Contains(lower, "zhaokao") || strings.Contains(lower, "edu.cn"):
		return "official_or_education"
	case strings.Contains(lower, "gaokao"):
		return "third_party_gaokao"
	default:
		return "web"
	}
}

func defaultGaokaoAdvisorString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func normalizeGaokaoAdvisorURL(raw string) string {
	u := strings.TrimSpace(raw)
	if strings.HasPrefix(u, "//") {
		u = "https:" + u
	}
	parsed, err := url.Parse(u)
	if err == nil {
		if uddg := parsed.Query().Get("uddg"); uddg != "" {
			if decoded, err := url.QueryUnescape(uddg); err == nil {
				return decoded
			}
			return uddg
		}
	}
	return u
}
