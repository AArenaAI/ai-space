package services

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type GaokaoSchoolRankEvidence struct {
	School      string `json:"school"`
	MinScore    int    `json:"min_score"`
	MinRank     int    `json:"min_rank"`
	Year        int    `json:"year"`
	Province    string `json:"province"`
	SubjectType string `json:"subject_type"`
	SourceTitle string `json:"source_title"`
	SourceURL   string `json:"source_url"`
	Confidence  string `json:"confidence"`
	Snippet     string `json:"snippet"`
}

func LookupGaokaoSchoolRankEvidence(ctx context.Context, profile GaokaoProfile, school string) GaokaoSchoolRankEvidence {
	school = strings.TrimSpace(school)
	if school == "" {
		return GaokaoSchoolRankEvidence{}
	}
	if evidence, ok := knownGaokaoSchoolRankEvidence(profile, school); ok {
		return evidence
	}
	province := defaultGaokaoAdvisorString(profile.Province, "安徽")
	subjects := defaultGaokaoAdvisorString(profile.Subjects, "物理")
	query := fmt.Sprintf("%s %s 2025 %s 本科批 最低分 最低位次", school, province, subjects)
	client := &http.Client{Timeout: 8 * time.Second}
	hits, err := searchGaokaoAdvisorDuckDuckGo(ctx, client, query)
	if err != nil || len(hits) == 0 {
		return GaokaoSchoolRankEvidence{School: school, Province: province, SubjectType: subjects, Year: 2025, Confidence: "missing"}
	}
	best := GaokaoSchoolRankEvidence{}
	for i, hit := range hits {
		if i >= 3 {
			break
		}
		if hit.URL == "" {
			continue
		}
		text, err := fetchGaokaoAdvisorPageText(ctx, client, hit.URL)
		if err != nil || strings.TrimSpace(text) == "" {
			// Some search-result titles already contain the key facts.
			text = hit.Title + "。" + hit.Note
		}
		evidence := extractGaokaoSchoolRankEvidenceFromText(profile, school, text, hit.Title, hit.URL, confidenceFromGaokaoSourceType(hit.SourceType))
		if evidence.MinRank <= 0 {
			continue
		}
		if best.MinRank == 0 || sourcePriorityEvidence(evidence.Confidence) < sourcePriorityEvidence(best.Confidence) || (sourcePriorityEvidence(evidence.Confidence) == sourcePriorityEvidence(best.Confidence) && evidence.MinRank > best.MinRank) {
			best = evidence
		}
	}
	if best.School == "" {
		return GaokaoSchoolRankEvidence{School: school, Province: province, SubjectType: subjects, Year: 2025, Confidence: "missing"}
	}
	return best
}

func knownGaokaoSchoolRankEvidence(profile GaokaoProfile, school string) (GaokaoSchoolRankEvidence, bool) {
	province := strings.TrimSpace(profile.Province)
	subjects := strings.TrimSpace(profile.Subjects)
	if province == "安徽" && strings.Contains(subjects, "物理") {
		switch school {
		case "新疆大学":
			return GaokaoSchoolRankEvidence{School: school, MinScore: 595, MinRank: 30543, Year: 2025, Province: province, SubjectType: subjects, SourceTitle: "用户复核：安徽省2025普通本科批物理+化学组合", SourceURL: "", Confidence: "user_verified", Snippet: "新疆大学 2025安徽普通本科批 595分 30543名"}, true
		case "成都理工大学":
			// 学校最低位次口径：安徽物理+化学可报专业组中，取收分最低/位次最大的普通组（007组 580 / 41804）。
			return GaokaoSchoolRankEvidence{School: school, MinScore: 580, MinRank: 41804, Year: 2025, Province: province, SubjectType: subjects, SourceTitle: "用户复核：安徽省2025普通本科批物理+化学专业组", SourceURL: "", Confidence: "user_verified", Snippet: "成都理工大学 2025安徽物理+化学：005组603/24639，004组602/25560，009组594/30919，007组580/41804；学校最低位次取41804"}, true
		case "上海海事大学":
			// 学校最低位次口径：物理+化学003组 593 / 31331；物理不限不作为物化口径。
			return GaokaoSchoolRankEvidence{School: school, MinScore: 593, MinRank: 31331, Year: 2025, Province: province, SubjectType: subjects, SourceTitle: "用户复核：安徽省2025普通本科批物理+化学专业组", SourceURL: "", Confidence: "user_verified", Snippet: "上海海事大学 2025安徽物理+化学003组 593分 31331名；002组物理不限 592/32537 不作为物化口径"}, true
		}
	}
	return GaokaoSchoolRankEvidence{}, false
}

func extractGaokaoSchoolRankEvidenceFromText(profile GaokaoProfile, school, text, sourceTitle, sourceURL, confidence string) GaokaoSchoolRankEvidence {
	clean := normalizeGaokaoAdvisorText(text)
	if clean == "" || !strings.Contains(clean, school) {
		return GaokaoSchoolRankEvidence{}
	}
	idx := strings.Index(clean, school)
	start := idx - 260
	if start < 0 {
		start = 0
	}
	end := idx + len(school) + 420
	if end > len(clean) {
		end = len(clean)
	}
	snippet := clean[start:end]
	// School reference rank means the last admitted candidate among applicable groups:
	// when several rows/groups are present, use the largest 最低位次. Do not parse generic
	// “排名/名次” as admission rank.
	score := 0
	rank := 0
	pairRe := regexp.MustCompile(`([4-7]\d{2})\s*分?\D{0,24}(\d{4,6})\s*名`)
	for _, m := range pairRe.FindAllStringSubmatch(snippet, -1) {
		if len(m) < 3 {
			continue
		}
		s, _ := strconv.Atoi(m[1])
		r, _ := strconv.Atoi(m[2])
		if r > rank {
			rank = r
			score = s
		}
	}
	labelRankRe := regexp.MustCompile(`(?:最低位次|投档位次|录取位次|位次)\D{0,30}(\d{4,6})`)
	for _, m := range labelRankRe.FindAllStringSubmatch(snippet, -1) {
		if len(m) < 2 {
			continue
		}
		r, _ := strconv.Atoi(m[1])
		if r > rank {
			rank = r
		}
	}
	if score == 0 {
		if m := regexp.MustCompile(`(?:最低分|投档分|录取分|分数线)\D{0,20}([4-7]\d{2})`).FindStringSubmatch(snippet); len(m) > 1 {
			score, _ = strconv.Atoi(m[1])
		} else if m := regexp.MustCompile(`([4-7]\d{2})\s*分`).FindStringSubmatch(snippet); len(m) > 1 {
			score, _ = strconv.Atoi(m[1])
		}
	}
	if rank <= 0 {
		return GaokaoSchoolRankEvidence{}
	}
	year := 2025
	if m := regexp.MustCompile(`20\d{2}`).FindString(snippet); m != "" {
		year, _ = strconv.Atoi(m)
	}
	return GaokaoSchoolRankEvidence{School: school, MinScore: score, MinRank: rank, Year: year, Province: profile.Province, SubjectType: profile.Subjects, SourceTitle: sourceTitle, SourceURL: sourceURL, Confidence: confidence, Snippet: snippet}
}

func sourcePriorityEvidence(confidence string) int {
	switch confidence {
	case "official_or_education":
		return 0
	case "third_party":
		return 1
	case "uncertain":
		return 2
	default:
		return 3
	}
}
