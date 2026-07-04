package services

import "fmt"

type GaokaoVolunteerTableResult struct {
	Mode       string                     `json:"mode"`
	TotalSlots int                        `json:"total_slots"`
	Stats      map[string]int             `json:"stats"`
	Rule       GaokaoVolunteerRule        `json:"rule"`
	Items      []GaokaoVolunteerTableItem `json:"items"`
	Summary    string                     `json:"summary"`
}

type GaokaoVolunteerTableItem struct {
	Index                 int                 `json:"index"`
	Band                  string              `json:"band"`
	School                string              `json:"school"`
	City                  string              `json:"city"`
	Province              string              `json:"province"`
	Level                 string              `json:"level"`
	SchoolType            string              `json:"school_type"`
	Type                  string              `json:"type"`
	MajorGroup            string              `json:"major_group"`
	Major                 string              `json:"major"`
	SubjectRequirement    string              `json:"subject_requirement"`
	Tuition               int                 `json:"tuition"`
	Ranks                 []int               `json:"ranks"`
	Year                  int                 `json:"year"`
	DataLevel             string              `json:"data_level"`
	Source                string              `json:"source"`
	RiskTip               string              `json:"risk_tip"`
	AdjustmentTip         string              `json:"adjustment_tip"`
	GroupMajors           []string            `json:"group_majors"`
	RecommendedMajorPool  []string            `json:"recommended_major_pool"`
	MajorPoolTier         GaokaoMajorPoolTier `json:"major_pool_tier"`
	RejectedMajorsInGroup []string            `json:"rejected_majors_in_group"`
	HasRejectedMajorRisk  bool                `json:"has_rejected_major_risk"`
	MajorGroupRiskLevel   string              `json:"major_group_risk_level"`
	Reason                []string            `json:"reason"`
}

func BuildGaokaoVolunteerTable(profile GaokaoProfile, recommendations []GaokaoRecommendation, totalSlots int) GaokaoVolunteerTableResult {
	rule := GaokaoVolunteerRuleForProvince(profile.Province)
	if totalSlots <= 0 {
		totalSlots = rule.DefaultSlots
	}
	quotas := volunteerBandQuotas(totalSlots, profile.Strategy)
	items := make([]GaokaoVolunteerTableItem, 0, totalSlots)
	groupMajors := collectGaokaoGroupMajors(recommendations)
	used := map[string]bool{}
	stats := map[string]int{"冲": 0, "稳": 0, "保": 0, "垫": 0}
	add := func(rec GaokaoRecommendation) bool {
		if len(items) >= totalSlots || used[rec.ID] {
			return false
		}
		used[rec.ID] = true
		stats[rec.Band]++
		items = append(items, volunteerItemFromRecommendation(len(items)+1, profile, rec, groupMajors[groupKey(rec.School, rec.MajorGroup)]))
		return true
	}
	for _, band := range []string{"冲", "稳", "保", "垫"} {
		for _, rec := range recommendations {
			if rec.Band != band || stats[band] >= quotas[band] {
				continue
			}
			add(rec)
		}
	}
	for _, rec := range recommendations {
		if len(items) >= totalSlots {
			break
		}
		add(rec)
	}
	return GaokaoVolunteerTableResult{
		Mode:       rule.Mode,
		TotalSlots: totalSlots,
		Stats:      stats,
		Rule:       rule,
		Items:      items,
		Summary:    fmt.Sprintf("已生成 %d 个志愿位：冲 %d、稳 %d、保 %d、垫 %d。", len(items), stats["冲"], stats["稳"], stats["保"], stats["垫"]),
	}
}

func volunteerBandQuotas(total int, strategy string) map[string]int {
	if total == 45 {
		switch strategy {
		case "aggressive":
			return map[string]int{"冲": 9, "稳": 19, "保": 11, "垫": 6}
		case "safe":
			return map[string]int{"冲": 4, "稳": 16, "保": 17, "垫": 8}
		default:
			return map[string]int{"冲": 6, "稳": 19, "保": 13, "垫": 7}
		}
	}
	// Generic ratio fallback: 13% / 42% / 29% / rest.
	chong := maxGaokaoInt(1, int(float64(total)*0.13))
	wen := maxGaokaoInt(1, int(float64(total)*0.42))
	bao := maxGaokaoInt(1, int(float64(total)*0.29))
	dian := maxGaokaoInt(1, total-chong-wen-bao)
	return map[string]int{"冲": chong, "稳": wen, "保": bao, "垫": dian}
}

func volunteerItemFromRecommendation(index int, profile GaokaoProfile, rec GaokaoRecommendation, groupMajors []string) GaokaoVolunteerTableItem {
	if len(groupMajors) == 0 {
		groupMajors = []string{rec.Major}
	}
	poolTier := tierGaokaoMajorPool(profile, groupMajors)
	recommendedPool, rejectedInGroup := flattenedRecommendedMajorPool(poolTier), poolTier.Rejected
	riskLevel := "low"
	if len(rejectedInGroup) > 0 {
		riskLevel = "high"
	} else if len(groupMajors) >= 6 && rec.Band == "冲" {
		riskLevel = "medium"
	}
	return GaokaoVolunteerTableItem{
		Index:                 index,
		Band:                  rec.Band,
		School:                rec.School,
		City:                  rec.City,
		Province:              rec.Province,
		Level:                 rec.Level,
		SchoolType:            rec.SchoolType,
		Type:                  rec.Type,
		MajorGroup:            rec.MajorGroup,
		Major:                 rec.Major,
		SubjectRequirement:    rec.SubjectRequirement,
		Tuition:               rec.Tuition,
		Ranks:                 rec.Ranks,
		Year:                  rec.Year,
		DataLevel:             rec.DataLevel,
		Source:                rec.Source,
		RiskTip:               volunteerRiskTip(rec),
		AdjustmentTip:         volunteerAdjustmentTipWithGroup(profile, rec, len(groupMajors), len(rejectedInGroup)),
		GroupMajors:           groupMajors,
		RecommendedMajorPool:  recommendedPool,
		MajorPoolTier:         poolTier,
		RejectedMajorsInGroup: rejectedInGroup,
		HasRejectedMajorRisk:  len(rejectedInGroup) > 0,
		MajorGroupRiskLevel:   riskLevel,
		Reason:                rec.Reason,
	}
}

func collectGaokaoGroupMajors(recommendations []GaokaoRecommendation) map[string][]string {
	out := map[string][]string{}
	seen := map[string]bool{}
	for _, rec := range recommendations {
		key := groupKey(rec.School, rec.MajorGroup)
		major := rec.Major
		if major == "" {
			continue
		}
		seenKey := key + "::" + major
		if seen[seenKey] {
			continue
		}
		seen[seenKey] = true
		out[key] = append(out[key], major)
	}
	return out
}

func groupKey(school, majorGroup string) string { return school + "::" + majorGroup }

func splitGaokaoMajorPool(majors, rejected []string) ([]string, []string) {
	recommended := []string{}
	rejectedHits := []string{}
	for _, major := range majors {
		isRejected := false
		for _, reject := range rejected {
			if containsFold(major, reject) || containsFold(reject, major) {
				isRejected = true
				break
			}
		}
		if isRejected {
			rejectedHits = append(rejectedHits, major)
		} else {
			recommended = append(recommended, major)
		}
	}
	return recommended, rejectedHits
}

// EnrichGaokaoVolunteerTableGroups replaces/extends each item's major-group pool with a fuller
// school+major_group -> majors map, typically loaded from admission records in the database.
func EnrichGaokaoVolunteerTableGroups(profile GaokaoProfile, result *GaokaoVolunteerTableResult, groupMajors map[string][]string) {
	if result == nil || len(groupMajors) == 0 {
		return
	}
	for i := range result.Items {
		item := &result.Items[i]
		majors := groupMajors[groupKey(item.School, item.MajorGroup)]
		if len(majors) == 0 {
			continue
		}
		item.GroupMajors = majors
		poolTier := tierGaokaoMajorPool(profile, majors)
		item.MajorPoolTier = poolTier
		item.RecommendedMajorPool = flattenedRecommendedMajorPool(poolTier)
		item.RejectedMajorsInGroup = poolTier.Rejected
		rejectedInGroup := poolTier.Rejected
		item.HasRejectedMajorRisk = len(rejectedInGroup) > 0
		item.MajorGroupRiskLevel = "low"
		if len(rejectedInGroup) > 0 {
			item.MajorGroupRiskLevel = "high"
		} else if len(majors) >= 6 && item.Band == "冲" {
			item.MajorGroupRiskLevel = "medium"
		}
		item.AdjustmentTip = volunteerAdjustmentTipWithGroup(profile, GaokaoRecommendation{Band: item.Band}, len(majors), len(rejectedInGroup))
	}
}

func gaokaoVolunteerMode(province string) string {
	if province == "广东" || province == "" {
		return "广东本科批院校专业组"
	}
	return province + "志愿表候选"
}

func volunteerRiskTip(rec GaokaoRecommendation) string {
	switch rec.Band {
	case "冲":
		return "冲刺位：只建议少量放前排，重点核查近年位次上移、专业热度和招生计划变化。"
	case "稳":
		return "稳妥位：作为主力志愿，仍需检查专业组内是否包含不能接受专业。"
	case "保":
		return "保底位：安全边际较明显，适合放在中后段稳定兜底。"
	default:
		return "垫底位：安全边际大，用于防止滑档，但要确认学校/城市/专业可接受。"
	}
}

func volunteerAdjustmentTip(profile GaokaoProfile, rec GaokaoRecommendation) string {
	return volunteerAdjustmentTipWithGroup(profile, rec, 1, 0)
}

func volunteerAdjustmentTipWithGroup(profile GaokaoProfile, rec GaokaoRecommendation, groupMajorCount int, rejectedCount int) string {
	if !profile.ObeyAdjustment {
		return "未选择服从调剂：需逐项确认该专业组可填专业数量，谨防退档。"
	}
	if rejectedCount > 0 {
		return fmt.Sprintf("谨慎服从调剂：该专业组含 %d 个排除/不推荐专业，若不能接受应降低排序或改选专业组。", rejectedCount)
	}
	if rec.Band == "冲" {
		return fmt.Sprintf("建议服从调剂；冲刺位尤其要核查专业组内 %d 个专业是否都可接受。", groupMajorCount)
	}
	return "可服从调剂，但仍要排除明显不能接受的专业组。"
}
