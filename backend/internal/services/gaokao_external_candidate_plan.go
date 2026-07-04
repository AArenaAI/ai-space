package services

import (
	"fmt"
	"sort"
)

type GaokaoExternalCandidatePlanItem struct {
	Band        string `json:"band"`
	Section     string `json:"section"`
	School      string `json:"school"`
	MajorGroup  string `json:"major_group"`
	MinScore    int    `json:"min_score"`
	MinRank     int    `json:"min_rank"`
	Gap         int    `json:"gap"`
	SourceTitle string `json:"source_title"`
	SourceURL   string `json:"source_url"`
	Confidence  string `json:"confidence"`
	Status      string `json:"status"`
	SourceRank  int    `json:"source_rank"`
	Reason      string `json:"reason"`
}

type GaokaoExternalCandidatePlanSection struct {
	Key   string                            `json:"key"`
	Title string                            `json:"title"`
	Items []GaokaoExternalCandidatePlanItem `json:"items"`
}

type GaokaoExternalCandidateConflict struct {
	School     string   `json:"school"`
	MajorGroup string   `json:"major_group"`
	Reason     string   `json:"reason"`
	Sources    []string `json:"sources"`
}

type GaokaoExternalCandidatePlan struct {
	Summary       string                               `json:"summary"`
	Items         []GaokaoExternalCandidatePlanItem    `json:"items"`
	Sections      []GaokaoExternalCandidatePlanSection `json:"sections"`
	Conflicts     []GaokaoExternalCandidateConflict    `json:"conflicts"`
	UsableCount   int                                  `json:"usable_count"`
	RejectedCount int                                  `json:"rejected_count"`
}

func BuildGaokaoExternalCandidatePlan(profile GaokaoProfile, candidates []GaokaoAdvisorExternalCandidate) GaokaoExternalCandidatePlan {
	plan := GaokaoExternalCandidatePlan{Items: []GaokaoExternalCandidatePlanItem{}, Conflicts: []GaokaoExternalCandidateConflict{}}
	if profile.Rank <= 0 {
		profile.Rank = 300000
	}
	grouped := map[string][]GaokaoAdvisorExternalCandidate{}
	for _, c := range candidates {
		if !usableGaokaoExternalCandidate(profile, c) {
			plan.RejectedCount++
			continue
		}
		key := c.School + "::" + c.MajorGroup
		grouped[key] = append(grouped[key], c)
	}
	for _, group := range grouped {
		selected, conflict := selectGaokaoExternalCandidateSource(group)
		if conflict != nil {
			plan.Conflicts = append(plan.Conflicts, *conflict)
			plan.RejectedCount += len(group)
			continue
		}
		gap := selected.MinRank - profile.Rank
		band := bandGaokaoExternalCandidate(profile.Rank, selected.MinRank)
		section := sectionGaokaoExternalCandidate(selected)
		plan.Items = append(plan.Items, GaokaoExternalCandidatePlanItem{Band: band, Section: section, School: selected.School, MajorGroup: selected.MajorGroup, MinScore: selected.MinScore, MinRank: selected.MinRank, Gap: gap, SourceTitle: selected.SourceTitle, SourceURL: selected.SourceURL, Confidence: selected.Confidence, Status: selected.Status, SourceRank: sourcePriorityGaokaoExternalCandidate(selected), Reason: reasonGaokaoExternalCandidate(profile.Rank, selected.MinRank, band)})
	}
	sort.SliceStable(plan.Items, func(i, j int) bool {
		order := map[string]int{"冲": 0, "稳": 1, "保": 2, "垫": 3}
		if order[plan.Items[i].Band] != order[plan.Items[j].Band] {
			return order[plan.Items[i].Band] < order[plan.Items[j].Band]
		}
		if plan.Items[i].SourceRank != plan.Items[j].SourceRank {
			return plan.Items[i].SourceRank < plan.Items[j].SourceRank
		}
		return plan.Items[i].MinRank < plan.Items[j].MinRank
	})
	if len(plan.Items) > 24 {
		plan.RejectedCount += len(plan.Items) - 24
		plan.Items = plan.Items[:24]
	}
	plan.UsableCount = len(plan.Items)
	plan.Sections = buildGaokaoExternalCandidateSections(plan.Items)
	plan.Summary = fmt.Sprintf("联网抽取候选 %d 条，保留 %d 条接近当前位次的待复核线索，过滤 %d 条明显不适配/过远/冲突候选；已按本科批次/专科批次/补录本科/补录专科分区，并优先官方来源。", len(candidates), plan.UsableCount, plan.RejectedCount)
	return plan
}

func selectGaokaoExternalCandidateSource(group []GaokaoAdvisorExternalCandidate) (GaokaoAdvisorExternalCandidate, *GaokaoExternalCandidateConflict) {
	sort.SliceStable(group, func(i, j int) bool {
		pi, pj := sourcePriorityGaokaoExternalCandidate(group[i]), sourcePriorityGaokaoExternalCandidate(group[j])
		if pi != pj {
			return pi < pj
		}
		return group[i].MinRank < group[j].MinRank
	})
	best := group[0]
	if sourcePriorityGaokaoExternalCandidate(best) <= 1 {
		return best, nil
	}
	minRank, maxRank := best.MinRank, best.MinRank
	sources := []string{}
	for _, c := range group {
		if c.MinRank < minRank {
			minRank = c.MinRank
		}
		if c.MinRank > maxRank {
			maxRank = c.MinRank
		}
		sources = append(sources, c.SourceURL)
	}
	if len(group) > 1 && maxRank-minRank > 30000 {
		return GaokaoAdvisorExternalCandidate{}, &GaokaoExternalCandidateConflict{School: best.School, MajorGroup: best.MajorGroup, Reason: "多个非官方来源位次差异过大，暂不进入待复核主方案", Sources: sources}
	}
	return best, nil
}

func sourcePriorityGaokaoExternalCandidate(c GaokaoAdvisorExternalCandidate) int {
	text := c.SourceURL + " " + c.SourceTitle + " " + c.Confidence
	if c.Confidence == "official_or_education" || containsFold(text, "jyt.") || containsFold(text, "edu.cn") || containsFold(text, "考试院") || containsFold(text, "教育考试") {
		return 0
	}
	if c.Confidence == "third_party" || containsFold(text, "gaokao") || containsFold(text, "gk100") {
		return 2
	}
	return 3
}

func usableGaokaoExternalCandidate(profile GaokaoProfile, c GaokaoAdvisorExternalCandidate) bool {
	if c.School == "" || c.MinRank <= 0 || c.SourceURL == "" {
		return false
	}
	if !validGaokaoAdvisorSchoolName(c.School) {
		return false
	}
	// Keep candidates around the user's reachable window. For low ranks, allow wider safer tail.
	lower := int(float64(profile.Rank) * 0.72)
	upper := int(float64(profile.Rank) * 1.45)
	if c.MinRank < lower || c.MinRank > upper {
		return false
	}
	return true
}

func bandGaokaoExternalCandidate(rank, minRank int) string {
	ratio := float64(minRank) / float64(rank)
	switch {
	case ratio < 0.95:
		return "冲"
	case ratio < 1.15:
		return "稳"
	case ratio < 1.35:
		return "保"
	default:
		return "垫"
	}
}

func reasonGaokaoExternalCandidate(rank, minRank int, band string) string {
	gap := minRank - rank
	if gap >= 0 {
		return fmt.Sprintf("抽取最低位次比当前位次宽 %d，暂按%s处理；来源未复核，不能直接用于正式填报。", gap, band)
	}
	return fmt.Sprintf("抽取最低位次比当前位次靠前 %d，暂按%s处理；来源未复核，不能直接用于正式填报。", -gap, band)
}

func sectionGaokaoExternalCandidate(c GaokaoAdvisorExternalCandidate) string {
	batch := inferGaokaoAdvisorBatch(c.Batch + " " + c.SourceTitle + " " + c.Note)
	if batch == "补录本科" || batch == "补录专科" || batch == "专科批次" || batch == "本科批次" {
		return batch
	}
	return "本科批次"
}

func buildGaokaoExternalCandidateSections(items []GaokaoExternalCandidatePlanItem) []GaokaoExternalCandidatePlanSection {
	order := []string{"本科批次", "专科批次", "补录本科", "补录专科"}
	titles := map[string]string{"本科批次": "本科批次", "专科批次": "专科批次", "补录本科": "补录本科", "补录专科": "补录专科"}
	by := map[string][]GaokaoExternalCandidatePlanItem{}
	for _, item := range items {
		by[item.Section] = append(by[item.Section], item)
	}
	sections := []GaokaoExternalCandidatePlanSection{}
	for _, key := range order {
		sections = append(sections, GaokaoExternalCandidatePlanSection{Key: key, Title: titles[key], Items: by[key]})
	}
	return sections
}

func inferGaokaoAdvisorBatch(text string) string {
	if containsFold(text, "征集") || containsFold(text, "补录") {
		if containsFold(text, "专科") || containsFold(text, "高职") {
			return "补录专科"
		}
		return "补录本科"
	}
	if containsFold(text, "专科") || containsFold(text, "高职") {
		return "专科批次"
	}
	return "本科批次"
}
