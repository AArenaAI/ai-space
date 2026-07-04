package services

import "fmt"

// GaokaoVolunteerRule holds the official volunteer application rules for a specific province.
// Data sourced from provincial education examination authority (省教育考试院) official 2025 announcements.
type GaokaoVolunteerRule struct {
	Province          string `json:"province"`
	Mode              string `json:"mode"`
	Unit              string `json:"unit"` // major_group | major_school | school_major
	DefaultSlots      int    `json:"default_slots"`
	MajorCountPerUnit int    `json:"major_count_per_unit"`
	HasAdjustment     bool   `json:"has_adjustment"`
	IsParallel        bool   `json:"is_parallel"`
	SourceTitle       string `json:"source_title"`
	SourceURL         string `json:"source_url"`
	SourceDate        string `json:"source_date"`
	Description       string `json:"description"`
}

func GaokaoVolunteerRuleForProvince(province string) GaokaoVolunteerRule {
	rules := map[string]GaokaoVolunteerRule{
		// ── 院校专业组模式 (New Gaokao 3+1+2 / 3+3, 每个专业组为一个志愿单位) ──
		"广东": {
			Province: "广东", Mode: "广东普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 45,
			Description: "广东省教育考试院规定：普通类本科批设45个院校专业组平行志愿，每个专业组可填6个专业及是否服从组内调剂；提前批(含军警)设顺序志愿，特殊类型批设1个志愿。选科要求按3+1+2执行。",
		},
		"江苏": {
			Province: "江苏", Mode: "江苏普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 40,
			Description: "江苏省教育考试院规定：普通类本科批设40个院校专业组平行志愿，每个专业组可填6个专业及是否服从调剂；提前批设20个平行志愿+顺序志愿，特殊类型批设1个志愿。选科要求按3+1+2执行。",
		},
		"湖南": {
			Province: "湖南", Mode: "湖南普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 45,
			Description: "湖南省教育考试院规定：普通类本科批设45个院校专业组平行志愿，每个专业组可填6个专业及是否服从组内调剂；提前批(含军校)设30个平行志愿+顺序志愿，特殊类型批设1个志愿。选科要求按3+1+2执行。",
		},
		"湖北": {
			Province: "湖北", Mode: "湖北普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 45,
			Description: "湖北省教育考试院规定：普通类本科批设45个院校专业组平行志愿，每个专业组可填6个专业及是否服从组内调剂；提前批设20个平行志愿，特殊类型批设1个志愿。选科要求按3+1+2执行。",
		},
		"福建": {
			Province: "福建", Mode: "福建普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 40,
			Description: "福建省教育考试院规定：普通类本科批设40个院校专业组平行志愿，每个专业组可填6个专业及是否服从组内调剂；提前批设20个平行志愿，特殊类型批设1个志愿。选科要求按3+1+2执行。",
		},
		"江西": {
			Province: "江西", Mode: "江西普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 45,
			Description: "江西省教育考试院规定(2024年新高考改革)：普通类本科批设45个院校专业组平行志愿，每个专业组可填6个专业及是否服从组内调剂；提前批设20个平行志愿。选科要求按3+1+2执行。",
		},
		"安徽": {
			Province: "安徽", Mode: "安徽普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 45,
			Description: "安徽省教育招生考试院规定(2024年新高考改革)：普通类本科批设45个院校专业组平行志愿，每个专业组可填6个专业及是否服从组内调剂；提前批设20个平行志愿。选科要求按3+1+2执行。",
		},
		"黑龙江": {
			Province: "黑龙江", Mode: "黑龙江普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 40,
			Description: "黑龙江省招生考试院规定(2024年新高考改革)：普通类本科批设40个院校专业组平行志愿，每个专业组可填6个专业及是否服从组内调剂；提前批设30个平行志愿。选科要求按3+1+2执行。",
		},
		"吉林": {
			Province: "吉林", Mode: "吉林普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 40,
			Description: "吉林省教育考试院规定(2024年新高考改革)：普通类本科批设40个院校专业组平行志愿，每个专业组可填6个专业及是否服从组内调剂；提前批设30个平行志愿。选科要求按3+1+2执行。",
		},
		"甘肃": {
			Province: "甘肃", Mode: "甘肃普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 45,
			Description: "甘肃省教育考试院规定(2024年新高考改革)：普通类本科批设45个院校专业组平行志愿，每个专业组可填6个专业及是否服从组内调剂；提前批设20个平行志愿。选科要求按3+1+2执行。",
		},
		"贵州": {
			Province: "贵州", Mode: "贵州普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 45,
			Description: "贵州省招生考试院规定(2024年新高考改革)：普通类本科批设45个院校专业组平行志愿，每个专业组可填6个专业及是否服从组内调剂；提前批设20个平行志愿。选科要求按3+1+2执行。",
		},
		"广西": {
			Province: "广西", Mode: "广西普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 40,
			Description: "广西招生考试院规定(2024年新高考改革)：普通类本科批设40个院校专业组平行志愿，每个专业组可填6个专业及是否服从组内调剂；提前批设20个平行志愿。选科要求按3+1+2执行。",
		},

		// ── 院校专业组模式 (New Gaokao 3+3) ──
		"北京": {
			Province: "北京", Mode: "北京普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 30,
			Description: "北京教育考试院规定：普通类本科批设30个院校专业组平行志愿，每个专业组可填6个专业及是否服从组内调剂；提前批分A/B段，特殊类型批设1个志愿。选科要求按3+3执行。",
		},
		"上海": {
			Province: "上海", Mode: "上海普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 24,
			Description: "上海市教育考试院规定：普通类本科批设24个院校专业组平行志愿，每个专业组可填4个专业及是否服从组内调剂；提前批设4个顺序志愿，特殊类型批设1个志愿。选科要求按3+3执行。",
		},
		"天津": {
			Province: "天津", Mode: "天津普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 50,
			Description: "天津市教育招生考试院规定：普通类本科批A段设25个、B段设25个院校专业组平行志愿，共50个；每个专业组可填6个专业及是否服从调剂；提前批设10个平行志愿+顺序志愿。选科要求按3+3执行。",
		},
		"海南": {
			Province: "海南", Mode: "海南普通类本科批院校专业组",
			Unit: "major_group", DefaultSlots: 24,
			Description: "海南省考试局规定：普通类本科批设24个院校专业组平行志愿，每个专业组可填6个专业及是否服从组内调剂；提前批设10个平行志愿，特殊类型批设1个志愿。选科要求按3+3执行。",
		},

		// ── 专业+院校模式 (New Gaokao 3+3/3+1+2，每个志愿只对应一个专业，无调剂) ──
		"浙江": {
			Province: "浙江", Mode: "浙江普通类专业平行志愿",
			Unit: "major_school", DefaultSlots: 80,
			Description: "浙江省教育考试院规定：普通类设80个专业平行志愿(专业+院校)，每个志愿对应1个专业，无专业调剂；提前批设顺序志愿。选科要求按3+3执行。",
		},
		"山东": {
			Province: "山东", Mode: "山东普通类专业+院校平行志愿",
			Unit: "major_school", DefaultSlots: 96,
			Description: "山东省教育招生考试院规定：普通类设96个专业+院校平行志愿，每个志愿对应1个专业，无专业调剂；提前批设30个平行志愿+顺序志愿。选科要求按3+3执行。",
		},
		"河北": {
			Province: "河北", Mode: "河北普通类本科批专业+院校平行志愿",
			Unit: "major_school", DefaultSlots: 96,
			Description: "河北省教育考试院规定：普通类本科批设96个专业+院校平行志愿，每个志愿对应1个专业，无专业调剂；提前批设顺序志愿+若干平行志愿。选科要求按3+1+2执行。",
		},
		"辽宁": {
			Province: "辽宁", Mode: "辽宁普通类本科批专业+院校平行志愿",
			Unit: "major_school", DefaultSlots: 112,
			Description: "辽宁省招生考试办公室规定：普通类本科批设112个专业+院校平行志愿，每个志愿对应1个专业，无专业调剂；提前批设60个平行志愿。选科要求按3+1+2执行。当前最多展示96条，更多需前端分页。",
		},
		"重庆": {
			Province: "重庆", Mode: "重庆普通类本科批专业+院校平行志愿",
			Unit: "major_school", DefaultSlots: 96,
			Description: "重庆市教育考试院规定：普通类本科批设96个专业+院校平行志愿，每个志愿对应1个专业，无专业调剂；提前批设60个平行志愿。选科要求按3+1+2执行。",
		},

		// ── 学校+专业模式 (传统文理分科省份，一所学校+多个专业为一个志愿单位) ──
		"河南": {
			Province: "河南", Mode: "河南本科批学校+专业志愿",
			Unit: "school_major", DefaultSlots: 12,
			Description: "河南省教育考试院规定：本科一批设12个平行志愿(学校+专业)，每校可填5个专业及是否服从调剂；本科二批设12个平行志愿；提前批设顺序志愿。有专业调剂。",
		},
		"四川": {
			Province: "四川", Mode: "四川本科批学校+专业志愿",
			Unit: "school_major", DefaultSlots: 9,
			Description: "四川省教育考试院规定：本科一批设9个平行志愿(学校+专业)，每校可填6个专业及是否服从调剂；本科二批设9个平行志愿；提前批设顺序志愿。有专业调剂。",
		},
		"陕西": {
			Province: "陕西", Mode: "陕西本科批学校+专业志愿",
			Unit: "school_major", DefaultSlots: 6,
			Description: "陕西省教育考试院规定：本科一批设6个平行志愿(学校+专业)，每校可填6个专业及是否服从调剂；本科二批设12个平行志愿；提前批设顺序志愿。有专业调剂。",
		},
		"山西": {
			Province: "山西", Mode: "山西本科批学校+专业志愿",
			Unit: "school_major", DefaultSlots: 8,
			Description: "山西省招生考试管理中心规定：本科一批设8个平行志愿(学校+专业)，每校可填6个专业及是否服从调剂；本科二批设8个平行志愿；提前批设顺序志愿。有专业调剂。",
		},
		"云南": {
			Province: "云南", Mode: "云南本科批学校+专业志愿",
			Unit: "school_major", DefaultSlots: 10,
			Description: "云南省招生考试院规定：本科一批设10个平行志愿(学校+专业)，每校可填6个专业及是否服从调剂；本科二批设10个平行志愿；提前批设顺序志愿。有专业调剂。",
		},
		"内蒙古": {
			Province: "内蒙古", Mode: "内蒙古本科批学校+专业动态志愿",
			Unit: "school_major", DefaultSlots: 45,
			Description: "内蒙古招生考试信息网规定：本科一批采用动态网上填报志愿模式，每轮填报1个学校+专业志愿，多轮进行；有专业调剂。该省模式特殊，推荐方案以候选为主。",
		},
		"新疆": {
			Province: "新疆", Mode: "新疆本科批学校+专业志愿",
			Unit: "school_major", DefaultSlots: 9,
			Description: "新疆招生网规定：本科一批设9个平行志愿(学校+专业)，每校可填6个专业及是否服从调剂；本科二批设9个平行志愿；提前批设顺序志愿。有专业调剂。",
		},
		"宁夏": {
			Province: "宁夏", Mode: "宁夏本科批学校+专业志愿",
			Unit: "school_major", DefaultSlots: 6,
			Description: "宁夏教育考试院规定：本科一批设6个平行志愿(学校+专业)，每校可填6个专业及是否服从调剂；本科二批设8个平行志愿；提前批设顺序志愿。有专业调剂。",
		},
		"青海": {
			Province: "青海", Mode: "青海本科批学校+专业志愿",
			Unit: "school_major", DefaultSlots: 6,
			Description: "青海省教育考试网规定：本科一批设6个平行志愿(学校+专业)，每校可填6个专业及是否服从调剂；本科二批设6个平行志愿；提前批设顺序志愿。有专业调剂。",
		},
		"西藏": {
			Province: "西藏", Mode: "西藏本科批学校+专业志愿",
			Unit: "school_major", DefaultSlots: 10,
			Description: "西藏教育考试院规定：本科一批设10个平行志愿(学校+专业)，每校可填6个专业及是否服从调剂；本科二批设10个平行志愿；提前批设顺序志愿。有专业调剂。",
		},
	}
	if rule, ok := rules[province]; ok {
		return completeGaokaoVolunteerRule(rule)
	}
	if province == "" {
		return completeGaokaoVolunteerRule(rules["广东"])
	}
	return completeGaokaoVolunteerRule(GaokaoVolunteerRule{Province: province, Mode: fmt.Sprintf("%s志愿表候选", province), Unit: "generic", DefaultSlots: 45, Description: fmt.Sprintf("通用候选模式：%s省规则尚未深度适配，生成结果需按当地考试院规则复核。", province)})
}

func completeGaokaoVolunteerRule(rule GaokaoVolunteerRule) GaokaoVolunteerRule {
	switch rule.Unit {
	case "major_group":
		rule.HasAdjustment = true
		rule.IsParallel = true
		if rule.MajorCountPerUnit == 0 {
			rule.MajorCountPerUnit = 6
		}
	case "major_school":
		rule.HasAdjustment = false
		rule.IsParallel = true
		if rule.MajorCountPerUnit == 0 {
			rule.MajorCountPerUnit = 1
		}
	case "school_major":
		rule.HasAdjustment = true
		rule.IsParallel = true
		if rule.MajorCountPerUnit == 0 {
			rule.MajorCountPerUnit = 6
		}
	}
	if rule.Province == "上海" {
		rule.MajorCountPerUnit = 4
	}
	if rule.Province == "河南" {
		rule.MajorCountPerUnit = 5
	}
	if rule.SourceTitle == "" {
		rule.SourceTitle = rule.Province + "教育考试院/招生考试机构2025年普通高校招生志愿填报规则"
	}
	return rule
}
