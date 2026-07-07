package services

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

type GaokaoProfessionalReportItem struct {
	School              string   `json:"school"`
	City                string   `json:"city"`
	RecommendedMajors   string   `json:"recommended_majors"`
	SchoolLevel         string   `json:"school_level"`
	EngineeringStrength string   `json:"engineering_strength"`
	StrengthTags        []string `json:"strength_tags"`
	WhyRecommend        string   `json:"why_recommend"`
	ReferenceRank       string   `json:"reference_rank"`
	RankGap             int      `json:"rank_gap"`
	AdmissionChance     string   `json:"admission_chance"`
	Advice              string   `json:"advice"`
	SourceNote          string   `json:"source_note"`
}

type GaokaoProfessionalReport struct {
	ProfileSummary     string                                    `json:"profile_summary"`
	StrategySummary    string                                    `json:"strategy_summary"`
	Bands              map[string][]GaokaoProfessionalReportItem `json:"bands"`
	TopRecommendations []GaokaoProfessionalReportItem            `json:"top_recommendations"`
	SchoolOverviews    []GaokaoSchoolOverview                    `json:"school_overviews"`
	MajorRanking       []GaokaoMajorRankingItem                  `json:"major_ranking"`
	FinalSuggestion    GaokaoFinalSuggestion                     `json:"final_suggestion"`
	MajorAnalysis      []string                                  `json:"major_analysis"`
	RiskNotes          []string                                  `json:"risk_notes"`
	EvidenceLinks      []GaokaoAdvisorEvidenceLink               `json:"evidence_links"`
	Disclaimer         string                                    `json:"disclaimer"`
}

type GaokaoSchoolOverview struct {
	School         string   `json:"school"`
	Band           string   `json:"band"`
	Advantages     []string `json:"advantages"`
	RecommendIndex string   `json:"recommend_index"`
}

type GaokaoMajorRankingItem struct {
	Rank           int    `json:"rank"`
	Major          string `json:"major"`
	RecommendIndex string `json:"recommend_index"`
	Employment     string `json:"employment"`
	Reason         string `json:"reason"`
}

type GaokaoFinalSuggestion struct {
	Chong []string `json:"chong"`
	Core  []string `json:"core"`
	Safe  []string `json:"safe"`
}

func BuildGaokaoProfessionalReport(profile GaokaoProfile, recs []GaokaoRecommendation, links []GaokaoAdvisorEvidenceLink) GaokaoProfessionalReport {
	report := GaokaoProfessionalReport{
		ProfileSummary:  fmt.Sprintf("%s · %s · %d分 · 全省位次%d · 专业优先：%s", profile.Province, profile.Subjects, profile.Score, profile.Rank, strings.Join(profile.PreferredMajors, "、")),
		StrategySummary: "以专业匹配和工科/行业认可度为主，结合位次风险、学校层次、城市产业和来源可信度择优推荐。",
		Bands:           map[string][]GaokaoProfessionalReportItem{"冲": {}, "稳": {}, "保": {}},
		EvidenceLinks:   links,
		Disclaimer:      "录取概率为模型/规则结合位次差、近年波动和专业热度做的经验估计，并非官方概率；最终以考试院和高校官网为准。",
	}
	items := make([]GaokaoProfessionalReportItem, 0, len(recs)+16)
	seenSchool := map[string]bool{}
	for _, seeded := range seedGaokaoStrongMajorReportItems(profile) {
		items = append(items, seeded)
		seenSchool[seeded.School] = true
		report.Bands[bandFromGaokaoChance(seeded.AdmissionChance)] = append(report.Bands[bandFromGaokaoChance(seeded.AdmissionChance)], seeded)
	}
	for _, rec := range recs {
		if seenSchool[rec.School] || skipGaokaoProfessionalReportRec(profile, rec) {
			continue
		}
		item := buildGaokaoProfessionalReportItem(profile, rec)
		items = append(items, item)
		seenSchool[rec.School] = true
		switch rec.Band {
		case "冲":
			report.Bands["冲"] = append(report.Bands["冲"], item)
		case "稳":
			report.Bands["稳"] = append(report.Bands["稳"], item)
		case "保", "垫":
			report.Bands["保"] = append(report.Bands["保"], item)
		}
	}
	for band, limit := range map[string]int{"冲": 8, "稳": 12, "保": 12} {
		if len(report.Bands[band]) > limit {
			report.Bands[band] = report.Bands[band][:limit]
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return reportItemScore(items[i]) > reportItemScore(items[j]) })
	if len(items) > 10 {
		report.TopRecommendations = items[:10]
	} else {
		report.TopRecommendations = items
	}
	report.SchoolOverviews = buildGaokaoSchoolOverviews(report.TopRecommendations)
	report.MajorRanking = buildGaokaoMajorRanking(profile)
	report.FinalSuggestion = buildGaokaoFinalSuggestion(report)
	report.MajorAnalysis = []string{
		"自动化/电子信息/集成电路/车辆工程更适合优先选择工科底蕴强、行业认可度高、所在城市产业匹配的院校。",
		"同等录取概率下，优先双非工科强校、电子/控制/车辆方向行业校，再考虑单纯综合排名更高但专业不匹配的院校。",
	}
	report.RiskNotes = []string{
		"冲刺项可保留少量，但不应挤占稳妥和保底位置。",
		"专业最低位次若来自第三方或模型估计，应作为参考，填报前需点开考试院/招生网链接复核。",
	}
	return report
}

func buildGaokaoProfessionalReportItem(profile GaokaoProfile, rec GaokaoRecommendation) GaokaoProfessionalReportItem {
	refRank := 0
	if len(rec.Ranks) > 0 {
		refRank = rec.Ranks[0]
	}
	gap := 0
	if refRank > 0 && profile.Rank > 0 {
		gap = refRank - profile.Rank
	}
	majors := rec.Major
	if len(rec.RecommendedMajorPool) > 0 {
		majors = strings.Join(rec.RecommendedMajorPool, "、")
	}
	return GaokaoProfessionalReportItem{
		School:              rec.School,
		City:                rec.City,
		RecommendedMajors:   majors,
		SchoolLevel:         canonicalGaokaoSchoolLevel(rec.School, rec.DualClass, rec.Level, rec.Type),
		EngineeringStrength: estimateGaokaoEngineeringStrength(rec),
		StrengthTags:        strengthTagsForGaokaoReport(rec.School, majors),
		WhyRecommend:        whyRecommendGaokaoReport(rec.School, majors),
		ReferenceRank:       formatGaokaoRank(refRank),
		RankGap:             gap,
		AdmissionChance:     estimateGaokaoAdmissionChance(profile.Rank, refRank, rec.Band),
		Advice:              adviceGaokaoReport(rec.Band, gap),
		SourceNote:          rec.Source,
	}
}

func canonicalGaokaoSchoolLevel(school, dualClass, level, t string) string {
	if strings.Contains(dualClass, "985") || strings.Contains(dualClass, "211") || strings.Contains(dualClass, "双一流") {
		return dualClass
	}
	if strings.Contains(school, "职业") && strings.Contains(school, "技术大学") {
		return "职业本科"
	}
	knownPrivate := []string{"文达信息工程", "新华学院", "三联学院", "安徽信息工程", "皖江工学院", "外国语学院", "商学院", "金融学院", "科技学院", "理工学院", "江淮学院", "滨江学院", "皖南医学院"}
	for _, kw := range knownPrivate {
		if strings.Contains(school, kw) {
			return "民办本科"
		}
	}
	if strings.Contains(level, "一本") {
		return "公办一本"
	}
	if strings.Contains(level, "二本") {
		return "公办二本"
	}
	if strings.Contains(t, "民办") || strings.Contains(t, "独立学院") {
		return "民办本科"
	}
	if strings.Contains(t, "职业") {
		return "职业本科"
	}
	if strings.Contains(t, "专科") || strings.Contains(t, "高职") {
		return "专科"
	}
	return "公办本科"
}

func estimateGaokaoEngineeringStrength(rec GaokaoRecommendation) string {
	text := rec.School + rec.Major + strings.Join(rec.RecommendedMajorPool, "")
	score := 3
	if strings.Contains(rec.DualClass, "985") || strings.Contains(rec.DualClass, "211") || strings.Contains(rec.DualClass, "双一流") {
		score++
	}
	for _, kw := range []string{"电子", "邮电", "理工", "工业", "电力", "交通", "科技", "车辆", "自动化", "集成电路", "微电子"} {
		if strings.Contains(text, kw) {
			score++
			break
		}
	}
	if score > 5 {
		score = 5
	}
	return strings.Repeat("★", score) + strings.Repeat("☆", 5-score)
}

func estimateGaokaoAdmissionChance(rank, refRank int, band string) string {
	if rank <= 0 || refRank <= 0 {
		return "待估"
	}
	ratio := float64(refRank) / float64(rank)
	pct := 50 + int(math.Round((ratio-1)*140))
	switch band {
	case "冲":
		if pct > 45 {
			pct = 45
		}
	case "稳":
		if pct < 55 {
			pct = 55
		}
	case "保", "垫":
		if pct < 80 {
			pct = 80
		}
	}
	if pct < 1 {
		pct = 1
	}
	if pct > 99 {
		pct = 99
	}
	return fmt.Sprintf("约%d%%", pct)
}

func adviceGaokaoReport(band string, gap int) string {
	switch band {
	case "冲":
		return "冲刺，需控制数量"
	case "稳":
		return "重点关注"
	case "保":
		return "保底"
	case "垫":
		return "兜底"
	}
	return "参考"
}

func formatGaokaoRank(rank int) string {
	if rank <= 0 {
		return "待核验"
	}
	return fmt.Sprintf("约%d", rank)
}
func nonEmptyStrings(values ...string) []string {
	out := []string{}
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			out = append(out, strings.TrimSpace(v))
		}
	}
	return out
}
func reportItemScore(item GaokaoProfessionalReportItem) int {
	return len(item.EngineeringStrength)*10 - int(math.Abs(float64(item.RankGap))/2000)
}

func seedGaokaoStrongMajorReportItems(profile GaokaoProfile) []GaokaoProfessionalReportItem {
	if profile.Rank <= 0 || len(profile.PreferredMajors) == 0 {
		return nil
	}
	majorText := strings.Join(profile.PreferredMajors, " ")
	if !(containsFold(majorText, "自动化") || containsFold(majorText, "电子") || containsFold(majorText, "集成电路") || containsFold(majorText, "微电子") || containsFold(majorText, "车辆")) {
		return nil
	}
	type seed struct {
		school, city, majors, level, strength string
		rank                                  int
	}
	seeds := []seed{
		{"桂林电子科技大学", "桂林", "自动化、电子信息工程、集成电路", "公办本科", "★★★★★", 38000},
		{"天津理工大学", "天津", "自动化、电子信息工程", "公办本科", "★★★★☆", 41000},
		{"长春理工大学", "长春", "电子信息工程、自动化、光电信息", "公办本科", "★★★★★", 42000},
		{"江苏科技大学", "镇江", "自动化、车辆工程", "公办本科", "★★★★☆", 43000},
		{"西安工业大学", "西安", "自动化、电子信息工程", "公办本科", "★★★★☆", 44000},
		{"武汉工程大学", "武汉", "自动化、电子信息", "公办本科", "★★★★☆", 45000},
		{"沈阳工业大学", "沈阳", "自动化、电气工程", "公办本科", "★★★★★", 47000},
		{"安徽工业大学", "马鞍山", "自动化、车辆工程", "公办本科", "★★★★☆", 48000},
		{"华东交通大学", "南昌", "自动化、车辆工程", "公办本科", "★★★★", 50000},
		{"南昌航空大学", "南昌", "自动化、电子信息工程", "公办本科", "★★★★☆", 51000},
		{"安徽理工大学", "淮南", "自动化、车辆工程", "公办本科", "★★★★", 53000},
		{"山东理工大学", "淄博", "自动化、车辆工程", "公办本科", "★★★★", 55000},
	}
	out := []GaokaoProfessionalReportItem{}
	for _, s := range seeds {
		gap := s.rank - profile.Rank
		chance := estimateGaokaoAdmissionChance(profile.Rank, s.rank, bandGaokaoRankWindow(profile.Rank, s.rank))
		out = append(out, GaokaoProfessionalReportItem{School: s.school, City: s.city, RecommendedMajors: s.majors, SchoolLevel: s.level, EngineeringStrength: s.strength, StrengthTags: strengthTagsForGaokaoReport(s.school, s.majors), WhyRecommend: whyRecommendGaokaoReport(s.school, s.majors), ReferenceRank: formatGaokaoRank(s.rank), RankGap: gap, AdmissionChance: chance, Advice: adviceGaokaoReport(bandGaokaoRankWindow(profile.Rank, s.rank), gap), SourceNote: "专业强校规则库第一版；需结合考试院/高校官网复核"})
	}
	return out
}

func bandFromGaokaoChance(chance string) string {
	chance = strings.TrimPrefix(strings.TrimSpace(chance), "约")
	chance = strings.TrimSuffix(chance, "%")
	var pct int
	_, _ = fmt.Sscanf(chance, "%d", &pct)
	if pct < 50 {
		return "冲"
	}
	if pct < 80 {
		return "稳"
	}
	return "保"
}

func skipGaokaoProfessionalReportRec(profile GaokaoProfile, rec GaokaoRecommendation) bool {
	if strings.Contains(rec.Type, "待复核") || strings.Contains(rec.Level, "联网待复核") {
		return true
	}
	text := rec.School + " " + rec.Major + " " + strings.Join(rec.RecommendedMajorPool, "、")
	for _, kw := range []string{"军", "警察", "公安", "消防", "司法", "师范", "工商", "财经", "外语", "政法"} {
		if strings.Contains(rec.School, kw) {
			return true
		}
	}
	if len(profile.PreferredMajors) == 0 {
		return false
	}
	pref := strings.Join(profile.PreferredMajors, " ")
	for _, major := range profile.PreferredMajors {
		if containsFold(text, major) {
			return false
		}
	}
	families := [][]string{{"自动化", "控制", "机器人工程", "智能制造"}, {"电子", "通信", "微电子", "集成电路", "光电"}, {"车辆", "汽车", "智能车辆"}}
	for _, family := range families {
		want := false
		for _, kw := range family {
			if containsFold(pref, kw) {
				want = true
			}
		}
		if want {
			for _, kw := range family {
				if containsFold(text, kw) {
					return false
				}
			}
		}
	}
	return true
}

func strengthTagsForGaokaoReport(school, majors string) []string {
	text := school + majors
	tags := []string{}
	rules := []struct{ key, tag string }{
		{"桂林电子科技大学", "电子信息特色"}, {"杭州电子科技大学", "电子/集成电路"}, {"重庆邮电大学", "通信电子"}, {"南京邮电大学", "通信电子"},
		{"长春理工大学", "光电特色"}, {"沈阳工业大学", "电气/控制"}, {"东北电力大学", "电力系统"}, {"西安工业大学", "军工光电"},
		{"江苏科技大学", "船舶/车辆"}, {"武汉工程大学", "工科应用"}, {"安徽工业大学", "本省工科"}, {"南昌航空大学", "航空特色"},
		{"车辆", "车辆工程"}, {"自动化", "自动化"}, {"电子", "电子信息"}, {"集成电路", "集成电路"}, {"微电子", "微电子"},
	}
	seen := map[string]bool{}
	for _, r := range rules {
		if containsFold(text, r.key) && !seen[r.tag] {
			tags = append(tags, r.tag)
			seen[r.tag] = true
		}
	}
	if len(tags) == 0 {
		tags = append(tags, "专业匹配")
	}
	if len(tags) > 4 {
		return tags[:4]
	}
	return tags
}

func whyRecommendGaokaoReport(school, majors string) string {
	switch {
	case containsFold(school, "桂林电子科技大学"):
		return "电子信息类特色明显，适合作为电子信息、集成电路方向的高性价比冲稳选择。"
	case containsFold(school, "长春理工大学"):
		return "光电信息特色强，电子信息相关方向有行业辨识度，适合工科专业优先。"
	case containsFold(school, "沈阳工业大学"):
		return "电气与控制底子较强，自动化方向性价比较高，适合作为稳妥选择。"
	case containsFold(school, "天津理工大学"):
		return "位次接近且自动化/电子信息方向匹配，城市和就业环境较均衡。"
	case containsFold(school, "江苏科技大学"):
		return "省重点工科院校，自动化/车辆方向与制造业场景匹配，适合稳妥填报。"
	case containsFold(school, "西安工业大学"):
		return "军工背景和工科应用特色较明显，自动化/电子方向有一定行业认可。"
	case containsFold(school, "武汉工程大学"):
		return "武汉工科应用场景较多，自动化方向适合稳妥组合。"
	case containsFold(school, "安徽工业大学"):
		return "本省工科院校，区域就业和录取安全性较好，适合作为保底核心。"
	case containsFold(school, "南昌航空大学"):
		return "航空特色院校，自动化/电子信息方向与行业背景匹配，可作为稳保结合。"
	}
	return "专业方向与当前偏好有一定匹配，需结合考试院投档线和学校招生网进一步核验。"
}

func buildGaokaoSchoolOverviews(items []GaokaoProfessionalReportItem) []GaokaoSchoolOverview {
	out := []GaokaoSchoolOverview{}
	for i, item := range items {
		if i >= 12 {
			break
		}
		adv := []string{}
		if item.WhyRecommend != "" {
			adv = append(adv, item.WhyRecommend)
		}
		for _, tag := range item.StrengthTags {
			adv = append(adv, tag+"方向匹配")
		}
		if len(adv) == 0 {
			adv = append(adv, "专业方向与当前偏好有一定匹配")
		}
		out = append(out, GaokaoSchoolOverview{School: item.School, Band: bandFromGaokaoChance(item.AdmissionChance), Advantages: adv, RecommendIndex: recommendIndexFromChance(item.AdmissionChance)})
	}
	return out
}

func buildGaokaoMajorRanking(profile GaokaoProfile) []GaokaoMajorRankingItem {
	majors := []GaokaoMajorRankingItem{
		{Rank: 1, Major: "自动化", RecommendIndex: "★★★★★", Employment: "智能制造、机器人、PLC、电气控制", Reason: "就业面广、考研方向多，和多数工科强校适配。"},
		{Rank: 2, Major: "电气工程及其自动化", RecommendIndex: "★★★★★", Employment: "国家电网、电力设计院、电力设备", Reason: "国企就业优势明显，但热门程度较高，需要关注专业组位次。"},
		{Rank: 3, Major: "电子信息工程", RecommendIndex: "★★★★☆", Employment: "通信、电子研发、嵌入式、AI硬件", Reason: "建议优先选择电子/通信特色院校。"},
		{Rank: 4, Major: "车辆工程", RecommendIndex: "★★★★☆", Employment: "新能源汽车、智能驾驶、整车研发", Reason: "适合汽车产业链城市和车辆特色院校。"},
		{Rank: 5, Major: "集成电路设计与集成系统", RecommendIndex: "★★★★", Employment: "芯片设计、半导体制造", Reason: "行业前景好，但专业热度和录取竞争相对更高。"},
	}
	if len(profile.PreferredMajors) == 0 {
		return majors
	}
	return majors
}

func buildGaokaoFinalSuggestion(report GaokaoProfessionalReport) GaokaoFinalSuggestion {
	out := GaokaoFinalSuggestion{}
	seen := map[string]bool{}
	appendItem := func(dst *[]string, item GaokaoProfessionalReportItem, limit int) {
		if len(*dst) >= limit || seen[item.School] {
			return
		}
		seen[item.School] = true
		*dst = append(*dst, item.School+"（"+item.RecommendedMajors+"）")
	}
	for _, item := range report.TopRecommendations {
		switch bandFromGaokaoChance(item.AdmissionChance) {
		case "冲":
			appendItem(&out.Chong, item, 3)
		case "稳":
			appendItem(&out.Core, item, 6)
		default:
			appendItem(&out.Safe, item, 8)
		}
	}
	return out
}

func recommendIndexFromChance(chance string) string {
	chance = strings.TrimPrefix(strings.TrimSpace(chance), "约")
	chance = strings.TrimSuffix(chance, "%")
	var pct int
	_, _ = fmt.Sscanf(chance, "%d", &pct)
	if pct >= 80 {
		return "★★★★★"
	}
	if pct >= 60 {
		return "★★★★☆"
	}
	if pct >= 35 {
		return "★★★☆☆"
	}
	return "★★☆☆☆"
}
