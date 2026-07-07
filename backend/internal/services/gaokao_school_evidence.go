package services

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type GaokaoSchoolAdmissionEvidence struct {
	School     string                           `json:"school"`
	Query      string                           `json:"query"`
	Sources    []GaokaoAdvisorExternalSourceHit `json:"sources"`
	Candidates []GaokaoAdvisorExternalCandidate `json:"candidates"`
}

func LookupGaokaoSchoolAdmissionEvidence(ctx context.Context, profile GaokaoProfile, school string) GaokaoSchoolAdmissionEvidence {
	school = strings.TrimSpace(school)
	e := GaokaoSchoolAdmissionEvidence{School: school}
	if school == "" {
		return e
	}
	province := defaultGaokaoAdvisorString(strings.TrimSpace(profile.Province), "安徽")
	subjects := defaultGaokaoAdvisorString(strings.TrimSpace(profile.Subjects), "物理类")
	queries := []string{
		fmt.Sprintf("%s %s 2025 %s 本科批 最低分 最低位次", province, school, subjects),
		fmt.Sprintf("%s %s 2025 投档线 最低位次", province, school),
		fmt.Sprintf("%s 教育考试院 2025 %s 投档最低位次", province, school),
	}
	client := &http.Client{Timeout: 6 * time.Second}
	for _, q := range queries {
		e.Query = q
		hits, err := searchGaokaoAdvisorDuckDuckGo(ctx, client, q)
		if err != nil || len(hits) == 0 {
			continue
		}
		for _, hit := range hits {
			if len(e.Sources) >= 4 {
				break
			}
			e.Sources = append(e.Sources, hit)
			if hit.URL == "" || hit.Status != "found" {
				continue
			}
			text, err := fetchGaokaoAdvisorPageText(ctx, client, hit.URL)
			if err != nil {
				continue
			}
			items := ExtractGaokaoExternalCandidatesFromText(profile, text, hit.URL, hit.Title, confidenceFromGaokaoSourceType(hit.SourceType))
			for _, item := range items {
				if strings.Contains(item.School, school) || strings.Contains(school, item.School) {
					e.Candidates = append(e.Candidates, item)
				}
			}
		}
		if len(e.Candidates) > 0 {
			return e
		}
	}
	return e
}
