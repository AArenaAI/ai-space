package services

import (
	"fmt"
	"strings"
	"testing"

	"aipool-backend/internal/models"
)

func TestBuildVolunteerTableGuangdong45Slots(t *testing.T) {
	recs := []GaokaoRecommendation{}
	bands := []string{"冲", "稳", "保", "垫"}
	for i := 0; i < 80; i++ {
		band := bands[0]
		switch {
		case i < 10:
			band = "冲"
		case i < 35:
			band = "稳"
		case i < 60:
			band = "保"
		default:
			band = "垫"
		}
		recs = append(recs, GaokaoRecommendation{
			ID: fmt.Sprintf("id-%d", i), Band: band, School: "学校" + string(rune('A'+i%30)), City: "广州", Province: "广东",
			MajorGroup: "20" + string(rune('0'+i%10)), Major: "计算机科学与技术", SubjectRequirement: "首选物理，再选化学",
			Tuition: 6850, Ranks: []int{50000 + i*100}, FitScore: 100 - i, RiskScore: 30,
		})
	}
	result := BuildGaokaoVolunteerTable(GaokaoProfile{Province: "广东", Rank: 50000, Strategy: "balanced", ObeyAdjustment: true}, recs, 45)
	if result.Mode != "广东普通类本科批院校专业组" {
		t.Fatalf("unexpected mode: %s", result.Mode)
	}
	if len(result.Items) != 45 {
		t.Fatalf("expected 45 items, got %d", len(result.Items))
	}
	if result.Items[0].Index != 1 || result.Items[44].Index != 45 {
		t.Fatalf("indexes not continuous: first=%d last=%d", result.Items[0].Index, result.Items[44].Index)
	}
	if result.Stats["冲"] != 6 || result.Stats["稳"] != 19 || result.Stats["保"] != 13 || result.Stats["垫"] != 7 {
		t.Fatalf("unexpected stats: %#v", result.Stats)
	}
	for _, item := range result.Items {
		if item.School == "" || item.MajorGroup == "" || item.Major == "" || item.RiskTip == "" {
			t.Fatalf("incomplete item: %#v", item)
		}
	}
}

func TestBuildVolunteerTableAddsMajorGroupRisk(t *testing.T) {
	recs := []GaokaoRecommendation{{
		ID: "a", Band: "稳", School: "广东工业大学", City: "广州", Province: "广东",
		MajorGroup: "（202）", Major: "计算机科学与技术", SubjectRequirement: "首选物理，再选化学",
		Tuition: 6850, Ranks: []int{52000}, FitScore: 100, RiskScore: 40,
	}, {
		ID: "b", Band: "保", School: "广东工业大学", City: "广州", Province: "广东",
		MajorGroup: "（202）", Major: "土木工程", SubjectRequirement: "首选物理，再选化学",
		Tuition: 6850, Ranks: []int{70000}, FitScore: 90, RiskScore: 20,
	}, {
		ID: "c", Band: "保", School: "广东工业大学", City: "广州", Province: "广东",
		MajorGroup: "（202）", Major: "软件工程", SubjectRequirement: "首选物理，再选化学",
		Tuition: 6850, Ranks: []int{65000}, FitScore: 80, RiskScore: 25,
	}}
	result := BuildGaokaoVolunteerTable(GaokaoProfile{Province: "广东", Rank: 50000, RejectedMajors: []string{"土木"}, ObeyAdjustment: true}, recs, 1)
	if len(result.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(result.Items))
	}
	item := result.Items[0]
	if len(item.GroupMajors) != 3 {
		t.Fatalf("expected all 3 group majors, got %#v", item.GroupMajors)
	}
	if len(item.RecommendedMajorPool) != 2 {
		t.Fatalf("expected recommended pool excludes rejected major, got %#v", item.RecommendedMajorPool)
	}
	if !item.HasRejectedMajorRisk || item.MajorGroupRiskLevel != "high" {
		t.Fatalf("expected high rejected major risk, got risk=%v level=%s", item.HasRejectedMajorRisk, item.MajorGroupRiskLevel)
	}
}

func TestGaokaoVolunteerRulesByProvince(t *testing.T) {
	cases := []struct {
		province string
		slots    int
		mode     string
	}{
		{"广东", 45, "广东普通类本科批院校专业组"},
		{"浙江", 80, "浙江普通类专业平行志愿"},
		{"山东", 96, "山东普通类专业+院校平行志愿"},
		{"江苏", 40, "江苏普通类本科批院校专业组"},
	}
	for _, tc := range cases {
		rule := GaokaoVolunteerRuleForProvince(tc.province)
		if rule.DefaultSlots != tc.slots || rule.Mode != tc.mode {
			t.Fatalf("%s rule mismatch: %#v", tc.province, rule)
		}
	}
}

func TestGaokaoVolunteerRuleStructuredFields(t *testing.T) {
	guangdong := GaokaoVolunteerRuleForProvince("广东")
	if guangdong.MajorCountPerUnit != 6 || !guangdong.HasAdjustment || !guangdong.IsParallel {
		t.Fatalf("unexpected guangdong structured rule: %#v", guangdong)
	}
	shanghai := GaokaoVolunteerRuleForProvince("上海")
	if shanghai.MajorCountPerUnit != 4 || !shanghai.HasAdjustment {
		t.Fatalf("unexpected shanghai structured rule: %#v", shanghai)
	}
	zhejiang := GaokaoVolunteerRuleForProvince("浙江")
	if zhejiang.MajorCountPerUnit != 1 || zhejiang.HasAdjustment || !zhejiang.IsParallel {
		t.Fatalf("unexpected zhejiang structured rule: %#v", zhejiang)
	}
	liaoning := GaokaoVolunteerRuleForProvince("辽宁")
	if liaoning.DefaultSlots != 112 || liaoning.MajorCountPerUnit != 1 || liaoning.HasAdjustment {
		t.Fatalf("unexpected liaoning structured rule: %#v", liaoning)
	}
}

func TestAggregateRecommendationsByMajorGroup(t *testing.T) {
	recs := []GaokaoRecommendation{{
		ID: "a", Band: "冲", School: "南京信息工程大学", MajorGroup: "（213）", Major: "微电子科学与工程", FitScore: 121, RiskScore: 60,
	}, {
		ID: "b", Band: "冲", School: "南京信息工程大学", MajorGroup: "（213）", Major: "通信工程", FitScore: 121, RiskScore: 60,
	}, {
		ID: "c", Band: "冲", School: "南京信息工程大学", MajorGroup: "（213）", Major: "自动化", FitScore: 121, RiskScore: 60,
	}}
	agg := aggregateRecommendationsByMajorGroup(GaokaoProfile{}, recs)
	if len(agg) != 1 {
		t.Fatalf("expected 1 aggregated card, got %d", len(agg))
	}
	if agg[0].Major != "专业组推荐" {
		t.Fatalf("expected group title major, got %s", agg[0].Major)
	}
	if len(agg[0].RecommendedMajorPool) != 3 || len(agg[0].GroupMajors) != 3 {
		t.Fatalf("expected 3 majors in pool/group, got pool=%#v group=%#v", agg[0].RecommendedMajorPool, agg[0].GroupMajors)
	}
}

func TestTierMajorPool(t *testing.T) {
	pool := tierGaokaoMajorPool(
		GaokaoProfile{PreferredMajors: []string{"计算机", "软件"}, RejectedMajors: []string{"土木"}},
		[]string{"计算机科学与技术", "软件工程", "电子信息工程", "材料科学与工程", "化学工程与工艺", "土木工程"},
	)
	if len(pool.Priority) != 2 || pool.Priority[0] != "计算机科学与技术" || pool.Priority[1] != "软件工程" {
		t.Fatalf("unexpected priority pool: %#v", pool.Priority)
	}
	if len(pool.Rejected) != 1 || pool.Rejected[0] != "土木工程" {
		t.Fatalf("unexpected rejected pool: %#v", pool.Rejected)
	}
	if len(pool.Cautious) != 2 {
		t.Fatalf("expected material/chemical as cautious, got %#v", pool.Cautious)
	}
	if len(pool.Acceptable) != 1 || pool.Acceptable[0] != "电子信息工程" {
		t.Fatalf("unexpected acceptable pool: %#v", pool.Acceptable)
	}
}

func TestGaokaoScoreRejectsFarReachAndWrongSubject(t *testing.T) {
	s := &GaokaoService{}
	goodSchool := models.GaokaoSchool{ID: 1, Name: "职业技术大学", Code: "voc", City: "广州", Province: "广东", Ownership: "公办"}
	eliteSchool := models.GaokaoSchool{ID: 2, Name: "顶尖大学", Code: "elite", City: "北京", Province: "北京", Ownership: "公办", Level: "985"}
	major := models.GaokaoMajor{ID: 1, Name: "计算机科学与技术", Code: "cs"}
	if _, ok := s.score(GaokaoProfile{Province: "广东", Rank: 250000, Subjects: "物理类"}, "elite", []models.GaokaoAdmissionRecord{{Year: 2025, SourceProvince: "广东", SubjectType: "物理类", School: eliteSchool, Major: major, MinRank: 10000, Tuition: 6000}}); ok {
		t.Fatalf("far reach elite option should be rejected")
	}
	if _, ok := s.score(GaokaoProfile{Province: "广东", Rank: 250000, Subjects: "物理类"}, "history", []models.GaokaoAdmissionRecord{{Year: 2025, SourceProvince: "广东", SubjectType: "历史类", School: goodSchool, Major: major, MinRank: 230000, Tuition: 6000}}); ok {
		t.Fatalf("wrong subject option should be rejected")
	}
	if _, ok := s.score(GaokaoProfile{Province: "广东", Rank: 250000, Subjects: "物理类"}, "voc", []models.GaokaoAdmissionRecord{{Year: 2025, SourceProvince: "广东", SubjectType: "物理类", School: goodSchool, Major: major, MinRank: 230000, Tuition: 6000}}); !ok {
		t.Fatalf("nearby vocational undergraduate option should be kept")
	}
}

func TestBuildGaokaoAdvisorResponse(t *testing.T) {
	recs := []GaokaoRecommendation{
		{ID: "1", Band: "冲", School: "冲刺大学", MajorGroup: "01", Major: "专业组推荐", FitScore: 90, RiskScore: 65},
		{ID: "2", Band: "稳", School: "稳妥大学", MajorGroup: "02", Major: "专业组推荐", FitScore: 88, RiskScore: 35},
		{ID: "3", Band: "保", School: "保底大学", MajorGroup: "03", Major: "专业组推荐", FitScore: 80, RiskScore: 20},
	}
	resp := BuildGaokaoAdvisorResponse(GaokaoProfile{Province: "广东", Rank: 320000, Subjects: "物理类", PreferredMajors: []string{"计算机"}}, "想读计算机，能上本科就行", recs)
	if resp.Intent.RiskStrategy == "" || len(resp.FinalPlans) < 2 {
		t.Fatalf("advisor response incomplete: %#v", resp)
	}
	if resp.ModelStatus == "called" {
		t.Fatalf("model must not be marked called without provider integration")
	}
	if len(resp.AgentAnalysis.Tradeoffs) == 0 || len(resp.AgentAnalysis.RiskFlags) == 0 {
		t.Fatalf("expected tradeoffs and risk flags: %#v", resp.AgentAnalysis)
	}
}

func TestGaokaoAdvisorModelConfigFromEnv(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "test-key")
	t.Setenv("DEEPSEEK_BASE_URL", "https://api.deepseek.example")
	t.Setenv("DEEPSEEK_MODEL", "deepseek-chat")
	cfg, ok := gaokaoAdvisorModelConfig("deepseek")
	if !ok || cfg.Provider != "deepseek" || cfg.APIKey != "test-key" || cfg.BaseURL != "https://api.deepseek.example" || cfg.Model != "deepseek-chat" {
		t.Fatalf("unexpected config: %#v ok=%v", cfg, ok)
	}
}

func TestGaokaoAdvisorModelPromptForbidsFabrication(t *testing.T) {
	prompt := buildGaokaoAdvisorModelPrompt(GaokaoProfile{Province: "广东", Rank: 320000, Subjects: "物理类"}, "能上本科就行", []GaokaoRecommendation{{School: "测试大学", MajorGroup: "01", Band: "冲", Ranks: []int{300000}}})
	if !strings.Contains(prompt, "不得编造") || !strings.Contains(prompt, "只基于候选数据") || !strings.Contains(prompt, "JSON") {
		t.Fatalf("prompt missing safety constraints: %s", prompt)
	}
}

func TestBuildGaokaoAdvisorLookupQueries(t *testing.T) {
	queries := BuildGaokaoAdvisorLookupQueries(GaokaoProfile{Province: "广东", Subjects: "物理类", Rank: 320000, PreferredMajors: []string{"计算机"}}, "能上本科就行")
	if len(queries) == 0 || len(queries) > 6 {
		t.Fatalf("expected bounded lookup queries, got %#v", queries)
	}
	joined := strings.Join(queries, " ")
	if !strings.Contains(joined, "广东") || !strings.Contains(joined, "物理类") || !strings.Contains(joined, "职业技术大学") {
		t.Fatalf("queries missing key intent: %#v", queries)
	}
}

func TestExtractGaokaoExternalCandidatesFromText(t *testing.T) {
	text := "2025广东物理类本科批投档线：广州科技职业技术大学204组最低分445分，最低位次318765；广东工商职业技术大学205组最低分442分，最低位次325001。"
	items := ExtractGaokaoExternalCandidatesFromText(GaokaoProfile{Province: "广东", Subjects: "物理类"}, text, "https://example.com/a", "测试来源", "third_party")
	if len(items) != 2 {
		t.Fatalf("expected 2 candidates, got %#v", items)
	}
	if items[0].School == "" || items[0].MinRank == 0 || items[0].SourceURL == "" || items[0].Confidence != "third_party" {
		t.Fatalf("candidate missing required fields: %#v", items[0])
	}
}

func TestEncodeGaokaoAdvisorSSEEvent(t *testing.T) {
	encoded := EncodeGaokaoAdvisorSSEEvent("source_hit", map[string]interface{}{"count": 3})
	if !strings.Contains(encoded, "event: source_hit\n") || !strings.Contains(encoded, "data:") || !strings.HasSuffix(encoded, "\n\n") {
		t.Fatalf("invalid sse event: %q", encoded)
	}
	if !strings.Contains(encoded, `"count":3`) {
		t.Fatalf("missing JSON payload: %q", encoded)
	}
}

func TestBuildGaokaoExternalCandidatePlanFiltersAndBands(t *testing.T) {
	profile := GaokaoProfile{Province: "湖南", Subjects: "物理类", Rank: 320000}
	items := []GaokaoAdvisorExternalCandidate{
		{School: "高不可攀大学", MinScore: 630, MinRank: 5000, SourceURL: "https://source/a", Status: "needs_review", Confidence: "uncertain"},
		{School: "长沙医学院", MajorGroup: "108组", MinScore: 202, MinRank: 305765, SourceURL: "https://source/b", Status: "needs_review", Confidence: "uncertain"},
		{School: "广州科技职业技术大学", MajorGroup: "506组", MinScore: 202, MinRank: 405286, SourceURL: "https://source/c", Status: "needs_review", Confidence: "uncertain"},
	}
	plan := BuildGaokaoExternalCandidatePlan(profile, items)
	if plan.UsableCount != 2 || plan.RejectedCount != 1 {
		t.Fatalf("unexpected counts: %#v", plan)
	}
	if plan.Items[0].School != "长沙医学院" || plan.Items[0].Band == "" || plan.Items[1].Band == "" {
		t.Fatalf("unexpected plan items: %#v", plan.Items)
	}
}

func TestExternalCandidatePlanSectionsByBatch(t *testing.T) {
	profile := GaokaoProfile{Province: "湖南", Subjects: "物理类", Rank: 320000}
	items := []GaokaoAdvisorExternalCandidate{
		{School: "本科大学", MinScore: 430, MinRank: 330000, SourceURL: "https://source/a", SourceTitle: "湖南本科批投档线", Status: "needs_review", Confidence: "official_or_education", Batch: "本科批"},
		{School: "专科大学", MinScore: 260, MinRank: 380000, SourceURL: "https://source/b", SourceTitle: "湖南专科批投档线", Status: "needs_review", Confidence: "official_or_education", Batch: "专科批"},
		{School: "补录本科大学", MinScore: 410, MinRank: 350000, SourceURL: "https://source/c", SourceTitle: "湖南本科征集志愿投档线", Status: "needs_review", Confidence: "third_party", Batch: "补录本科"},
		{School: "补录专科大学", MinScore: 220, MinRank: 420000, SourceURL: "https://source/d", SourceTitle: "湖南专科征集志愿投档线", Status: "needs_review", Confidence: "third_party", Batch: "补录专科"},
	}
	plan := BuildGaokaoExternalCandidatePlan(profile, items)
	if len(plan.Sections) != 4 {
		t.Fatalf("expected 4 sections, got %#v", plan.Sections)
	}
	if plan.Sections[0].Key != "本科批次" || plan.Sections[1].Key != "专科批次" || plan.Sections[2].Key != "补录本科" || plan.Sections[3].Key != "补录专科" {
		t.Fatalf("unexpected section order: %#v", plan.Sections)
	}
}

func TestExternalCandidatePlanPrefersOfficialAndFlagsConflicts(t *testing.T) {
	profile := GaokaoProfile{Province: "湖南", Subjects: "物理类", Rank: 320000}
	items := []GaokaoAdvisorExternalCandidate{
		{School: "官方大学", MajorGroup: "101组", MinScore: 430, MinRank: 330000, SourceURL: "https://third/a", SourceTitle: "第三方", Status: "needs_review", Confidence: "third_party", Batch: "本科批"},
		{School: "官方大学", MajorGroup: "101组", MinScore: 428, MinRank: 335000, SourceURL: "https://jyt.hunan.gov.cn/a", SourceTitle: "湖南教育考试院", Status: "needs_review", Confidence: "official_or_education", Batch: "本科批"},
		{School: "冲突大学", MajorGroup: "102组", MinScore: 410, MinRank: 330000, SourceURL: "https://third/b", SourceTitle: "第三方1", Status: "needs_review", Confidence: "third_party", Batch: "本科批"},
		{School: "冲突大学", MajorGroup: "102组", MinScore: 390, MinRank: 380000, SourceURL: "https://third/c", SourceTitle: "第三方2", Status: "needs_review", Confidence: "third_party", Batch: "本科批"},
	}
	plan := BuildGaokaoExternalCandidatePlan(profile, items)
	if len(plan.Items) != 1 || plan.Items[0].School != "官方大学" || plan.Items[0].MinRank != 335000 {
		t.Fatalf("expected official item only, got %#v", plan.Items)
	}
	if len(plan.Conflicts) != 1 || plan.Conflicts[0].School != "冲突大学" {
		t.Fatalf("expected third-party conflict, got %#v", plan.Conflicts)
	}
}

func TestMergeGaokaoAdvisorModelReports(t *testing.T) {
	reports := []GaokaoAdvisorModelReport{
		{Provider: "deepseek", Role: "ranking", Status: "called", Analysis: GaokaoAdvisorAnalysis{Summary: "A", Tradeoffs: []string{"专业要放宽"}, RiskFlags: []string{"滑档风险"}}},
		{Provider: "kimi", Role: "extraction", Status: "error", Error: "not configured"},
		{Provider: "gpt", Role: "final", Status: "called", Analysis: GaokaoAdvisorAnalysis{Summary: "B", Tradeoffs: []string{"学费要确认"}, RiskFlags: []string{"来源待复核"}}},
	}
	merged := MergeGaokaoAdvisorModelReports(reports, GaokaoAdvisorAnalysis{})
	if !strings.Contains(merged.Summary, "deepseek") || !strings.Contains(merged.Summary, "gpt") {
		t.Fatalf("summary should mention successful providers: %#v", merged.Summary)
	}
	if len(merged.Tradeoffs) < 2 || len(merged.RiskFlags) < 2 {
		t.Fatalf("expected merged tradeoffs/risks: %#v", merged)
	}
}

func TestGaokaoAdvisorOpenAIUsesOfficialFallback(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "proxy-key")
	t.Setenv("OPENAI_BASE_URL", "http://cli-proxy-api:8317")
	t.Setenv("OPENAI_OFFICIAL_API_KEY", "official-key")
	cfg, ok := gaokaoAdvisorModelConfig("openai")
	if !ok || cfg.APIKey != "official-key" || cfg.BaseURL != "https://api.openai.com/v1" {
		t.Fatalf("expected official fallback, got %#v ok=%v", cfg, ok)
	}
}

func TestBuildGaokaoAdvisorEvidenceLinks(t *testing.T) {
	hits := []GaokaoAdvisorExternalSourceHit{
		{Title: "第三方分数线", URL: "https://www.gk100.com/read_x.htm", SourceType: "third_party_gaokao", Status: "found"},
		{Title: "湖南省2025年普通高校招生本科批第一次投档分数线", URL: "https://jyt.hunan.gov.cn/jyt/sjyt/hnsjyksy/web/ksyzkzx/x.html", SourceType: "web", Status: "found"},
		{Title: "某大学本科招生网招生计划", URL: "https://zsb.example.edu.cn/plan", SourceType: "web", Status: "found"},
	}
	links := BuildGaokaoAdvisorEvidenceLinks(hits)
	if len(links) != 3 {
		t.Fatalf("expected 3 links, got %#v", links)
	}
	if links[0].Kind != "exam_authority" || links[0].Rank != 0 {
		t.Fatalf("expected exam authority first, got %#v", links)
	}
	if links[1].Kind != "school_admission" {
		t.Fatalf("expected school admission second, got %#v", links)
	}
}

func TestBuildGaokaoAdvisorPlanSections(t *testing.T) {
	profile := GaokaoProfile{Province: "湖南", Subjects: "物理类", Rank: 320000, PreferredMajors: []string{"计算机"}, TuitionLimit: 25000}
	externalPlan := GaokaoExternalCandidatePlan{Sections: []GaokaoExternalCandidatePlanSection{
		{Key: "本科批次", Items: []GaokaoExternalCandidatePlanItem{{Band: "稳", School: "长沙医学院", MajorGroup: "108组", MinRank: 305765}}},
		{Key: "补录本科", Items: []GaokaoExternalCandidatePlanItem{}},
		{Key: "专科批次", Items: []GaokaoExternalCandidatePlanItem{}},
	}}
	links := []GaokaoAdvisorEvidenceLink{{Title: "湖南考试院", URL: "https://jyt.hunan.gov.cn/x", Kind: "exam_authority", Rank: 0}}
	sections := BuildGaokaoAdvisorPlanSections(profile, externalPlan, links)
	if len(sections) < 4 {
		t.Fatalf("expected multiple product sections, got %#v", sections)
	}
	if sections[0].Key != "undergraduate_priority" || sections[0].Title == "" || len(sections[0].EvidenceLinks) == 0 {
		t.Fatalf("unexpected first section: %#v", sections[0])
	}
}

func TestGaokaoTrackFilterKeepsOnlyRequestedTrack(t *testing.T) {
	recs := []GaokaoRecommendation{
		{School: "本科大学", Level: "本科", Band: "稳"},
		{School: "专科大学", Level: "专科", Band: "保"},
	}
	undergrad := FilterGaokaoRecommendationsByTrack(recs, "本科")
	if len(undergrad) != 1 || undergrad[0].School != "本科大学" {
		t.Fatalf("本科专项应只保留本科: %#v", undergrad)
	}
	college := FilterGaokaoRecommendationsByTrack(recs, "专科")
	if len(college) != 1 || college[0].School != "专科大学" {
		t.Fatalf("专科专项应只保留专科: %#v", college)
	}
}

func TestGaokaoRankBandPolicyAllowsEliteReachForTopRanks(t *testing.T) {
	if bandGaokaoRankWindow(300, 100) != "冲" {
		t.Fatalf("河南300名这类顶尖位次应允许清北级别梦想冲刺")
	}
	if bandGaokaoRankWindow(40000, 10000) != "" {
		t.Fatalf("普通4w名不应乱冲1w名")
	}
}

func TestGaokaoRankBandPolicy(t *testing.T) {
	if bandGaokaoRankWindow(40000, 30000) != "冲" || bandGaokaoRankWindow(40000, 35000) != "冲" {
		t.Fatalf("4w名应允许冲3w/3.5w")
	}
	if bandGaokaoRankWindow(40000, 41000) != "稳" {
		t.Fatalf("4w附近应是稳")
	}
	if bandGaokaoRankWindow(40000, 52000) != "保" || bandGaokaoRankWindow(40000, 65000) != "垫" {
		t.Fatalf("4w向后4-6w应是保/垫")
	}
	if bandGaokaoRankWindow(40000, 10000) != "" {
		t.Fatalf("过远冲刺不应推荐")
	}
}

func TestFilterGaokaoRecommendationsByTrack(t *testing.T) {
	recs := []GaokaoRecommendation{
		{School: "本科大学", Level: "本科", Major: "计算机科学与技术"},
		{School: "职业技术学院", Level: "专科", Major: "软件技术"},
		{School: "职业技术大学", Level: "本科", Major: "软件工程"},
	}
	undergraduate := FilterGaokaoRecommendationsByTrack(recs, "本科")
	if len(undergraduate) != 2 || undergraduate[0].School != "本科大学" || undergraduate[1].School != "职业技术大学" {
		t.Fatalf("unexpected undergraduate filter: %#v", undergraduate)
	}
	college := FilterGaokaoRecommendationsByTrack(recs, "专科")
	if len(college) != 1 || college[0].School != "职业技术学院" {
		t.Fatalf("unexpected college filter: %#v", college)
	}
}

func TestBuildGaokaoProfessionalReport(t *testing.T) {
	profile := GaokaoProfile{Province: "安徽", Subjects: "物理类", Score: 583, Rank: 40983, PreferredMajors: []string{"自动化", "电子信息工程", "集成电路", "车辆工程"}, Strategy: "major"}
	recs := []GaokaoRecommendation{
		{Band: "冲", School: "杭州电子科技大学", City: "杭州", Level: "本科", DualClass: "", Major: "电子信息工程", RecommendedMajorPool: []string{"电子信息工程", "自动化"}, Ranks: []int{38000}, FitScore: 120},
		{Band: "稳", School: "天津理工大学", City: "天津", Level: "本科", Major: "自动化", RecommendedMajorPool: []string{"自动化"}, Ranks: []int{41000}, FitScore: 130},
		{Band: "保", School: "安徽工业大学", City: "马鞍山", Level: "本科", Major: "自动化", RecommendedMajorPool: []string{"自动化", "车辆工程"}, Ranks: []int{56000}, FitScore: 110},
	}
	links := []GaokaoAdvisorEvidenceLink{{Title: "安徽考试院", URL: "https://jyt.ah.gov.cn/x", Kind: "exam_authority", Rank: 0}}
	report := BuildGaokaoProfessionalReport(profile, recs, links)
	if report.ProfileSummary == "" || report.Disclaimer == "" || len(report.Bands["冲"]) == 0 || len(report.Bands["稳"]) == 0 || len(report.Bands["保"]) == 0 || len(report.TopRecommendations) == 0 {
		t.Fatalf("bad report: %#v", report)
	}
	if !strings.Contains(report.Disclaimer, "经验估计") {
		t.Fatalf("disclaimer must mark probability as estimate: %s", report.Disclaimer)
	}
}

func TestProfessionalReportAddsStrongMajorSchools(t *testing.T) {
	profile := GaokaoProfile{Province: "安徽", Subjects: "物理类", Score: 583, Rank: 40983, PreferredMajors: []string{"自动化", "电子信息工程", "集成电路", "车辆工程"}, Strategy: "major"}
	report := BuildGaokaoProfessionalReport(profile, nil, nil)
	found := false
	for _, item := range report.TopRecommendations {
		if item.School == "桂林电子科技大学" || item.School == "长春理工大学" || item.School == "天津理工大学" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected strong major schools in top recommendations: %#v", report.TopRecommendations)
	}
}

func TestProfessionalReportRationaleAndStrengthTags(t *testing.T) {
	profile := GaokaoProfile{Province: "安徽", Subjects: "物理类", Score: 583, Rank: 40983, PreferredMajors: []string{"自动化", "电子信息工程", "集成电路", "车辆工程"}, Strategy: "major"}
	report := BuildGaokaoProfessionalReport(profile, nil, nil)
	for _, item := range report.TopRecommendations {
		if item.School == "桂林电子科技大学" {
			if item.WhyRecommend == "" || len(item.StrengthTags) == 0 {
				t.Fatalf("桂电 should include rationale/tags: %#v", item)
			}
			return
		}
	}
	t.Fatalf("expected 桂林电子科技大学 in top recommendations: %#v", report.TopRecommendations)
}

func TestProfessionalReportFinalShape(t *testing.T) {
	profile := GaokaoProfile{Province: "安徽", Subjects: "物理类", Score: 583, Rank: 40983, PreferredMajors: []string{"自动化", "电子信息工程", "集成电路", "车辆工程"}, Strategy: "major"}
	report := BuildGaokaoProfessionalReport(profile, nil, nil)
	if len(report.SchoolOverviews) == 0 || len(report.MajorRanking) == 0 || len(report.FinalSuggestion.Chong) == 0 || len(report.FinalSuggestion.Core) == 0 || len(report.FinalSuggestion.Safe) == 0 {
		t.Fatalf("report missing final shape sections: %#v", report)
	}
}

func TestExternalCandidatePlanToModelRecommendationsFeedsCommittee(t *testing.T) {
	profile := GaokaoProfile{Province: "安徽", Rank: 40983, Subjects: "物理 / 化学", PreferredMajors: []string{"自动化", "电子信息工程"}}
	plan := GaokaoExternalCandidatePlan{Items: []GaokaoExternalCandidatePlanItem{
		{Band: "稳", School: "天津理工大学", MajorGroup: "物理组", MinRank: 41000, MinScore: 583, SourceTitle: "安徽本科批投档线", SourceURL: "https://example.com/tjlit"},
		{Band: "保", School: "沈阳工业大学", MajorGroup: "物理组", MinRank: 47000, MinScore: 575, SourceTitle: "安徽本科批投档线", SourceURL: "https://example.com/syut"},
	}}
	recs := ExternalCandidatePlanToGaokaoRecommendations(profile, plan)
	if len(recs) != 2 {
		t.Fatalf("expected external candidates converted for model, got %d", len(recs))
	}
	if recs[0].School != "天津理工大学" || recs[0].Major == "" || len(recs[0].Ranks) == 0 || recs[0].Source == "" {
		t.Fatalf("bad converted rec: %#v", recs[0])
	}
}

func TestProfessionalSeedRecommendationsFeedModel(t *testing.T) {
	profile := GaokaoProfile{Province: "安徽", Rank: 40983, Subjects: "物理 / 化学", PreferredMajors: []string{"自动化", "电子信息工程", "集成电路", "微电子", "车辆工程"}}
	recs := BuildGaokaoProfessionalSeedRecommendations(profile)
	if len(recs) < 8 {
		t.Fatalf("expected strong major seed candidates, got %d", len(recs))
	}
	found := false
	for _, rec := range recs {
		if rec.School == "桂林电子科技大学" && rec.Major != "" && len(rec.Ranks) > 0 && rec.Source != "" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected 桂林电子科技大学 with major/rank/source in %#v", recs)
	}
}

func TestInvalidNarrativeSchoolNameFiltered(t *testing.T) {
	if validGaokaoAdvisorSchoolName("排名前五的民办本科大学") {
		t.Fatalf("narrative pseudo-school name should be rejected")
	}
}

func TestBuildGaokaoFinalReportMarkdownHidesProducerTerms(t *testing.T) {
	profile := GaokaoProfile{Province: "安徽", Subjects: "物理 / 化学", Score: 583, Rank: 40983, PreferredMajors: []string{"自动化", "电子信息工程", "集成电路"}, Strategy: "major"}
	recs := BuildGaokaoProfessionalSeedRecommendations(profile)
	report := BuildGaokaoProfessionalReport(profile, recs, nil)
	markdown := BuildGaokaoFinalReportMarkdown(profile, "", report, nil)
	if markdown == "" || !strings.Contains(markdown, "志愿规划报告") || !strings.Contains(markdown, "考生画像") || !strings.Contains(markdown, "最终建议") {
		t.Fatalf("final markdown missing report sections: %q", markdown)
	}
	for _, bad := range []string{"deepseek", "openai", "多模型", "model", "provider"} {
		if strings.Contains(strings.ToLower(markdown), bad) {
			t.Fatalf("final markdown leaks producer term %q: %s", bad, markdown)
		}
	}
}
