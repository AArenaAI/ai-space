package skills

import (
	"strings"
)

// Matcher 触发器匹配器
type Matcher struct {
	loader *Loader
}

// NewMatcher 创建匹配器
func NewMatcher(loader *Loader) *Matcher {
	return &Matcher{loader: loader}
}

// Match 匹配用户消息，返回匹配结果
func (m *Matcher) Match(message string) *MatchResult {
	if m.loader == nil {
		return &MatchResult{Matched: false}
	}

	skills := m.loader.GetAllSkills()
	if len(skills) == 0 {
		return &MatchResult{Matched: false}
	}

	message = strings.ToLower(strings.TrimSpace(message))

	// 优先匹配完整关键词（更精确）
	for _, meta := range skills {
		for _, trigger := range meta.Triggers {
			triggerLower := strings.ToLower(trigger)
			// 完整词匹配：检查是否包含完整的触发词
			if strings.Contains(message, triggerLower) {
				return &MatchResult{
					Matched: true,
					Skill:   &meta,
					Keyword: trigger,
				}
			}
		}
	}

	// 次级匹配：检查是否存在相似的词汇（实际应用中可以更宽松）
	// 目前先用精确匹配
	return &MatchResult{Matched: false}
}

// MatchByKey 通过 key 直接匹配
func (m *Matcher) MatchByKey(key string) *MatchResult {
	skill := m.loader.GetSkill(key)
	if skill == nil {
		return &MatchResult{Matched: false}
	}
	meta := skill.SkillMeta
	return &MatchResult{
		Matched: true,
		Skill:   &meta,
	}
}
