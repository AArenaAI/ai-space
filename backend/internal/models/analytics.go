package models

import "time"

// AnalyticsEvent 用户行为事件追踪表
type AnalyticsEvent struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	UserID      uint      `gorm:"index;not null" json:"user_id"`           // 用户ID
	EventType   string    `gorm:"size:64;index;not null" json:"event_type"` // 事件类型
	EventName   string    `gorm:"size:128;index;not null" json:"event_name"` // 事件名称
	PagePath    string    `gorm:"size:256" json:"page_path"`                // 页面路径
	ModelID     string    `gorm:"size:64" json:"model_id,omitempty"`        // 模型ID（如使用模型）
	DurationMs  int       `json:"duration_ms,omitempty"`                    // 持续时间（毫秒）
	Metadata    string    `gorm:"type:text" json:"metadata,omitempty"`      // 额外JSON数据
	SessionID   string    `gorm:"size:64;index" json:"session_id"`          // 会话ID
	IP          string    `gorm:"size:45" json:"ip,omitempty"`              // IP地址
	UserAgent   string    `gorm:"size:512" json:"user_agent,omitempty"`     // User-Agent
	CreatedAt   time.Time `json:"created_at"`
}

// AnalyticsEventType 预定义事件类型
const (
	EventTypePageView    = "page_view"     // 页面访问
	EventTypeClick       = "click"         // 点击
	EventTypeChatStart   = "chat_start"    // 开始对话
	EventTypeChatComplete = "chat_complete" // 对话完成
	EventTypeModelSwitch = "model_switch"  // 切换模型
	EventTypeCreditUse   = "credit_use"    // 使用积分
	EventTypeCreditExhausted = "credit_exhausted" // 积分耗尽
	EventTypeBetaApply   = "beta_apply"    // 内测申请
	EventTypeInviteUse   = "invite_use"    // 使用邀请码
	EventTypeBadCaseSubmit = "bad_case_submit" // 提交BadCase
	EventTypeShare       = "share"         // 分享
	EventTypeExport      = "export"        // 导出
	EventTypeError       = "error"         // 错误
)

// AnalyticsSummary 分析汇总（按天统计）
type AnalyticsSummary struct {
	Date           string  `json:"date"`
	PageViews      int     `json:"page_views"`
	ChatStarts     int     `json:"chat_starts"`
	ChatCompletes  int     `json:"chat_completes"`
	ModelSwitches  int     `json:"model_switches"`
	CreditUses     int     `json:"credit_uses"`
	BetaApplies    int     `json:"beta_applies"`
	InviteUses     int     `json:"invite_uses"`
	BadCaseSubmits int     `json:"bad_case_submits"`
	Errors         int     `json:"errors"`
	UniqueUsers    int     `json:"unique_users"`
	AvgChatDuration int    `json:"avg_chat_duration_ms"`
}

// AnalyticsFunnel 漏斗分析
type AnalyticsFunnel struct {
	Stage        string `json:"stage"`         // 阶段名称
	Users        int    `json:"users"`         // 用户数
	Conversion   float64 `json:"conversion"`  // 转化率（相对于上一阶段）
	DropOff      float64 `json:"drop_off"`     // 流失率
	Description  string `json:"description"`  // 说明
}

// AnalyticsModelUsage 模型使用统计
type AnalyticsModelUsage struct {
	ModelID      string `json:"model_id"`
	ModelName    string `json:"model_name"`
	UsageCount   int    `json:"usage_count"`
	UserCount    int    `json:"user_count"`
	AvgDuration  int    `json:"avg_duration_ms"`
	ErrorRate    float64 `json:"error_rate"`
}

// AnalyticsRetention 留存分析
type AnalyticsRetention struct {
	CohortDate   string  `json:"cohort_date"`   //  cohort 日期
	Day0         int     `json:"day_0"`         // 当天
	Day1         int     `json:"day_1"`         // 次日
	Day3         int     `json:"day_3"`         // 3日
	Day7         int     `json:"day_7"`         // 7日
	Day14        int     `json:"day_14"`        // 14日
	Day30        int     `json:"day_30"`        // 30日
	TotalUsers   int     `json:"total_users"`   // 总用户数
}
