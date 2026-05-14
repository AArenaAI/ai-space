package skills

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var (
	skillsDir   = "skills"
	registryFile = "skill-registry.json"
	globalLoader *Loader
)

// Loader 技能加载器
type Loader struct {
	basePath string
	skills   map[string]*Skill
	registry *SkillRegistry
}

// NewLoader 创建加载器
func NewLoader(basePath string) *Loader {
	return &Loader{
		basePath: basePath,
		skills:   make(map[string]*Skill),
	}
}

// InitDefaultLoader 初始化全局加载器
func InitDefaultLoader(basePath string) error {
	l := NewLoader(basePath)
	if err := l.LoadAll(); err != nil {
		return err
	}
	globalLoader = l
	return nil
}

// GetLoader 获取全局加载器
func GetLoader() *Loader {
	return globalLoader
}

// LoadAll 加载所有技能
func (l *Loader) LoadAll() error {
	// 先加载注册表
	registryPath := filepath.Join(l.basePath, registryFile)
	data, err := os.ReadFile(registryPath)
	if err != nil {
		return fmt.Errorf("读取技能注册表失败: %w", err)
	}

	var registry SkillRegistry
	if err := json.Unmarshal(data, &registry); err != nil {
		return fmt.Errorf("解析技能注册表失败: %w", err)
	}
	l.registry = &registry

	// 加载每个技能的 SKILL.md
	for _, meta := range registry.Skills {
		if !meta.Enabled {
			continue
		}
		skill, err := l.loadSkill(meta)
		if err != nil {
			fmt.Printf("加载技能 %s 失败: %v\n", meta.Key, err)
			continue
		}
		l.skills[meta.Key] = skill
	}

	fmt.Printf("已加载 %d 个技能\n", len(l.skills))
	return nil
}

// loadSkill 加载单个技能
func (l *Loader) loadSkill(meta SkillMeta) (*Skill, error) {
	skillPath := filepath.Join(l.basePath, meta.Key, "SKILL.md")
	data, err := os.ReadFile(skillPath)
	if err != nil {
		return nil, fmt.Errorf("读取 SKILL.md 失败: %w", err)
	}

	content := string(data)
	// 去掉 frontmatter（--- 包围的部分）
	if strings.HasPrefix(content, "---") {
		endIdx := strings.Index(content[3:], "---")
		if endIdx != -1 {
			content = strings.TrimSpace(content[3+endIdx+3:])
		}
	}

	return &Skill{
		SkillMeta: meta,
		Content:   content,
	}, nil
}

// GetSkill 通过 key 获取技能
func (l *Loader) GetSkill(key string) *Skill {
	return l.skills[key]
}

// GetAllSkills 获取所有技能列表
func (l *Loader) GetAllSkills() []SkillMeta {
	if l.registry == nil {
		return nil
	}
	result := make([]SkillMeta, 0)
	for _, meta := range l.registry.Skills {
		if meta.Enabled {
			result = append(result, meta)
		}
	}
	return result
}

// GetSkillContent 获取技能的纯 Prompt 内容
func (l *Loader) GetSkillContent(key string) string {
	skill := l.skills[key]
	if skill == nil {
		return ""
	}
	return skill.Content
}
