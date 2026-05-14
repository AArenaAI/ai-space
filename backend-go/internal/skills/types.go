package skills

// SkillMeta 技能元数据
type SkillMeta struct {
	Key              string   `json:"key"`
	DisplayName      string   `json:"display_name"`
	Version          string   `json:"version"`
	Description      string   `json:"description"`
	Category         string   `json:"category"`
	Icon             string   `json:"icon"`
	Color            string   `json:"color"`
	RecommendedModel string   `json:"recommended_model"`
	Triggers         []string `json:"triggers"`
	Enabled          bool     `json:"enabled"`
	CoSkills         []string `json:"co_skills,omitempty"` // 协同 skill，主 skill 被调用时同时注入
	IsMeta           bool     `json:"is_meta,omitempty"`   // 是否为元约束 skill（不独立调用）
}

// Skill 完整技能数据
type Skill struct {
	SkillMeta
	Content string `json:"content"` // SKILL.md 文件内容（去掉 frontmatter）
}

// SkillRegistry 技能注册表
type SkillRegistry struct {
	Skills []SkillMeta `json:"skills"`
}

// MatchResult 匹配结果
type MatchResult struct {
	Matched bool        `json:"matched"`
	Skill   *SkillMeta  `json:"skill,omitempty"`
	Keyword string      `json:"keyword,omitempty"`
}
