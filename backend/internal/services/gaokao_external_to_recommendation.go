package services

import (
	"fmt"
	"strings"
)

func ExternalCandidatePlanToGaokaoRecommendations(profile GaokaoProfile, plan GaokaoExternalCandidatePlan) []GaokaoRecommendation {
	out := make([]GaokaoRecommendation, 0, len(plan.Items))
	for _, item := range plan.Items {
		if item.School == "" || item.MinRank <= 0 {
			continue
		}
		major := item.MajorGroup
		if major == "" {
			major = "待复核专业组"
		}
		note := item.Reason
		if note == "" {
			note = "联网抽取候选，需以考试院/高校招生网复核后再用于正式填报。"
		}
		out = append(out, GaokaoRecommendation{
			ID:                 fmt.Sprintf("external-%s-%s-%d", item.School, item.MajorGroup, item.MinRank),
			Band:               item.Band,
			RiskScore:          externalCandidateRiskScore(item.Band),
			FitScore:           70,
			School:             item.School,
			Province:           profile.Province,
			Level:              "联网待复核",
			Type:               "待复核",
			MajorGroup:         item.MajorGroup,
			Major:              major,
			SubjectRequirement: profile.Subjects,
			Ranks:              []int{item.MinRank},
			Note:               note,
			Source:             item.SourceURL,
			Reason: []string{
				fmt.Sprintf("联网来源：%s", item.SourceTitle),
				note,
			},
		})
	}
	return out
}

func BuildGaokaoProfessionalSeedRecommendations(profile GaokaoProfile) []GaokaoRecommendation {
	items := seedGaokaoStrongMajorReportItems(profile)
	out := make([]GaokaoRecommendation, 0, len(items))
	for _, item := range items {
		rank := parseGaokaoApproxRank(item.ReferenceRank)
		if rank <= 0 {
			continue
		}
		major := item.RecommendedMajors
		if major == "" {
			major = strings.Join(profile.PreferredMajors, "、")
		}
		band := bandGaokaoRankWindow(profile.Rank, rank)
		if band == "" {
			band = bandFromGaokaoChance(item.AdmissionChance)
		}
		out = append(out, GaokaoRecommendation{
			ID:                 fmt.Sprintf("professional-seed-%s-%d", item.School, rank),
			Band:               band,
			RiskScore:          externalCandidateRiskScore(band),
			FitScore:           82,
			School:             item.School,
			City:               item.City,
			Province:           profile.Province,
			Level:              item.SchoolLevel,
			Type:               "专业强校候选",
			Major:              major,
			SubjectRequirement: profile.Subjects,
			Ranks:              []int{rank},
			Note:               item.WhyRecommend,
			Source:             item.SourceNote,
			Reason:             []string{item.WhyRecommend, item.SourceNote},
		})
	}
	return out
}

func parseGaokaoApproxRank(text string) int {
	text = strings.TrimSpace(strings.TrimPrefix(text, "约"))
	var rank int
	_, _ = fmt.Sscanf(text, "%d", &rank)
	return rank
}

func externalCandidateRiskScore(band string) int {
	switch band {
	case "冲":
		return 76
	case "稳":
		return 48
	case "保":
		return 28
	case "垫":
		return 16
	default:
		return 50
	}
}
