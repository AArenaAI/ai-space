package services

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"aipool-backend/internal/models"
	"gorm.io/gorm"
)

type GaokaoProfile struct {
	Province          string   `json:"province"`
	Score             int      `json:"score"`
	Rank              int      `json:"rank"`
	Subjects          string   `json:"subjects"`
	PreferredCities   []string `json:"preferred_cities"`
	PreferredMajors   []string `json:"preferred_majors"`
	RejectedMajors    []string `json:"rejected_majors"`
	SchoolType        string   `json:"school_type"`
	TuitionLimit      int      `json:"tuition_limit"`
	AcceptCooperation bool     `json:"accept_cooperation"`
	ObeyAdjustment    bool     `json:"obey_adjustment"`
	Strategy          string   `json:"strategy"`
}

type GaokaoRecommendation struct {
	ID                    string              `json:"id"`
	Band                  string              `json:"band"`
	RiskScore             int                 `json:"risk_score"`
	FitScore              int                 `json:"fit_score"`
	School                string              `json:"school"`
	City                  string              `json:"city"`
	Province              string              `json:"province"`
	Level                 string              `json:"level"`
	Type                  string              `json:"type"`
	SchoolType            string              `json:"school_type"`
	DualClass             string              `json:"dual_class"`
	Department            string              `json:"department"`
	MajorGroup            string              `json:"major_group"`
	Major                 string              `json:"major"`
	GroupMajors           []string            `json:"group_majors"`
	RecommendedMajorPool  []string            `json:"recommended_major_pool"`
	MajorPoolTier         GaokaoMajorPoolTier `json:"major_pool_tier"`
	RejectedMajorsInGroup []string            `json:"rejected_majors_in_group"`
	HasRejectedMajorRisk  bool                `json:"has_rejected_major_risk"`
	MajorGroupRiskLevel   string              `json:"major_group_risk_level"`
	SubjectRequirement    string              `json:"subject_requirement"`
	Tuition               int                 `json:"tuition"`
	Ranks                 []int               `json:"ranks"`
	PlanChange            int                 `json:"plan_change"`
	Heat                  string              `json:"heat"`
	Employment            string              `json:"employment"`
	Note                  string              `json:"note"`
	Source                string              `json:"source"`
	Year                  int                 `json:"year"`
	DataLevel             string              `json:"data_level"`
	Reason                []string            `json:"reason"`
}

type GaokaoRecommendResult struct {
	Recommendations  []GaokaoRecommendation `json:"recommendations"`
	DataVersion      string                 `json:"data_version"`
	DataSourceNote   string                 `json:"data_source_note"`
	NeedsModelLookup bool                   `json:"needs_model_lookup"`
	LookupPrompt     string                 `json:"lookup_prompt"`
	Disclaimer       string                 `json:"disclaimer"`
}

type GaokaoService struct{ db *gorm.DB }

func NewGaokaoService(db *gorm.DB) *GaokaoService { return &GaokaoService{db: db} }

func (s *GaokaoService) EnsureSeedData() error {
	var count int64
	if err := s.db.Model(&models.GaokaoAdmissionRecord{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	schools := []models.GaokaoSchool{
		{Code: "scut", Name: "华南理工大学", Province: "广东", City: "广州", Level: "985 / 双一流", Ownership: "公办", Tags: "工科强校,珠三角"},
		{Code: "jnu", Name: "暨南大学", Province: "广东", City: "广州", Level: "211 / 双一流", Ownership: "公办", Tags: "综合类,广州"},
		{Code: "sustech", Name: "南方科技大学", Province: "广东", City: "深圳", Level: "双一流建设参考", Ownership: "公办", Tags: "新型研究型大学,深圳"},
		{Code: "scnu", Name: "华南师范大学", Province: "广东", City: "广州", Level: "211 / 双一流", Ownership: "公办", Tags: "师范,广州"},
		{Code: "gdut", Name: "广东工业大学", Province: "广东", City: "广州", Level: "省重点", Ownership: "公办", Tags: "工科,广州"},
		{Code: "hdu", Name: "杭州电子科技大学", Province: "浙江", City: "杭州", Level: "省重点", Ownership: "公办", Tags: "电子信息,杭州"},
		{Code: "njupt", Name: "南京邮电大学", Province: "江苏", City: "南京", Level: "双一流", Ownership: "公办", Tags: "通信,南京"},
		{Code: "cqupt", Name: "重庆邮电大学", Province: "重庆", City: "重庆", Level: "省重点", Ownership: "公办", Tags: "通信,软件"},
		{Code: "scu", Name: "四川大学", Province: "四川", City: "成都", Level: "985 / 双一流", Ownership: "公办", Tags: "综合类,成都"},
		{Code: "whut", Name: "武汉理工大学", Province: "湖北", City: "武汉", Level: "211 / 双一流", Ownership: "公办", Tags: "工科,武汉"},
		{Code: "xjtlu", Name: "西交利物浦大学", Province: "江苏", City: "苏州", Level: "中外合作", Ownership: "中外合作", Tags: "国际化,苏州"},
		{Code: "dgut", Name: "东莞理工学院", Province: "广东", City: "东莞", Level: "省属本科", Ownership: "公办", Tags: "珠三角,工科"},
	}
	for i := range schools {
		if err := s.db.Create(&schools[i]).Error; err != nil {
			return err
		}
	}
	byCode := map[string]models.GaokaoSchool{}
	for _, sc := range schools {
		byCode[sc.Code] = sc
	}

	majors := []models.GaokaoMajor{
		{Code: "soft", Name: "软件工程", Category: "计算机类", Heat: "高", Employment: "互联网、金融科技、智能制造"},
		{Code: "ai", Name: "人工智能", Category: "计算机类", Heat: "高", Employment: "算法工程、数据智能、产业 AI"},
		{Code: "ee", Name: "电子信息类", Category: "电子信息类", Heat: "高", Employment: "芯片、通信、智能硬件"},
		{Code: "cs", Name: "计算机科学与技术", Category: "计算机类", Heat: "高", Employment: "软件开发、教育科技、信息系统"},
		{Code: "auto", Name: "自动化", Category: "自动化类", Heat: "中", Employment: "工业控制、机器人、新能源"},
		{Code: "comm", Name: "通信工程", Category: "电子信息类", Heat: "中", Employment: "通信运营商、芯片、网络设备"},
		{Code: "data", Name: "数据科学与大数据技术", Category: "计算机类", Heat: "中", Employment: "数据分析、海外升学、产品技术"},
	}
	for i := range majors {
		if err := s.db.Create(&majors[i]).Error; err != nil {
			return err
		}
	}
	byMajor := map[string]models.GaokaoMajor{}
	for _, m := range majors {
		byMajor[m.Code] = m
	}

	type seed struct {
		School, Major, Group        string
		Tuition, Plan2024, Plan2025 int
		Ranks                       [3]int
		Scores                      [3]int
		Note                        string
	}
	seeds := []seed{
		{"scut", "soft", "物理组 203", 6850, 22, 25, [3]int{24500, 26300, 28600}, [3]int{622, 617, 611}, "学校层级强，专业热度高，适合冲刺。"},
		{"jnu", "ai", "物理组 206", 6850, 36, 41, [3]int{30000, 31800, 33700}, [3]int{603, 596, 590}, "城市和专业匹配度高，近三年位次有轻微上移。"},
		{"sustech", "ee", "综合评价", 6000, 18, 20, [3]int{28500, 30900, 32600}, [3]int{608, 599, 593}, "深圳区位强，但综合评价和录取规则需单独核查。"},
		{"scnu", "cs", "物理组 214", 6850, 45, 53, [3]int{33600, 35400, 37100}, [3]int{592, 586, 581}, "广州 211，专业稳定，是主力稳妥项。"},
		{"gdut", "auto", "物理组 205", 6850, 82, 92, [3]int{38200, 40100, 43800}, [3]int{579, 573, 566}, "工科就业导向明显，安全边际较好。"},
		{"hdu", "cs", "物理组", 6900, 16, 16, [3]int{29200, 31500, 34600}, [3]int{606, 598, 589}, "专业口碑强，城市匹配，但省外计划波动需核查。"},
		{"njupt", "comm", "物理组", 6380, 24, 22, [3]int{33000, 35100, 37800}, [3]int{594, 587, 579}, "信息通信强校，适合作为专业优先稳妥项。"},
		{"cqupt", "soft", "物理组", 9000, 32, 38, [3]int{39500, 42100, 45800}, [3]int{575, 568, 559}, "专业方向清晰，位次安全边际较好。"},
		{"scu", "ee", "物理组", 6500, 20, 17, [3]int{27600, 29200, 31900}, [3]int{611, 605, 597}, "学校层级高，适合略冲，需关注计划缩减。"},
		{"whut", "auto", "物理组", 5850, 28, 32, [3]int{34800, 37200, 40500}, [3]int{590, 582, 574}, "211 工科平台，和当前位次匹配。"},
		{"xjtlu", "data", "物理组", 88000, 30, 42, [3]int{42000, 47000, 52000}, [3]int{568, 552, 538}, "适合国际化路线，但学费高。"},
		{"dgut", "ee", "物理组 204", 5710, 96, 111, [3]int{52000, 55700, 60300}, [3]int{541, 532, 520}, "珠三角公办保底，安全边际明显。"},
	}
	for _, row := range seeds {
		school := byCode[row.School]
		major := byMajor[row.Major]
		years := []int{2023, 2024, 2025}
		for i, year := range years {
			plan := row.Plan2025
			if year == 2024 {
				plan = row.Plan2024
			}
			if year == 2023 {
				plan = maxGaokaoInt(1, row.Plan2024-3)
			}
			rec := models.GaokaoAdmissionRecord{Year: year, SourceProvince: "广东", Batch: "本科批", SubjectType: "物理类", SchoolID: school.ID, MajorID: major.ID, MajorGroup: row.Group, SubjectRequirement: "物理+化学", MinScore: row.Scores[i], MinRank: row.Ranks[i], AvgScore: row.Scores[i] + 5, AvgRank: maxGaokaoInt(1, row.Ranks[i]-1200), PlanCount: plan, Tuition: row.Tuition, Source: "AI Space seed demo; replace with official exam authority / college data"}
			if err := s.db.Create(&rec).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *GaokaoService) Recommend(profile GaokaoProfile) (GaokaoRecommendResult, error) {
	if profile.Rank <= 0 {
		profile.Rank = 30000
	}
	if profile.Province == "" {
		profile.Province = "广东"
	}
	if profile.Strategy == "" {
		profile.Strategy = "balanced"
	}
	var records []models.GaokaoAdmissionRecord
	err := s.db.Preload("School").Preload("Major").
		Where("source_province = ?", profile.Province).
		Where("source NOT ILIKE ? AND source NOT ILIKE ?", "%seed%", "%demo%").
		Order("school_id asc, major_id asc, year desc").Find(&records).Error
	if err != nil {
		return GaokaoRecommendResult{}, err
	}
	grouped := map[string][]models.GaokaoAdmissionRecord{}
	for _, rec := range records {
		grouped[rec.School.Code+":"+rec.Major.Code+":"+rec.MajorGroup] = append(grouped[rec.School.Code+":"+rec.Major.Code+":"+rec.MajorGroup], rec)
	}
	out := make([]GaokaoRecommendation, 0, len(grouped))
	for key, rows := range grouped {
		if len(rows) == 0 {
			continue
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i].Year > rows[j].Year })
		rec, ok := s.score(profile, key, rows)
		if ok {
			out = append(out, rec)
		}
	}
	out = aggregateRecommendationsByMajorGroup(profile, out)
	sort.Slice(out, func(i, j int) bool { return out[i].FitScore > out[j].FitScore })
	out = selectGaokaoPortfolio(out, profile)
	s.enrichRecommendationMajorGroups(profile, out)
	needsLookup := len(out) < 60
	lookupPrompt := ""
	if needsLookup {
		lookupPrompt = fmt.Sprintf("当前本地库仅命中 %d 条候选。请基于%s省%s、全省位次约%d，优先补查本科批/本科线边缘院校、职业技术大学和民办本科的官方录取位次/招生计划，不得编造数据，需返回来源。", len(out), profile.Province, profile.Subjects, profile.Rank)
	}
	return GaokaoRecommendResult{Recommendations: out, DataVersion: "gaokao-compass-2025", DataSourceNote: "已接入 GaokaoCompass-11M 公开数据；部分省份/专业仍需以省考试院和高校官网复核。当前推荐已做同校去重和冲稳保垫配比，正式填报仍需核对省考试院/高校招生章程。", NeedsModelLookup: needsLookup, LookupPrompt: lookupPrompt, Disclaimer: "AI 推荐仅供参考，不构成录取承诺；最终以省级招生考试机构和高校官方招生章程为准。"}, nil
}

func (s *GaokaoService) enrichRecommendationMajorGroups(profile GaokaoProfile, recommendations []GaokaoRecommendation) {
	if s == nil || s.db == nil || len(recommendations) == 0 {
		return
	}
	schools := []string{}
	groups := []string{}
	years := []int{}
	seenSchool, seenGroup, seenYear := map[string]bool{}, map[string]bool{}, map[int]bool{}
	for _, rec := range recommendations {
		if rec.School != "" && !seenSchool[rec.School] {
			seenSchool[rec.School] = true
			schools = append(schools, rec.School)
		}
		if rec.MajorGroup != "" && !seenGroup[rec.MajorGroup] {
			seenGroup[rec.MajorGroup] = true
			groups = append(groups, rec.MajorGroup)
		}
		if rec.Year > 0 && !seenYear[rec.Year] {
			seenYear[rec.Year] = true
			years = append(years, rec.Year)
		}
	}
	if len(schools) == 0 || len(groups) == 0 {
		return
	}
	type row struct {
		School     string
		MajorGroup string
		Major      string
		Year       int
	}
	rows := []row{}
	q := s.db.Table("gaokao_admission_records ar").
		Select("sc.name as school, ar.major_group as major_group, m.name as major, ar.year as year").
		Joins("join gaokao_schools sc on sc.id = ar.school_id").
		Joins("join gaokao_majors m on m.id = ar.major_id").
		Where("ar.source_province = ? AND sc.name IN ? AND ar.major_group IN ? AND m.name <> ?", profile.Province, schools, groups, "院校投档线")
	if len(years) > 0 {
		q = q.Where("ar.year IN ?", years)
	}
	if err := q.Group("sc.name, ar.major_group, m.name, ar.year").Order("sc.name asc, ar.major_group asc, m.name asc").Find(&rows).Error; err != nil {
		return
	}
	byGroup := map[string][]string{}
	seenMajor := map[string]bool{}
	for _, row := range rows {
		key := groupKey(row.School, row.MajorGroup)
		seenKey := key + "::" + row.Major
		if row.Major == "" || seenMajor[seenKey] {
			continue
		}
		seenMajor[seenKey] = true
		byGroup[key] = append(byGroup[key], row.Major)
	}
	for i := range recommendations {
		rec := &recommendations[i]
		majors := byGroup[groupKey(rec.School, rec.MajorGroup)]
		if len(majors) == 0 {
			continue
		}
		poolTier := tierGaokaoMajorPool(profile, majors)
		rec.GroupMajors = majors
		rec.MajorPoolTier = poolTier
		rec.RecommendedMajorPool = flattenedRecommendedMajorPool(poolTier)
		rec.RejectedMajorsInGroup = poolTier.Rejected
		rec.HasRejectedMajorRisk = len(poolTier.Rejected) > 0
		rec.MajorGroupRiskLevel = "low"
		if len(poolTier.Rejected) > 0 {
			rec.MajorGroupRiskLevel = "high"
		} else if len(majors) >= 6 && rec.Band == "冲" {
			rec.MajorGroupRiskLevel = "medium"
		}
		if len(majors) > 1 {
			rec.Major = "专业组推荐"
		}
	}
}

func aggregateRecommendationsByMajorGroup(profile GaokaoProfile, recommendations []GaokaoRecommendation) []GaokaoRecommendation {
	groups := map[string][]GaokaoRecommendation{}
	order := []string{}
	for _, rec := range recommendations {
		key := groupKey(rec.School, rec.MajorGroup)
		if _, ok := groups[key]; !ok {
			order = append(order, key)
		}
		groups[key] = append(groups[key], rec)
	}
	out := make([]GaokaoRecommendation, 0, len(groups))
	for _, key := range order {
		items := groups[key]
		if len(items) == 0 {
			continue
		}
		sort.SliceStable(items, func(i, j int) bool {
			if items[i].FitScore != items[j].FitScore {
				return items[i].FitScore > items[j].FitScore
			}
			return items[i].RiskScore < items[j].RiskScore
		})
		base := items[0]
		majors := []string{}
		seen := map[string]bool{}
		for _, item := range items {
			if item.Major == "" || item.Major == "院校投档线" || seen[item.Major] {
				continue
			}
			seen[item.Major] = true
			majors = append(majors, item.Major)
		}
		poolTier := tierGaokaoMajorPool(profile, majors)
		base.GroupMajors = majors
		base.MajorPoolTier = poolTier
		base.RecommendedMajorPool = flattenedRecommendedMajorPool(poolTier)
		base.RejectedMajorsInGroup = poolTier.Rejected
		rejected := poolTier.Rejected
		base.HasRejectedMajorRisk = len(rejected) > 0
		base.MajorGroupRiskLevel = "low"
		if len(rejected) > 0 {
			base.MajorGroupRiskLevel = "high"
		} else if len(majors) >= 6 && base.Band == "冲" {
			base.MajorGroupRiskLevel = "medium"
		}
		if len(majors) > 1 {
			base.Major = "专业组推荐"
			base.Note = strings.TrimSpace(base.Note + "; 专业组内推荐专业池：" + strings.Join(base.RecommendedMajorPool, "、"))
		}
		out = append(out, base)
	}
	return out
}

func selectGaokaoPortfolio(candidates []GaokaoRecommendation, profile GaokaoProfile) []GaokaoRecommendation {
	if len(candidates) == 0 {
		return candidates
	}
	// Recommendation view should be a compact, high-quality portfolio, not a full
	// volunteer-table fill. The province rule still controls final table generation.
	targetLimit := 24
	targets := map[string]int{"冲": 6, "稳": 7, "保": 7, "垫": 4}
	maxPerSchool := 2
	switch profile.Strategy {
	case "aggressive":
		targets = map[string]int{"冲": 8, "稳": 7, "保": 6, "垫": 3}
	case "safe":
		targets = map[string]int{"冲": 4, "稳": 7, "保": 8, "垫": 5}
	case "school":
		maxPerSchool = 3
	case "major":
		maxPerSchool = 2
	case "city":
		maxPerSchool = 2
	}
	buckets := map[string][]GaokaoRecommendation{"冲": {}, "稳": {}, "保": {}, "垫": {}}
	for _, item := range candidates {
		if _, ok := buckets[item.Band]; !ok {
			buckets[item.Band] = []GaokaoRecommendation{}
		}
		buckets[item.Band] = append(buckets[item.Band], item)
	}
	selected := make([]GaokaoRecommendation, 0, minGaokaoInt(targetLimit, len(candidates)))
	picked := map[string]bool{}
	schoolCount := map[string]int{}
	tryAdd := func(item GaokaoRecommendation, strictSchoolLimit bool) bool {
		if picked[item.ID] {
			return false
		}
		limit := maxPerSchool
		if !strictSchoolLimit {
			limit = maxGaokaoInt(maxPerSchool, 5)
		}
		if schoolCount[item.School] >= limit {
			return false
		}
		selected = append(selected, item)
		picked[item.ID] = true
		schoolCount[item.School]++
		return true
	}
	for _, band := range []string{"冲", "稳", "保", "垫"} {
		quota := targets[band]
		for _, item := range buckets[band] {
			if countGaokaoBand(selected, band) >= quota || len(selected) >= targetLimit {
				break
			}
			tryAdd(item, true)
		}
	}
	// Fill any remaining slots with best candidates, still respecting a softer school limit.
	for _, item := range candidates {
		if len(selected) >= targetLimit {
			break
		}
		tryAdd(item, false)
	}
	// Final fallback for sparse provinces: fill without school cap.
	for _, item := range candidates {
		if len(selected) >= targetLimit {
			break
		}
		if picked[item.ID] {
			continue
		}
		selected = append(selected, item)
		picked[item.ID] = true
	}
	sort.SliceStable(selected, func(i, j int) bool {
		order := map[string]int{"冲": 0, "稳": 1, "保": 2, "垫": 3}
		if order[selected[i].Band] != order[selected[j].Band] {
			return order[selected[i].Band] < order[selected[j].Band]
		}
		return selected[i].FitScore > selected[j].FitScore
	})
	return selected
}

func countGaokaoBand(items []GaokaoRecommendation, band string) int {
	count := 0
	for _, item := range items {
		if item.Band == band {
			count++
		}
	}
	return count
}

func minGaokaoInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (s *GaokaoService) score(profile GaokaoProfile, key string, rows []models.GaokaoAdmissionRecord) (GaokaoRecommendation, bool) {
	latest := rows[0]
	if strings.TrimSpace(profile.Subjects) != "" && strings.TrimSpace(latest.SubjectType) != "" && !containsFold(latest.SubjectType, profile.Subjects) && !containsFold(profile.Subjects, latest.SubjectType) {
		return GaokaoRecommendation{}, false
	}
	school := latest.School
	major := latest.Major
	if profile.SchoolType == "只看公办" && school.Ownership != "公办" {
		return GaokaoRecommendation{}, false
	}
	if !profile.AcceptCooperation && school.Ownership == "中外合作" {
		return GaokaoRecommendation{}, false
	}
	if profile.TuitionLimit > 0 && latest.Tuition > profile.TuitionLimit {
		return GaokaoRecommendation{}, false
	}
	for _, rejected := range profile.RejectedMajors {
		if containsFold(major.Name, rejected) || containsFold(major.Category, rejected) {
			return GaokaoRecommendation{}, false
		}
	}

	ranks := make([]int, 0, len(rows))
	plans := make([]int, 0, len(rows))
	for _, row := range rows {
		ranks = append(ranks, row.MinRank)
		plans = append(plans, row.PlanCount)
	}
	avgRank := averageInts(ranks)
	distance := avgRank - profile.Rank
	ratio := float64(avgRank) / math.Max(float64(profile.Rank), 1)
	band := bandGaokaoRankWindow(profile.Rank, avgRank)
	if band == "" {
		return GaokaoRecommendation{}, false
	}

	cityHit := listContainsAny(profile.PreferredCities, school.City, school.Province)
	majorHit := listContainsAny(profile.PreferredMajors, major.Name, major.Category)
	dataLevel := gaokaoDataLevel(major.Code, latest.Source)
	// Do not call findEnrollmentPlan here: score() runs for every provincial candidate
	// and per-candidate plan lookups make /api/gaokao/recommend look stuck. Import-time
	// plan enrichment already fills tuition/plan/subject for most records; remaining gaps
	// can be enriched after portfolio selection if needed.
	planChange := 0
	if len(plans) >= 2 && dataLevel != "专业录取" {
		planChange = plans[0] - plans[1]
	}

	fit := 70.0
	// Balanced mode should prefer the main "稳" window instead of pushing very safe "垫" options to the top.
	fit += 24 - clamp(math.Abs(ratio-1.12)*70, 0, 24)
	if cityHit {
		fit += 10
	}
	if majorHit {
		fit += 16
	}
	if listContainsAny(profile.PreferredMajors, school.Tags, major.Category, major.Employment) {
		fit += 8
	}
	if school.Ownership == "公办" {
		fit += 8
	} else {
		fit -= 8
	}
	fit += float64(planChange) * 0.8
	switch major.Heat {
	case "高":
		fit -= 4
	case "低":
		fit += 4
	}
	switch profile.Strategy {
	case "aggressive":
		if band == "冲" {
			fit += 12
		}
	case "safe":
		if band == "保" || band == "垫" {
			fit += 14
		}
	case "major":
		if majorHit {
			fit += 14
		}
	case "city":
		if cityHit {
			fit += 14
		}
	case "school":
		if strings.Contains(school.Level, "985") {
			fit += 16
		} else if strings.Contains(school.Level, "211") || strings.Contains(school.Level, "双一流") {
			fit += 12
		}
	}
	if strings.Contains(school.Level, "985") {
		fit += 8
	} else if strings.Contains(school.Level, "211") || strings.Contains(school.Level, "双一流") {
		fit += 5
	}

	risk := 58 - (float64(distance)/math.Max(float64(profile.Rank), 1))*45
	if major.Heat == "高" {
		risk += 10
	}
	risk -= float64(planChange) * 0.8
	risk = clamp(risk, 8, 96)

	trendText := fmt.Sprintf("招生计划变化 %+d，专业热度%s，综合判断为“%s”。", planChange, major.Heat, band)
	if dataLevel == "专业录取" {
		trendText = fmt.Sprintf("该记录为专业级最低分/位次，综合判断为“%s”。", band)
	}
	reason := []string{
		fmt.Sprintf("你当前位次约 %d，该方向近三年最低位次约 %s。", profile.Rank, joinInts(ranks, " / ")),
		fmt.Sprintf("%s 与城市偏好%s，%s 与专业偏好%s。", displayLocation(school), yesNoMatch(cityHit), major.Name, yesNoMatch(majorHit)),
		trendText,
	}
	if school.Ownership != "公办" {
		reason = append(reason, school.Ownership+"项目需重点核查学费、培养模式和家长接受度。")
	}
	if profile.ObeyAdjustment {
		reason = append(reason, "你选择服从调剂，仍需检查专业组内是否有明显不接受专业。")
	}

	return GaokaoRecommendation{
		ID: key, Band: band, RiskScore: int(math.Round(risk)), FitScore: int(math.Round(fit)),
		School: school.Name, City: school.City, Province: school.Province, Level: school.Level, Type: school.Ownership,
		SchoolType: school.SchoolType, DualClass: school.DualClass, Department: school.Department,
		MajorGroup: latest.MajorGroup, Major: major.Name, SubjectRequirement: latest.SubjectRequirement, Tuition: latest.Tuition,
		Ranks: ranks, PlanChange: planChange, Heat: major.Heat, Employment: major.Employment, Note: school.Tags,
		Source: latest.Source, Year: latest.Year, DataLevel: dataLevel,
		Reason: reason,
	}, true
}

func averageInts(values []int) int {
	if len(values) == 0 {
		return 0
	}
	total := 0
	for _, v := range values {
		total += v
	}
	return total / len(values)
}
func maxGaokaoInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func clamp(v, minV, maxV float64) float64 {
	if v < minV {
		return minV
	}
	if v > maxV {
		return maxV
	}
	return v
}
func containsFold(s, sub string) bool {
	s = strings.TrimSpace(s)
	sub = strings.TrimSpace(sub)
	return sub != "" && strings.Contains(strings.ToLower(s), strings.ToLower(sub))
}
func listContainsAny(list []string, values ...string) bool {
	for _, item := range list {
		for _, v := range values {
			if containsFold(v, item) || containsFold(item, v) {
				return true
			}
		}
	}
	return false
}

func displayLocation(school models.GaokaoSchool) string {
	if strings.TrimSpace(school.City) != "" {
		return school.City
	}
	if strings.TrimSpace(school.Province) != "" {
		return school.Province
	}
	return "所在地未补全"
}

func yesNoMatch(ok bool) string {
	if ok {
		return "匹配"
	}
	return "不完全匹配"
}
func joinInts(values []int, sep string) string {
	parts := make([]string, 0, len(values))
	for _, v := range values {
		parts = append(parts, fmt.Sprintf("%d", v))
	}
	return strings.Join(parts, sep)
}

func (s *GaokaoService) findEnrollmentPlan(admission models.GaokaoAdmissionRecord, school models.GaokaoSchool, major models.GaokaoMajor) *models.GaokaoEnrollmentPlan {
	if s == nil || s.db == nil || school.ID == 0 || major.ID == 0 {
		return nil
	}
	var plan models.GaokaoEnrollmentPlan
	var fallback *models.GaokaoEnrollmentPlan
	q := s.db.Where("year = ? AND source_province = ? AND school_id = ? AND major_id = ?", admission.Year, admission.SourceProvince, school.ID, major.ID)
	if strings.TrimSpace(admission.MajorGroup) != "" {
		if err := q.Where("major_group = ?", admission.MajorGroup).Order("tuition DESC, plan_count DESC").First(&plan).Error; err == nil {
			if plan.Tuition > 0 {
				return &plan
			}
			fallback = &plan
		}
	}
	q = s.db.Where("year = ? AND source_province = ? AND school_id = ? AND major_id = ?", admission.Year, admission.SourceProvince, school.ID, major.ID)
	if strings.TrimSpace(admission.SubjectType) != "" {
		q = q.Where("subject_type = ? OR subject_type = ''", admission.SubjectType)
	}
	if err := q.Order("tuition DESC, plan_count DESC").First(&plan).Error; err == nil {
		if plan.Tuition > 0 {
			return &plan
		}
		if fallback == nil {
			fallback = &plan
		}
	}
	// Fallback: plan and admission files may create different synthetic major IDs when major_code is absent.
	// Match within the same school/province/year by raw major name.
	q = s.db.Where("year = ? AND source_province = ? AND school_id = ? AND major_name_raw = ?", admission.Year, admission.SourceProvince, school.ID, major.Name)
	if strings.TrimSpace(admission.SubjectType) != "" {
		q = q.Where("subject_type = ? OR subject_type = ''", admission.SubjectType)
	}
	if err := q.Order("tuition DESC, plan_count DESC").First(&plan).Error; err == nil {
		if plan.Tuition > 0 {
			return &plan
		}
		if fallback == nil {
			fallback = &plan
		}
	}

	// Looser normalized-name fallback: handles “计算机类” vs “计算机科学与技术”,
	// “软件工程(卓越班)” vs “软件工程” and plan/admission note differences.
	normalized := normalizeGaokaoMajorName(major.Name)
	if normalized != "" {
		var candidates []models.GaokaoEnrollmentPlan
		q = s.db.Where("year = ? AND source_province = ? AND school_id = ?", admission.Year, admission.SourceProvince, school.ID)
		if strings.TrimSpace(admission.SubjectType) != "" {
			q = q.Where("subject_type = ? OR subject_type = ''", admission.SubjectType)
		}
		if err := q.Order("tuition DESC, plan_count DESC").Limit(60).Find(&candidates).Error; err == nil {
			for _, candidate := range candidates {
				candidateName := normalizeGaokaoMajorName(candidate.MajorNameRaw)
				if candidateName == "" {
					continue
				}
				if candidateName == normalized || strings.Contains(candidateName, normalized) || strings.Contains(normalized, candidateName) || sameGaokaoMajorFamily(candidateName, normalized) {
					if candidate.Tuition == 0 && fallback != nil {
						continue
					}
					return &candidate
				}
			}
		}
	}
	return fallback
}

func normalizeGaokaoMajorName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	// Remove common full-width/half-width bracketed directions and notes.
	replacers := []string{"（", "(", "【", "[", "〔"}
	cut := len(name)
	for _, mark := range replacers {
		if idx := strings.Index(name, mark); idx >= 0 && idx < cut {
			cut = idx
		}
	}
	name = name[:cut]
	for _, token := range []string{"专业", "类", "试验班", "实验班", "卓越班", "创新班", "拔尖班", "基地班", "方向", "校企合作", "中外合作办学", "中外合作"} {
		name = strings.ReplaceAll(name, token, "")
	}
	name = strings.ReplaceAll(name, " ", "")
	name = strings.ReplaceAll(name, "、", "")
	name = strings.ReplaceAll(name, "/", "")
	return strings.TrimSpace(name)
}

func sameGaokaoMajorFamily(a, b string) bool {
	families := [][]string{
		{"计算机", "软件工程", "人工智能", "数据科学", "大数据", "网络工程", "信息安全", "物联网", "智能科学", "数字媒体技术", "区块链"},
		{"电子信息", "电子科学", "通信工程", "集成电路", "微电子", "光电信息", "信息工程", "电磁场", "人工智能"},
		{"电气", "智能电网", "能源互联网", "自动化"},
		{"自动化", "机器人工程", "智能装备", "测控技术"},
		{"机械", "车辆工程", "机械设计制造", "机械电子", "智能制造", "工业设计"},
		{"材料", "高分子", "新能源材料", "金属材料", "无机非金属"},
		{"土木", "建筑环境", "给排水", "道路桥梁", "工程管理"},
		{"工商管理", "会计", "财务管理", "审计", "市场营销", "人力资源", "国际商务"},
		{"金融", "经济", "财政", "保险", "投资", "金融工程"},
		{"法学", "知识产权", "政治学", "社会工作"},
		{"临床医学", "医学", "口腔医学", "麻醉", "影像医学", "儿科学"},
		{"药学", "中药", "制药"},
		{"师范", "教育", "小学教育", "学前教育", "特殊教育"},
		{"外国语", "英语", "日语", "翻译", "商务英语"},
		{"新闻", "传播", "广告", "网络与新媒体", "广播电视"},
	}
	for _, family := range families {
		aHit, bHit := false, false
		for _, token := range family {
			if strings.Contains(a, token) {
				aHit = true
			}
			if strings.Contains(b, token) {
				bHit = true
			}
		}
		if aHit && bHit {
			return true
		}
	}
	return false
}

func gaokaoDataLevel(majorCode, source string) string {
	if strings.Contains(source, "major-admission") || strings.Contains(source, "GaokaoCompass-11M major") {
		return "专业录取"
	}
	if majorCode == "school-admission" || strings.Contains(source, "school-admission") {
		return "院校/专业组投档"
	}
	return "录取记录"
}
