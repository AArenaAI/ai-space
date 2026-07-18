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
	if profile.Rank >= 180000 || strings.Contains(profile.Strategy, "专科") {
		return buildGaokaoCollegeFallbackRecommendations(profile)
	}
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

func buildGaokaoCollegeFallbackRecommendations(profile GaokaoProfile) []GaokaoRecommendation {
	type seed struct {
		school, city, major string
		rank                int
		band                string
	}
	seeds := []seed{
		{"西安航空职业技术学院", "西安", "飞机机电设备维修、无人机应用技术、机电一体化技术", 252544, "冲"},
		{"湖南信息职业技术学院", "长沙", "软件技术、电子信息工程技术、计算机网络技术", 255120, "冲"},
		{"广东环境保护工程职业学院", "佛山", "环境监测技术、环境工程技术、水环境智能监测与治理", 255360, "冲"},
		{"广东水利电力职业技术学院", "广州", "水利水电建筑工程、电气自动化技术、工程造价", 273568, "冲"},
		{"广东机电职业技术学院", "广州", "机电一体化技术、新能源汽车技术、工业机器人技术", 274639, "冲"},
		{"黄冈职业技术学院", "黄冈", "临床医学、护理、机电一体化技术", 278993, "稳"},
		{"长江职业学院", "武汉", "软件技术、人工智能技术应用、电子商务", 279144, "稳"},
		{"广东理工职业学院", "广州", "计算机网络技术、物联网应用技术、工业机器人技术", 281354, "稳"},
		{"南通职业大学", "南通", "机械制造及自动化、电气自动化技术、建筑工程技术", 281370, "稳"},
		{"天津市职业大学", "天津", "眼视光技术、机械制造及自动化、电气自动化技术", 286715, "稳"},
		{"广东交通职业技术学院", "广州", "城市轨道交通机电技术、道路与桥梁工程技术、新能源汽车检测与维修技术", 290483, "保"},
		{"珠海城市职业技术学院", "珠海", "电子信息工程技术、大数据技术、港口与航运管理", 290975, "保"},
		{"江苏航空职业技术学院", "镇江", "飞机机电设备维修、无人机应用技术、飞行器数字化制造技术", 291603, "保"},
		{"安徽审计职业学院", "合肥", "大数据与审计、大数据与会计、财税大数据应用", 297287, "保"},
		{"武汉船舶职业技术学院", "武汉", "船舶工程技术、轮机工程技术、机电一体化技术", 297713, "保"},
	}
	out := make([]GaokaoRecommendation, 0, len(seeds))
	for _, s := range seeds {
		band := bandGaokaoRankWindow(profile.Rank, s.rank)
		if band == "" {
			band = s.band
		}
		out = append(out, GaokaoRecommendation{ID: fmt.Sprintf("college-fallback-%s-%d", s.school, s.rank), Band: band, RiskScore: externalCandidateRiskScore(band), FitScore: 78, School: s.school, City: s.city, Province: profile.Province, Level: "专科/高职高专", Type: "专科兜底候选", Major: s.major, RecommendedMajorPool: strings.Split(s.major, "、"), SubjectRequirement: profile.Subjects, Ranks: []int{s.rank}, Note: "专科专项兜底候选，需以考试院/高校招生网复核。", Source: "广东省教育考试院公开投档表口径", Reason: []string{"专科专项兜底候选", "按位次梯度形成冲稳保"}})
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
