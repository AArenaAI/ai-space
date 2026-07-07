package services

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type GaokaoAdvisorExternalCandidate struct {
	School      string `json:"school"`
	MajorGroup  string `json:"major_group"`
	MinScore    int    `json:"min_score"`
	MinRank     int    `json:"min_rank"`
	Year        int    `json:"year"`
	Batch       string `json:"batch"`
	Province    string `json:"province"`
	SubjectType string `json:"subject_type"`
	SourceTitle string `json:"source_title"`
	SourceURL   string `json:"source_url"`
	Confidence  string `json:"confidence"`
	Status      string `json:"status"` // extracted | needs_review
	Note        string `json:"note"`
}

func ExtractGaokaoExternalCandidatesFromText(profile GaokaoProfile, text, sourceURL, sourceTitle, confidence string) []GaokaoAdvisorExternalCandidate {
	clean := normalizeGaokaoAdvisorText(text)
	if clean == "" {
		return nil
	}
	year := 2025
	if m := regexp.MustCompile(`20\d{2}`).FindString(clean); m != "" {
		year, _ = strconv.Atoi(m)
	}
	schoolRe := regexp.MustCompile(`([\p{Han}A-Za-z0-9（）()·]{2,32}(?:大学|学院))`)
	groupRe := regexp.MustCompile(`([A-Za-z0-9（）()\-]{1,12}组)`)
	scoreRe := regexp.MustCompile(`(?:最低分|投档分|录取分|分数线)\D{0,8}(\d{3})|([4-6]\d{2})分`)
	rankRe := regexp.MustCompile(`(?:最低位次|投档位次|录取位次|位次)\D{0,8}(\d{3,6})`)
	segments := regexp.MustCompile(`[。；;]`).Split(clean, -1)
	out := []GaokaoAdvisorExternalCandidate{}
	seen := map[string]bool{}
	for _, seg := range segments {
		seg = strings.TrimSpace(seg)
		if seg == "" {
			continue
		}
		schoolMatches := schoolRe.FindAllStringSubmatch(seg, -1)
		if len(schoolMatches) == 0 {
			continue
		}
		score := firstIntFromSubmatches(scoreRe.FindAllStringSubmatch(seg, -1))
		rank := firstIntFromSubmatches(rankRe.FindAllStringSubmatch(seg, -1))
		if score == 0 || rank == 0 {
			continue
		}
		group := ""
		if gm := groupRe.FindStringSubmatch(seg); len(gm) > 1 {
			group = gm[1]
		}
		for _, sm := range schoolMatches {
			school := cleanGaokaoAdvisorSchoolName(sm[1])
			if !validGaokaoAdvisorSchoolName(school) {
				continue
			}
			key := fmt.Sprintf("%s:%s:%d:%d", school, group, score, rank)
			if seen[key] {
				continue
			}
			seen[key] = true
			status := "extracted"
			if confidence == "uncertain" || confidence == "third_party" {
				status = "needs_review"
			}
			batch := inferGaokaoAdvisorBatch(seg + " " + sourceTitle)
			out = append(out, GaokaoAdvisorExternalCandidate{School: school, MajorGroup: group, MinScore: score, MinRank: rank, Year: year, Batch: batch, Province: profile.Province, SubjectType: profile.Subjects, SourceTitle: sourceTitle, SourceURL: sourceURL, Confidence: confidence, Status: status, Note: "网页文本抽取，需人工/官方复核后才能进入正式志愿表"})
		}
	}
	return out
}

func firstIntFromSubmatches(matches [][]string) int {
	for _, m := range matches {
		for i := 1; i < len(m); i++ {
			if strings.TrimSpace(m[i]) == "" {
				continue
			}
			v, _ := strconv.Atoi(m[i])
			if v > 0 {
				return v
			}
		}
	}
	return 0
}

func cleanGaokaoAdvisorSchoolName(name string) string {
	name = strings.TrimSpace(name)
	name = regexp.MustCompile(`^[（(]?\d+[）)]?`).ReplaceAllString(name, "")
	prefixes := []string{"广东省内收分最高的是", "对应收分最低的是", "录取分数线最高的是", "录取分数线最低的是", "收分最高的是", "收分最低的是", "本科压线录取的", "本科压线", "其中", "例如"}
	for _, prefix := range prefixes {
		name = strings.TrimPrefix(name, prefix)
	}
	name = strings.TrimSpace(strings.Trim(name, "：:，,。；; "))
	// If narrative text still precedes the actual school, keep the tail after the last “是”.
	if idx := strings.LastIndex(name, "是"); idx >= 0 && idx+len("是") < len(name) {
		name = name[idx+len("是"):]
	}
	return strings.TrimSpace(name)
}

func validGaokaoAdvisorSchoolName(name string) bool {
	if len([]rune(name)) < 4 || len([]rune(name)) > 24 {
		return false
	}
	bad := []string{"录取", "分数线", "最低", "最高", "本科压线", "各大学", "院校名单", "排名", "前五", "前十", "名单", "哪些大学"}
	for _, b := range bad {
		if strings.Contains(name, b) {
			return false
		}
	}
	return strings.Contains(name, "大学") || strings.Contains(name, "学院")
}

func ExtractGaokaoAdvisorExternalCandidates(ctx context.Context, profile GaokaoProfile, hits []GaokaoAdvisorExternalSourceHit) []GaokaoAdvisorExternalCandidate {
	client := &http.Client{Timeout: 8 * time.Second}
	out := []GaokaoAdvisorExternalCandidate{}
	for _, hit := range hits {
		if hit.Status != "found" || hit.URL == "" {
			continue
		}
		text, err := fetchGaokaoAdvisorPageText(ctx, client, hit.URL)
		if err != nil {
			continue
		}
		confidence := confidenceFromGaokaoSourceType(hit.SourceType)
		items := ExtractGaokaoExternalCandidatesFromText(profile, text, hit.URL, hit.Title, confidence)
		out = append(out, items...)
		if len(out) >= 20 {
			return out[:20]
		}
	}
	return out
}

func fetchGaokaoAdvisorPageText(ctx context.Context, client *http.Client, pageURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 AI-Space-Gaokao-Advisor/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("page http %d", resp.StatusCode)
	}
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	return stripGaokaoAdvisorHTML(string(data)), nil
}

func confidenceFromGaokaoSourceType(sourceType string) string {
	switch sourceType {
	case "official_or_education":
		return "official_or_education"
	case "third_party_gaokao":
		return "third_party"
	default:
		return "uncertain"
	}
}

func normalizeGaokaoAdvisorText(text string) string {
	text = strings.ReplaceAll(text, "\u00a0", " ")
	text = strings.ReplaceAll(text, "\n", "。")
	text = strings.ReplaceAll(text, "\t", " ")
	return strings.TrimSpace(text)
}
