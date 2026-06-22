package api

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"aipool-backend/internal/models"
	"aipool-backend/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AlertHandler 告警管理处理器
type AlertHandler struct {
	db            *gorm.DB
	emailService  *services.EmailService
}

// NewAlertHandler 创建 AlertHandler
func NewAlertHandler(db *gorm.DB, emailService *services.EmailService) *AlertHandler {
	return &AlertHandler{db: db, emailService: emailService}
}

// InitDefaultRules 初始化默认告警规则
func (h *AlertHandler) InitDefaultRules() {
	var count int64
	h.db.Model(&models.AlertRule{}).Count(&count)
	if count > 0 {
		return
	}

	defaults := []models.AlertRule{
		{
			Name:      "错误率过高",
			EventType: "error",
			Metric:    "error_rate",
			Threshold: 5.0,  // 错误率 > 5%
			WindowMin: 5,
			Enabled:   true,
		},
		{
			Name:      "积分异常消耗",
			EventType: "credit_use",
			Metric:    "count",
			Threshold: 100,  // 5分钟内 > 100次
			WindowMin: 5,
			Enabled:   true,
		},
		{
			Name:      "聊天完成率过低",
			EventType: "chat_complete",
			Metric:    "completion_rate",
			Threshold: 50.0,  // 完成率 < 50%
			WindowMin: 10,
			Enabled:   true,
		},
		{
			Name:      "BadCase 激增",
			EventType: "bad_case_submit",
			Metric:    "count",
			Threshold: 10,  // 10分钟内 > 10条
			WindowMin: 10,
			Enabled:   true,
		},
	}

	for _, rule := range defaults {
		h.db.FirstOrCreate(&rule, models.AlertRule{Name: rule.Name})
	}
}

// ========== 告警规则 CRUD ==========

// ListAlertRules 获取告警规则列表
func (h *AlertHandler) ListAlertRules(c *gin.Context) {
	var rules []models.AlertRule
	h.db.Order("id DESC").Find(&rules)
	c.JSON(http.StatusOK, gin.H{"rules": rules})
}

// CreateAlertRuleRequest 创建告警规则请求
type CreateAlertRuleRequest struct {
	Name        string  `json:"name" binding:"required"`
	EventType   string  `json:"event_type" binding:"required"`
	Metric      string  `json:"metric" binding:"required,oneof=error_rate count completion_rate latency"`
	Threshold   float64 `json:"threshold" binding:"required"`
	WindowMin   int     `json:"window_min" binding:"min=1,max=60"`
	Enabled     bool    `json:"enabled"`
	NotifyEmail string  `json:"notify_email"`
}

// CreateAlertRule 创建告警规则
func (h *AlertHandler) CreateAlertRule(c *gin.Context) {
	var req CreateAlertRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rule := models.AlertRule{
		Name:        req.Name,
		EventType:   req.EventType,
		Metric:      req.Metric,
		Threshold:   req.Threshold,
		WindowMin:   req.WindowMin,
		Enabled:     req.Enabled,
		NotifyEmail: req.NotifyEmail,
	}
	if err := h.db.Create(&rule).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	c.JSON(http.StatusCreated, rule)
}

// UpdateAlertRule 更新告警规则
func (h *AlertHandler) UpdateAlertRule(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效 ID"})
		return
	}

	var req CreateAlertRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var rule models.AlertRule
	if err := h.db.First(&rule, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "规则不存在"})
		return
	}

	h.db.Model(&rule).Updates(map[string]interface{}{
		"name":         req.Name,
		"event_type":   req.EventType,
		"metric":       req.Metric,
		"threshold":    req.Threshold,
		"window_min":   req.WindowMin,
		"enabled":      req.Enabled,
		"notify_email": req.NotifyEmail,
	})
	c.JSON(http.StatusOK, rule)
}

func (h *AlertHandler) DeleteAlertRule(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效 ID"})
		return
	}

	h.db.Delete(&models.AlertRule{}, uint(id))
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// ========== 告警检测与触发 ==========

// CheckAlerts 检测所有告警规则
func (h *AlertHandler) CheckAlerts() {
	var rules []models.AlertRule
	h.db.Where("enabled = ?", true).Find(&rules)

	for _, rule := range rules {
		h.checkRule(rule)
	}
}

func (h *AlertHandler) checkRule(rule models.AlertRule) {
	windowStart := time.Now().Add(-time.Duration(rule.WindowMin) * time.Minute)

	switch rule.Metric {
	case "error_rate":
		h.checkErrorRate(rule, windowStart)
	case "count":
		h.checkCount(rule, windowStart)
	case "completion_rate":
		h.checkCompletionRate(rule, windowStart)
	case "latency":
		h.checkLatency(rule, windowStart)
	}
}

func (h *AlertHandler) checkErrorRate(rule models.AlertRule, windowStart time.Time) {
	var totalCount, errorCount int64

	h.db.Model(&models.AnalyticsEvent{}).
		Where("event_type = ? AND created_at >= ?", rule.EventType, windowStart).
		Count(&totalCount)

	if totalCount == 0 {
		return
	}

	h.db.Model(&models.AnalyticsEvent{}).
		Where("event_type = ? AND created_at >= ? AND (metadata LIKE ? OR metadata LIKE ?)",
			rule.EventType, windowStart, "%error%", "%failed%").
		Count(&errorCount)

	rate := float64(errorCount) / float64(totalCount) * 100
	if rate > rule.Threshold {
		h.fireAlert(rule, rate, fmt.Sprintf("%s 错误率 %.1f%% (阈值 %.1f%%)，%d 分钟内 %d 次错误 / %d 次总调用",
			rule.EventType, rate, rule.Threshold, rule.WindowMin, errorCount, totalCount))
	}
}

func (h *AlertHandler) checkCount(rule models.AlertRule, windowStart time.Time) {
	var count int64
	h.db.Model(&models.AnalyticsEvent{}).
		Where("event_type = ? AND created_at >= ?", rule.EventType, windowStart).
		Count(&count)

	if float64(count) > rule.Threshold {
		h.fireAlert(rule, float64(count), fmt.Sprintf("%s 在 %d 分钟内发生 %d 次 (阈值 %.0f)",
			rule.EventType, rule.WindowMin, count, rule.Threshold))
	}
}

func (h *AlertHandler) checkCompletionRate(rule models.AlertRule, windowStart time.Time) {
	var totalCount, completeCount int64

	h.db.Model(&models.AnalyticsEvent{}).
		Where("event_type = ? AND created_at >= ?", "chat_start", windowStart).
		Count(&totalCount)

	if totalCount == 0 {
		return
	}

	h.db.Model(&models.AnalyticsEvent{}).
		Where("event_type = ? AND created_at >= ?", "chat_complete", windowStart).
		Count(&completeCount)

	rate := float64(completeCount) / float64(totalCount) * 100
	if rate < rule.Threshold {
		h.fireAlert(rule, rate, fmt.Sprintf("聊天完成率 %.1f%% (阈值 %.1f%%)，%d 分钟内 %d 完成 / %d 开始",
			rate, rule.Threshold, rule.WindowMin, completeCount, totalCount))
	}
}

func (h *AlertHandler) checkLatency(rule models.AlertRule, windowStart time.Time) {
	var avgLatency float64
	h.db.Model(&models.AnalyticsEvent{}).
		Where("event_type = ? AND created_at >= ? AND duration_ms > 0", rule.EventType, windowStart).
		Select("AVG(duration_ms)").
		Scan(&avgLatency)

	if avgLatency > rule.Threshold {
		h.fireAlert(rule, avgLatency, fmt.Sprintf("%s 平均耗时 %.0fms (阈值 %.0fms)",
			rule.EventType, avgLatency, rule.Threshold))
	}
}

func (h *AlertHandler) fireAlert(rule models.AlertRule, value float64, message string) {
	// 检查是否已有未恢复的告警
	var existing models.AlertHistory
	err := h.db.Where("rule_id = ? AND status = ?", rule.ID, "firing").
		Order("created_at DESC").
		First(&existing).Error

	// 如果已有未恢复告警，且1小时内已发送过，不再重复
	if err == nil && time.Since(existing.CreatedAt) < time.Hour {
		return
	}

	alert := models.AlertHistory{
		RuleID:    rule.ID,
		RuleName:  rule.Name,
		EventType: rule.EventType,
		Metric:    rule.Metric,
		Value:     value,
		Threshold: rule.Threshold,
		Status:    "firing",
		Message:   message,
	}
	h.db.Create(&alert)

	// 发送邮件通知
	if h.emailService != nil && h.emailService.IsEnabled() && rule.NotifyEmail != "" {
		go func() {
			subject := fmt.Sprintf("[AI Space 告警] %s", rule.Name)
			body := fmt.Sprintf("告警规则：%s\n事件类型：%s\n当前值：%.2f\n阈值：%.2f\n\n%s\n\n时间：%s",
				rule.Name, rule.EventType, value, rule.Threshold, message, time.Now().Format("2006-01-02 15:04:05"))
			if err := h.emailService.SendAlertEmail(rule.NotifyEmail, subject, body); err != nil {
				fmt.Printf("[Alert] 邮件发送失败: %v\n", err)
			}
		}()
	}
}

// ResolveAlert 手动恢复告警
func (h *AlertHandler) ResolveAlert(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效 ID"})
		return
	}

	now := time.Now()
	h.db.Model(&models.AlertHistory{}).Where("id = ?", uint(id)).Updates(map[string]interface{}{
		"status":      "resolved",
		"resolved_at": &now,
	})
	c.JSON(http.StatusOK, gin.H{"message": "已恢复"})
}

// ========== 告警历史查询 ==========

// ListAlertHistory 获取告警历史
func (h *AlertHandler) ListAlertHistory(c *gin.Context) {
	status := c.Query("status")
	pageStr := c.Query("page")
	pageSizeStr := c.Query("page_size")
	page := 1
	pageSize := 20
	if p, err := strconv.Atoi(pageStr); err == nil && p > 0 {
		page = p
	}
	if ps, err := strconv.Atoi(pageSizeStr); err == nil && ps > 0 {
		pageSize = ps
	}
	if pageSize > 100 {
		pageSize = 100
	}

	var total int64
	query := h.db.Model(&models.AlertHistory{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	query.Count(&total)

	var alerts []models.AlertHistory
	query.Order("created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&alerts)

	c.JSON(http.StatusOK, gin.H{
		"alerts":      alerts,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": (int(total) + pageSize - 1) / pageSize,
	})
}

// GetAlertStats 获取告警统计
func (h *AlertHandler) GetAlertStats(c *gin.Context) {
	var totalFiring, totalResolved, totalToday int64

	h.db.Model(&models.AlertHistory{}).Where("status = ?", "firing").Count(&totalFiring)
	h.db.Model(&models.AlertHistory{}).Where("status = ?", "resolved").Count(&totalResolved)

	today := time.Now().Format("2006-01-02")
	h.db.Model(&models.AlertHistory{}).Where("DATE(created_at) = ?", today).Count(&totalToday)

	c.JSON(http.StatusOK, gin.H{
		"total_firing":   totalFiring,
		"total_resolved": totalResolved,
		"total_today":    totalToday,
	})
}
