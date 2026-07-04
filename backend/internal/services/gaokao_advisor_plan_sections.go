package services

import "fmt"

type GaokaoAdvisorPlanSection struct {
	Key           string                            `json:"key"`
	Title         string                            `json:"title"`
	Goal          string                            `json:"goal"`
	Strategy      string                            `json:"strategy"`
	Risk          string                            `json:"risk"`
	NextAction    string                            `json:"next_action"`
	Items         []GaokaoExternalCandidatePlanItem `json:"items"`
	EvidenceLinks []GaokaoAdvisorEvidenceLink       `json:"evidence_links"`
}

func BuildGaokaoAdvisorPlanSections(profile GaokaoProfile, externalPlan GaokaoExternalCandidatePlan, links []GaokaoAdvisorEvidenceLink) []GaokaoAdvisorPlanSection {
	return BuildGaokaoAdvisorPlanSectionsForTrack(profile, externalPlan, links, "")
}

func BuildGaokaoAdvisorPlanSectionsForTrack(profile GaokaoProfile, externalPlan GaokaoExternalCandidatePlan, links []GaokaoAdvisorEvidenceLink, track string) []GaokaoAdvisorPlanSection {
	by := map[string][]GaokaoExternalCandidatePlanItem{}
	for _, section := range externalPlan.Sections {
		by[section.Key] = section.Items
	}
	topLinks := links
	if len(topLinks) > 5 {
		topLinks = topLinks[:5]
	}
	majorText := "目标专业"
	if len(profile.PreferredMajors) > 0 {
		majorText = profile.PreferredMajors[0]
	}
	undergraduate := []GaokaoAdvisorPlanSection{
		{Key: "undergraduate_priority", Title: "本科批次优先方案", Goal: "优先确认常规本科批是否有接近当前位次的机会。", Strategy: fmt.Sprintf("以%s%s位次%d为基准，先看本科批次接近线索，再结合来源链接人工核验。", profile.Province, profile.Subjects, profile.Rank), Risk: "待复核候选不能直接当正式填报依据；需点开考试院/招生网链接确认批次、科类、专业组。", NextAction: "优先打开考试院链接，核对本科批普通类投档线。", Items: by["本科批次"], EvidenceLinks: topLinks},
		{Key: "major_priority", Title: majorText + "专业优先方案", Goal: "在能上本科的前提下尽量贴近专业偏好。", Strategy: "若本科批次候选不足，优先放宽城市/学校类型，再考虑相近专业大类。", Risk: "低位次段强行锁定热门专业容易滑档；需检查组内专业和调剂风险。", NextAction: "查看招生计划网或学校招生网，确认专业组内是否含不接受专业。", Items: by["本科批次"], EvidenceLinks: topLinks},
		{Key: "supplement_undergraduate", Title: "补录本科预案", Goal: "为常规本科批不足时准备征集/补录路径。", Strategy: "单独关注补录本科，不与常规本科批混排。", Risk: "补录名额和专业波动大，只能作为预案，不能替代常规批填报。", NextAction: "关注省考试院征集志愿公告时间和补录计划。", Items: by["补录本科"], EvidenceLinks: topLinks},
		{Key: "low_tuition", Title: "低学费本科方案", Goal: "控制学费，优先排查公办/低收费本科项目。", Strategy: fmt.Sprintf("当前学费上限约%d；民办本科需重点核对收费。", profile.TuitionLimit), Risk: "低位次段低学费本科机会通常更少，可能需要放宽地区或专业。", NextAction: "打开学校招生章程/招生计划链接核对学费。", Items: by["本科批次"], EvidenceLinks: topLinks},
	}
	college := []GaokaoAdvisorPlanSection{
		{Key: "college_priority", Title: "专科批次优先方案", Goal: "独立确认专科批次中最稳妥、最匹配的兜底机会。", Strategy: fmt.Sprintf("以%s%s位次%d为基准，只看专科批/高职高专线索，不与本科方案混排。", profile.Province, profile.Subjects, profile.Rank), Risk: "专科方案不能替代本科志愿；需确认用户已接受专科路径。", NextAction: "打开专科批招生计划或学校招生网，核对批次、专业和学费。", Items: by["专科批次"], EvidenceLinks: topLinks},
		{Key: "college_major_priority", Title: majorText + "专科专业优先方案", Goal: "在专科批次中优先保留贴近专业偏好的学校/专业。", Strategy: "优先看专业确定性、就业方向和学费，再看学校城市。", Risk: "热门专科专业也可能位次偏高，需要保留足够保底。", NextAction: "核对学校招生计划里的具体专业名称、校区和收费。", Items: by["专科批次"], EvidenceLinks: topLinks},
		{Key: "supplement_college", Title: "补录专科预案", Goal: "为专科批次不足时准备征集/补录路径。", Strategy: "单独关注补录专科，等考试院公布征集计划后再启用。", Risk: "补录名额和专业随机性强，只作预案。", NextAction: "关注省考试院征集志愿公告。", Items: by["补录专科"], EvidenceLinks: topLinks},
	}
	switch track {
	case "专科", "college":
		return college
	case "本科", "undergraduate":
		return undergraduate
	default:
		return append(undergraduate, college...)
	}
}
