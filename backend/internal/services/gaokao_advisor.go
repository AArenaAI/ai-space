package services

import "fmt"

type GaokaoAdvisorIntent struct {
	Province        string   `json:"province"`
	Subjects        string   `json:"subjects"`
	Rank            int      `json:"rank"`
	PreferredMajors []string `json:"preferred_majors"`
	RiskStrategy    string   `json:"risk_strategy"`
	FallbackPolicy  []string `json:"fallback_policy"`
}

type GaokaoAdvisorAnalysis struct {
	Summary   string   `json:"summary"`
	Tradeoffs []string `json:"tradeoffs"`
	RiskFlags []string `json:"risk_flags"`
	Questions []string `json:"questions"`
}

type GaokaoAdvisorPlan struct {
	Name  string                 `json:"name"`
	Why   string                 `json:"why"`
	Items []GaokaoRecommendation `json:"items"`
}

type GaokaoAdvisorResponse struct {
	Intent                GaokaoAdvisorIntent              `json:"intent"`
	LocalRecommendations  []GaokaoRecommendation           `json:"local_recommendations"`
	AgentAnalysis         GaokaoAdvisorAnalysis            `json:"agent_analysis"`
	FinalPlans            []GaokaoAdvisorPlan              `json:"final_plans"`
	NeedsWebLookup        bool                             `json:"needs_web_lookup"`
	WebLookupPlan         []string                         `json:"web_lookup_plan"`
	ExternalSourceHits    []GaokaoAdvisorExternalSourceHit `json:"external_source_hits"`
	EvidenceLinks         []GaokaoAdvisorEvidenceLink      `json:"evidence_links"`
	ExternalCandidates    []GaokaoAdvisorExternalCandidate `json:"external_candidates"`
	ExternalCandidatePlan GaokaoExternalCandidatePlan      `json:"external_candidate_plan"`
	AdvisorPlanSections   []GaokaoAdvisorPlanSection       `json:"advisor_plan_sections"`
	ProfessionalReport    GaokaoProfessionalReport         `json:"professional_report"`
	ModelReports          []GaokaoAdvisorModelReport       `json:"model_reports"`
	ModelStatus           string                           `json:"model_status"`
	ModelNote             string                           `json:"model_note"`
}

func BuildGaokaoAdvisorResponse(profile GaokaoProfile, message string, recommendations []GaokaoRecommendation) GaokaoAdvisorResponse {
	intent := GaokaoAdvisorIntent{
		Province: profile.Province, Subjects: profile.Subjects, Rank: profile.Rank,
		PreferredMajors: profile.PreferredMajors,
		RiskStrategy:    advisorRiskStrategy(profile, message),
		FallbackPolicy:  advisorFallbackPolicy(profile, message),
	}
	analysis := buildGaokaoAdvisorAnalysis(profile, message, recommendations)
	plans := buildGaokaoAdvisorPlans(recommendations)
	needsLookup := len(recommendations) < 60 || countGaokaoBand(recommendations, "保")+countGaokaoBand(recommendations, "垫") < 20
	lookupPlan := []string{}
	if needsLookup {
		lookupPlan = []string{
			fmt.Sprintf("补查%s%s本科批最低位次接近%d的院校专业组/专业+院校", profile.Province, profile.Subjects, profile.Rank),
			fmt.Sprintf("补查%s本科线边缘民办本科、职业技术大学、低热度外省本科", profile.Province),
			"只接受省考试院、高校招生网、阳光高考或可追溯可信来源；无来源不得进入正式方案。",
		}
	}
	return GaokaoAdvisorResponse{
		Intent:               intent,
		LocalRecommendations: recommendations,
		AgentAnalysis:        analysis,
		FinalPlans:           plans,
		NeedsWebLookup:       needsLookup,
		WebLookupPlan:        lookupPlan,
		ModelStatus:          "not_configured",
		ModelNote:            "当前 advisor 已执行规则化 Agent 分析；尚未接入后端统一 GPT/DeepSeek/Kimi/Gemini provider，因此不会伪装模型已调用。",
	}
}

func advisorRiskStrategy(profile GaokaoProfile, message string) string {
	if containsFold(message, "稳") || containsFold(message, "保") || containsFold(message, "本科就行") || profile.Strategy == "safe" {
		return "稳妥本科优先"
	}
	if containsFold(message, "冲") || profile.Strategy == "aggressive" {
		return "冲刺优先"
	}
	if profile.Strategy == "major" || len(profile.PreferredMajors) > 0 {
		return "专业优先"
	}
	return "均衡推荐"
}

func advisorFallbackPolicy(profile GaokaoProfile, message string) []string {
	policies := []string{"优先本科批", "不编造无来源录取线"}
	if profile.Rank > 180000 || containsFold(message, "本科就行") || containsFold(message, "刚过") {
		policies = append(policies, "允许职业技术大学", "允许民办本科", "允许外省低热度本科", "必要时放宽专业")
	}
	return policies
}

func buildGaokaoAdvisorAnalysis(profile GaokaoProfile, message string, recs []GaokaoRecommendation) GaokaoAdvisorAnalysis {
	analysis := GaokaoAdvisorAnalysis{Tradeoffs: []string{}, RiskFlags: []string{}, Questions: []string{}}
	analysis.Summary = fmt.Sprintf("已基于%s%s、位次约%d生成本地数据推荐，并由 Agent 按偏好/风险进行方案化整理。", profile.Province, profile.Subjects, profile.Rank)
	if profile.Rank > 180000 {
		analysis.Tradeoffs = append(analysis.Tradeoffs, "当前位次接近本科批边缘时，公办/热门专业/核心城市三者通常难以同时满足。")
		analysis.RiskFlags = append(analysis.RiskFlags, "需要重点增加民办本科、职业技术大学、外省低热度本科作为保底。")
	}
	if len(profile.PreferredMajors) > 0 {
		analysis.Tradeoffs = append(analysis.Tradeoffs, "坚持热门专业会降低学校层级和地域选择空间。")
	}
	if len(recs) < 60 {
		analysis.RiskFlags = append(analysis.RiskFlags, "本地库候选不足，需联网补查官方/高校来源后再形成最终兜底。")
	}
	analysis.Questions = append(analysis.Questions, "是否接受民办本科或职业技术大学作为本科兜底？", "是否愿意为保本科而放宽专业或城市？")
	return analysis
}

func buildGaokaoAdvisorPlans(recs []GaokaoRecommendation) []GaokaoAdvisorPlan {
	plans := []GaokaoAdvisorPlan{
		{Name: "稳妥本科方案", Why: "优先保证本科录取概率，控制过远冲刺。", Items: pickAdvisorItems(recs, []string{"稳", "保", "垫"}, 24)},
		{Name: "专业优先方案", Why: "优先保留与用户专业偏好匹配的专业组/专业。", Items: pickAdvisorItems(recs, []string{"冲", "稳", "保"}, 24)},
		{Name: "最大保录方案", Why: "增加保底和垫底比例，适合刚过本科线或风险厌恶用户。", Items: pickAdvisorItems(recs, []string{"保", "垫", "稳"}, 24)},
	}
	return plans
}

func pickAdvisorItems(recs []GaokaoRecommendation, bands []string, limit int) []GaokaoRecommendation {
	out := []GaokaoRecommendation{}
	seen := map[string]bool{}
	for _, band := range bands {
		for _, rec := range recs {
			if len(out) >= limit {
				return out
			}
			key := rec.School + "::" + rec.MajorGroup
			if rec.Band == band && !seen[key] {
				seen[key] = true
				out = append(out, rec)
			}
		}
	}
	if len(out) == 0 {
		for _, rec := range recs {
			if len(out) >= limit {
				break
			}
			key := rec.School + "::" + rec.MajorGroup
			if !seen[key] {
				seen[key] = true
				out = append(out, rec)
			}
		}
	}
	return out
}
