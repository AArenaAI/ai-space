package api

import (
	"net/http"
	"sync"

	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/models"
	"aipool-backend/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var (
	modelConfigDB     *gorm.DB
	modelConfigDBOnce sync.Once
)

// InitModelConfigDB 在路由初始化时注入数据库连接，供公共模型接口读取管理员配置。
func InitModelConfigDB(db *gorm.DB) {
	modelConfigDBOnce.Do(func() {
		modelConfigDB = db
	})
}

// mergeModelConfigs 将代码中的模型列表与数据库 ModelConfig 覆盖项合并，
// 并过滤掉被管理员禁用的模型（enabled=false 或 status=disabled/maintenance/quota_exhausted）。
func mergeModelConfigs(base []modelmeta.ModelInfo) []modelmeta.ModelInfo {
	if modelConfigDB == nil {
		return base
	}
	var configs []models.ModelConfig
	if err := modelConfigDB.Find(&configs).Error; err != nil {
		return base
	}
	configMap := make(map[string]models.ModelConfig, len(configs))
	for _, cfg := range configs {
		configMap[cfg.ModelID] = cfg
	}

	var result []modelmeta.ModelInfo
	for _, m := range base {
		if cfg, ok := configMap[m.ID]; ok {
			if !cfg.Enabled {
				continue // 被管理员显式禁用，直接过滤
			}
			applyReasoningConfigToModel(&m, cfg)
			if cfg.Status != "" {
				m.Status = cfg.Status
			}
			if cfg.StatusMsg != "" {
				m.StatusMessage = cfg.StatusMsg
			}
		} else {
			applyReasoningConfigToModel(&m, models.ModelConfig{ReasoningLevel: ""})
		}
		// 过滤业务状态为禁用/维护/配额耗尽的模型
		if m.Status == "disabled" || m.Status == "maintenance" || m.Status == "quota_exhausted" {
			continue
		}
		result = append(result, modelmeta.WithFileSupport(m))
	}
	return result
}

func applyReasoningConfigToModel(model *modelmeta.ModelInfo, cfg models.ModelConfig) {
	if model == nil || !modelmeta.ModelHasCapability(*model, "reasoning") {
		return
	}
	publicLevel := services.NormalizeReasoningLevel(cfg.ReasoningLevel)
	overrides := services.ReasoningEffortOverrides{
		Fast:     cfg.ReasoningFastValue,
		Thinking: cfg.ReasoningThinkingValue,
		Expert:   cfg.ReasoningExpertValue,
	}
	effort := services.ReasoningEffortForPublicLevelWithOverrides(publicLevel, overrides)
	fast, thinking, expert := services.EffectiveReasoningOverrideValuesForModel(model.ID, overrides)
	model.ReasoningLevel = publicLevel
	model.ReasoningLevelName = services.ReasoningLevelName(publicLevel)
	model.ReasoningEffort = effort.String()
	model.ReasoningParameter = services.ReasoningParameterName(model.ID)
	model.ReasoningFastValue = fast
	model.ReasoningThinkingValue = thinking
	model.ReasoningExpertValue = expert
}

func GetModelsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, mergeModelConfigs(modelmeta.AllModels()))
}

func GetChatModelsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, mergeModelConfigs(modelmeta.ChatModels()))
}

func GetImageModelsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, mergeModelConfigs(modelmeta.ImageModels()))
}
