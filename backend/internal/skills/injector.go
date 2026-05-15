package skills

import (
	"fmt"
	"strings"

	"aipool-backend/internal/services"
)

// Injector Prompt 注入器
type Injector struct {
	loader *Loader
}

// NewInjector 创建注入器
func NewInjector(loader *Loader) *Injector {
	return &Injector{loader: loader}
}

// InjectSkillPrompt 将技能 Prompt 注入到消息数组（支持多 skill 协同注入）
func (inj *Injector) InjectSkillPrompt(messages []services.Message, skillKey string) ([]services.Message, error) {
	if inj.loader == nil {
		return messages, nil
	}

	contents := []string{}

	// 主 skill
	mainContent := inj.loader.GetSkillContent(skillKey)
	if mainContent == "" {
		return messages, fmt.Errorf("skill not found: %s", skillKey)
	}
	contents = append(contents, mainContent)

	// 协同 skills
	skill := inj.loader.GetSkill(skillKey)
	if skill != nil {
		for _, coKey := range skill.CoSkills {
			coContent := inj.loader.GetSkillContent(coKey)
			if coContent != "" {
				contents = append(contents, coContent)
			}
		}
	}

	// 合并所有 skill 为一条 system 消息（避免多条 system 消息干扰模型判断）
	combined := strings.Join(contents, "\n\n---\n\n")

	skillMsg := services.Message{
		Role:    "system",
		Content: combined,
	}

	return append([]services.Message{skillMsg}, messages...), nil
}

// InjectSkillPromptIfMatched 如果用户消息匹配技能触发器，则注入
func (inj *Injector) InjectSkillPromptIfMatched(messages []services.Message, userMessage string) ([]services.Message, *MatchResult, error) {
	if inj.loader == nil || len(messages) == 0 {
		return messages, nil, nil
	}

	matcher := NewMatcher(inj.loader)
	result := matcher.Match(userMessage)
	if !result.Matched {
		return messages, nil, nil
	}

	newMessages, err := inj.InjectSkillPrompt(messages, result.Skill.Key)
	if err != nil {
		return messages, result, err
	}

	return newMessages, result, nil
}

// GetSkillSystemContent 获取技能系统提示内容（用于特定模式的系统消息注入）
func (inj *Injector) GetSkillSystemContent(skillKey string) string {
	if inj.loader == nil {
		return ""
	}
	return inj.loader.GetSkillContent(skillKey)
}

// StripSkillPrefix 从消息中去掉技能前缀指令（如果用户使用了 /skill:指令）
func StripSkillPrefix(content string) (cleaned string, skillKey string, hasPrefix bool) {
	content = strings.TrimSpace(content)
	
	// 支持格式：/skill:key 或 /skill key 或 @skill(key)
	if strings.HasPrefix(content, "/skill:") {
		parts := strings.SplitN(content[7:], " ", 2)
		skillKey = strings.TrimSpace(parts[0])
		if len(parts) > 1 {
			cleaned = strings.TrimSpace(parts[1])
		}
		return cleaned, skillKey, true
	}
	
	if strings.HasPrefix(content, "/skill ") {
		parts := strings.SplitN(content[7:], " ", 2)
		skillKey = strings.TrimSpace(parts[0])
		if len(parts) > 1 {
			cleaned = strings.TrimSpace(parts[1])
		}
		return cleaned, skillKey, true
	}
	
	return content, "", false
}
