package services

import (
	"sort"
	"strings"
)

type GaokaoAdvisorEvidenceLink struct {
	Title string `json:"title"`
	URL   string `json:"url"`
	Kind  string `json:"kind"`
	Rank  int    `json:"rank"`
	Note  string `json:"note"`
}

func BuildGaokaoAdvisorEvidenceLinks(hits []GaokaoAdvisorExternalSourceHit) []GaokaoAdvisorEvidenceLink {
	links := []GaokaoAdvisorEvidenceLink{}
	seen := map[string]bool{}
	for _, hit := range hits {
		if hit.Status != "found" || strings.TrimSpace(hit.URL) == "" || seen[hit.URL] {
			continue
		}
		seen[hit.URL] = true
		kind, rank, note := classifyGaokaoAdvisorEvidence(hit.Title, hit.URL, hit.SourceType)
		links = append(links, GaokaoAdvisorEvidenceLink{Title: hit.Title, URL: hit.URL, Kind: kind, Rank: rank, Note: note})
	}
	sort.SliceStable(links, func(i, j int) bool {
		if links[i].Rank != links[j].Rank {
			return links[i].Rank < links[j].Rank
		}
		return links[i].Title < links[j].Title
	})
	if len(links) > 12 {
		return links[:12]
	}
	return links
}

func classifyGaokaoAdvisorEvidence(title, rawURL, sourceType string) (string, int, string) {
	text := strings.ToLower(rawURL) + " " + strings.ToLower(title) + " " + strings.ToLower(sourceType)
	switch {
	case strings.Contains(text, "jyt.") || strings.Contains(text, "考试院") || strings.Contains(text, "招生考试") || strings.Contains(text, "教育考试"):
		return "exam_authority", 0, "省级考试院/教育厅来源，优先核验投档线。"
	case strings.Contains(text, "zsb") || strings.Contains(text, "zs.") || strings.Contains(text, "admission") || strings.Contains(text, "招生网") || strings.Contains(text, "招生计划"):
		return "school_admission", 1, "高校招生网/招生计划来源，适合核验专业组、专业和计划。"
	case strings.Contains(text, "edu.cn"):
		return "education", 1, "教育机构域名来源，需确认具体页面。"
	case strings.Contains(text, "gk100") || strings.Contains(text, "gaokao") || strings.Contains(sourceType, "third"):
		return "third_party", 2, "第三方高考数据，仅作线索，需官方复核。"
	default:
		return "web", 3, "普通网页来源，仅作线索。"
	}
}
