package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AnalyticsHandler 埋点/分析处理器
type AnalyticsHandler struct {
	db *gorm.DB
}

func NewAnalyticsHandler(db *gorm.DB) *AnalyticsHandler {
	return &AnalyticsHandler{db: db}
}

// TrackEventRequest 追踪事件请求
type TrackEventRequest struct {
	EventType  string                 `json:"event_type" binding:"required"`
	EventName  string                 `json:"event_name" binding:"required"`
	PagePath   string                 `json:"page_path"`
	ModelID    string                 `json:"model_id"`
	DurationMs int                    `json:"duration_ms"`
	Metadata   map[string]interface{} `json:"metadata"`
	SessionID  string                 `json:"session_id"`
}

// TrackEvent 追踪单个事件（公开API，无需认证）
func (h *AnalyticsHandler) TrackEvent(c *gin.Context) {
	var req TrackEventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	// 获取用户信息（如果已登录）
	var userID uint
	if user, exists := c.Get("user"); exists {
		if u, ok := user.(*models.User); ok {
			userID = u.ID
		}
	}

	// 序列化 metadata
	var metadataStr string
	if req.Metadata != nil {
		b, _ := json.Marshal(req.Metadata)
		metadataStr = string(b)
	}

	event := models.AnalyticsEvent{
		UserID:     userID,
		EventType:  req.EventType,
		EventName:  req.EventName,
		PagePath:   req.PagePath,
		ModelID:    req.ModelID,
		DurationMs: req.DurationMs,
		Metadata:   metadataStr,
		SessionID:  req.SessionID,
		IP:         c.ClientIP(),
		UserAgent:  c.GetHeader("User-Agent"),
	}

	if err := h.db.Create(&event).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "记录失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// BatchTrackEvents 批量追踪事件
func (h *AnalyticsHandler) BatchTrackEvents(c *gin.Context) {
	var reqs []TrackEventRequest
	if err := c.ShouldBindJSON(&reqs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	var userID uint
	if user, exists := c.Get("user"); exists {
		if u, ok := user.(*models.User); ok {
			userID = u.ID
		}
	}

	events := make([]models.AnalyticsEvent, len(reqs))
	for i, req := range reqs {
		var metadataStr string
		if req.Metadata != nil {
			b, _ := json.Marshal(req.Metadata)
			metadataStr = string(b)
		}
		events[i] = models.AnalyticsEvent{
			UserID:     userID,
			EventType:  req.EventType,
			EventName:  req.EventName,
			PagePath:   req.PagePath,
			ModelID:    req.ModelID,
			DurationMs: req.DurationMs,
			Metadata:   metadataStr,
			SessionID:  req.SessionID,
			IP:         c.ClientIP(),
			UserAgent:  c.GetHeader("User-Agent"),
		}
	}

	if err := h.db.Create(&events).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "记录失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "count": len(events)})
}

// GetAnalyticsSummary 获取分析汇总（admin）
func (h *AnalyticsHandler) GetAnalyticsSummary(c *gin.Context) {
	daysStr := c.DefaultQuery("days", "7")
	days, _ := strconv.Atoi(daysStr)
	if days <= 0 || days > 90 {
		days = 7
	}

	startDate := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")

	var summaries []models.AnalyticsSummary

	// 按天统计各事件类型
	rows, err := h.db.Raw(`
		SELECT 
			DATE(created_at) as date,
			SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) as page_views,
			SUM(CASE WHEN event_type = 'chat_start' THEN 1 ELSE 0 END) as chat_starts,
			SUM(CASE WHEN event_type = 'chat_complete' THEN 1 ELSE 0 END) as chat_completes,
			SUM(CASE WHEN event_type = 'model_switch' THEN 1 ELSE 0 END) as model_switches,
			SUM(CASE WHEN event_type = 'credit_use' THEN 1 ELSE 0 END) as credit_uses,
			SUM(CASE WHEN event_type = 'beta_apply' THEN 1 ELSE 0 END) as beta_applies,
			SUM(CASE WHEN event_type = 'invite_use' THEN 1 ELSE 0 END) as invite_uses,
			SUM(CASE WHEN event_type = 'bad_case_submit' THEN 1 ELSE 0 END) as bad_case_submits,
			SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) as errors,
			COUNT(DISTINCT user_id) as unique_users,
			AVG(CASE WHEN event_type = 'chat_complete' THEN duration_ms ELSE NULL END) as avg_chat_duration
		FROM analytics_events
		WHERE DATE(created_at) >= ?
		GROUP BY DATE(created_at)
		ORDER BY date DESC
	`, startDate).Rows()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	defer rows.Close()

	for rows.Next() {
		var s models.AnalyticsSummary
		var avgDuration *int
		rows.Scan(&s.Date, &s.PageViews, &s.ChatStarts, &s.ChatCompletes, &s.ModelSwitches,
			&s.CreditUses, &s.BetaApplies, &s.InviteUses, &s.BadCaseSubmits, &s.Errors,
			&s.UniqueUsers, &avgDuration)
		if avgDuration != nil {
			s.AvgChatDuration = *avgDuration
		}
		summaries = append(summaries, s)
	}

	c.JSON(http.StatusOK, gin.H{
		"summaries": summaries,
		"days":      days,
	})
}

// GetFunnelAnalysis 获取漏斗分析
func (h *AnalyticsHandler) GetFunnelAnalysis(c *gin.Context) {
	daysStr := c.DefaultQuery("days", "7")
	days, _ := strconv.Atoi(daysStr)
	if days <= 0 || days > 90 {
		days = 7
	}
	startDate := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")

	// 定义漏斗阶段
	stages := []struct {
		Name        string
		EventType   string
		Description string
	}{
		{"访问", "page_view", "访问任意页面"},
		{"开始对话", "chat_start", "点击发送按钮"},
		{"完成对话", "chat_complete", "收到完整回复"},
		{"使用模型", "credit_use", "消耗积分"},
		{"提交反馈", "bad_case_submit", "提交 Bad Case"},
	}

	var funnel []models.AnalyticsFunnel
	var prevCount int

	for _, stage := range stages {
		var count int64
		h.db.Model(&models.AnalyticsEvent{}).
			Where("event_type = ? AND DATE(created_at) >= ?", stage.EventType, startDate).
			Count(&count)

		var conversion, dropOff float64
		if prevCount > 0 {
			conversion = float64(count) / float64(prevCount) * 100
			dropOff = 100 - conversion
		}
		prevCount = int(count)

		funnel = append(funnel, models.AnalyticsFunnel{
			Stage:       stage.Name,
			Users:       int(count),
			Conversion:  conversion,
			DropOff:     dropOff,
			Description: stage.Description,
		})
	}

	c.JSON(http.StatusOK, gin.H{"funnel": funnel, "days": days})
}

// GetModelUsageStats 获取模型使用统计
func (h *AnalyticsHandler) GetModelUsageStats(c *gin.Context) {
	daysStr := c.DefaultQuery("days", "7")
	days, _ := strconv.Atoi(daysStr)
	if days <= 0 || days > 90 {
		days = 7
	}
	startDate := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")

	var stats []models.AnalyticsModelUsage

	rows, err := h.db.Raw(`
		SELECT 
			model_id,
			COUNT(*) as usage_count,
			COUNT(DISTINCT user_id) as user_count,
			AVG(duration_ms) as avg_duration,
			SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as error_rate
		FROM analytics_events
		WHERE model_id != '' AND DATE(created_at) >= ?
		GROUP BY model_id
		ORDER BY usage_count DESC
	`, startDate).Rows()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	defer rows.Close()

	for rows.Next() {
		var s models.AnalyticsModelUsage
		var avgDuration *int
		rows.Scan(&s.ModelID, &s.UsageCount, &s.UserCount, &avgDuration, &s.ErrorRate)
		if avgDuration != nil {
			s.AvgDuration = *avgDuration
		}
		// 模型名称从 modelmeta 获取（简化处理）
		s.ModelName = s.ModelID
		stats = append(stats, s)
	}

	c.JSON(http.StatusOK, gin.H{"stats": stats, "days": days})
}

// GetRetentionAnalysis 获取留存分析
func (h *AnalyticsHandler) GetRetentionAnalysis(c *gin.Context) {
	// 按注册日期 cohort 分析
	var retentions []models.AnalyticsRetention

	// 简化留存分析，直接返回空数据
	c.JSON(http.StatusOK, gin.H{"retentions": retentions})
}

// GetRealtimeStats 获取实时统计
func (h *AnalyticsHandler) GetRealtimeStats(c *gin.Context) {
	now := time.Now()
	today := now.Format("2006-01-02")
	lastHour := now.Add(-1 * time.Hour)

	var todayEvents, lastHourEvents, onlineUsers int64

	h.db.Model(&models.AnalyticsEvent{}).Where("DATE(created_at) = ?", today).Count(&todayEvents)
	h.db.Model(&models.AnalyticsEvent{}).Where("created_at >= ?", lastHour).Count(&lastHourEvents)
	h.db.Model(&models.AnalyticsEvent{}).Where("created_at >= ?", lastHour).Distinct("user_id").Count(&onlineUsers)

	c.JSON(http.StatusOK, gin.H{
		"today_events":     todayEvents,
		"last_hour_events": lastHourEvents,
		"online_users":     onlineUsers,
		"timestamp":        now.Format("2006-01-02 15:04:05"),
	})
}
