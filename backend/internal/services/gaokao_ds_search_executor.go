package services

import (
	"context"
	"net/http"
	"strings"
	"time"
)

type GaokaoDSSearchSnippet struct {
	Query      string `json:"query"`
	Title      string `json:"title"`
	URL        string `json:"url"`
	SourceType string `json:"source_type"`
	Snippet    string `json:"snippet"`
}

func ExecuteGaokaoDSSearchQuery(ctx context.Context, query string, maxResults int) []GaokaoDSSearchSnippet {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil
	}
	if maxResults <= 0 || maxResults > 4 {
		maxResults = 3
	}
	client := &http.Client{Timeout: 7 * time.Second}
	hits, err := searchGaokaoAdvisorDuckDuckGo(ctx, client, query)
	if err != nil || len(hits) == 0 {
		return nil
	}
	out := []GaokaoDSSearchSnippet{}
	for _, hit := range hits {
		if len(out) >= maxResults {
			break
		}
		text := hit.Title + "。" + hit.Note
		if hit.URL != "" && hit.Status == "found" {
			if pageText, err := fetchGaokaoAdvisorPageText(ctx, client, hit.URL); err == nil && strings.TrimSpace(pageText) != "" {
				text = pageText
			}
		}
		out = append(out, GaokaoDSSearchSnippet{Query: query, Title: hit.Title, URL: hit.URL, SourceType: hit.SourceType, Snippet: truncateGaokaoAdvisorText(normalizeGaokaoAdvisorText(text), 1800)})
	}
	return out
}
