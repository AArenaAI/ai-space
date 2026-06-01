package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AdminHandler struct {
	db *gorm.DB
}

func NewAdminHandler(db *gorm.DB) *AdminHandler {
	return &AdminHandler{db: db}
}

type adminUserResponse struct {
	ID              uint      `json:"id"`
	Email           string    `json:"email"`
	Name            string    `json:"name"`
	Role            string    `json:"role"`
	PlanTier        string    `json:"plan_tier"`
	BasicCredits    int       `json:"basic_credits"`
	AdvancedCredits int       `json:"advanced_credits"`
	EliteCredits    int       `json:"elite_credits"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func toAdminUserResponse(user models.User) adminUserResponse {
	role := user.Role
	if role == "" {
		role = "user"
	}
	return adminUserResponse{
		ID:              user.ID,
		Email:           user.Email,
		Name:            user.Name,
		Role:            role,
		PlanTier:        user.PlanTier,
		BasicCredits:    user.BasicCredits,
		AdvancedCredits: user.AdvancedCredits,
		EliteCredits:    user.EliteCredits,
		CreatedAt:       user.CreatedAt,
		UpdatedAt:       user.UpdatedAt,
	}
}

func (h *AdminHandler) Me(c *gin.Context) {
	userIDValue, _ := c.Get("userID")
	userID, _ := userIDValue.(uint)
	var user models.User
	if err := h.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": toAdminUserResponse(user)})
}

func (h *AdminHandler) Overview(c *gin.Context) {
	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	var totalUsers int64
	var todayNewUsers int64
	var todayRequests int64
	var todayFailures int64
	var runningTasks int64
	var failedTasksToday int64
	var todayCost float64

	h.db.Model(&models.User{}).Count(&totalUsers)
	h.db.Model(&models.User{}).Where("created_at >= ?", startOfDay).Count(&todayNewUsers)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ?", startOfDay).Count(&todayRequests)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ? AND status <> ?", startOfDay, "success").Count(&todayFailures)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ?", startOfDay).Select("COALESCE(SUM(total_cost_rmb), 0)").Scan(&todayCost)
	h.db.Model(&models.AIBackgroundTask{}).Where("status IN ?", []string{"running", "pending"}).Count(&runningTasks)
	h.db.Model(&models.AIBackgroundTask{}).Where("created_at >= ? AND status = ?", startOfDay, "failed").Count(&failedTasksToday)

	topModels := []gin.H{}
	rows, err := h.db.Model(&models.APIUsageLog{}).
		Select("COALESCE(model, '') AS model, COALESCE(provider, '') AS provider, COALESCE(SUM(total_cost_rmb), 0) AS cost_rmb, COUNT(*) AS requests").
		Where("created_at >= ?", startOfDay).
		Group("model, provider").
		Order("cost_rmb DESC").
		Limit(5).Rows()
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var model, provider string
			var cost float64
			var requests int64
			if err := rows.Scan(&model, &provider, &cost, &requests); err == nil {
				topModels = append(topModels, gin.H{"model": model, "provider": provider, "cost_rmb": cost, "requests": requests})
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"users":  gin.H{"total": totalUsers, "today_new": todayNewUsers},
		"usage":  gin.H{"today_requests": todayRequests, "today_cost_rmb": todayCost, "today_failures": todayFailures},
		"tasks":  gin.H{"running": runningTasks, "failed_today": failedTasksToday},
		"models": gin.H{"top_by_cost": topModels},
	})
}

func (h *AdminHandler) ListUsers(c *gin.Context) {
	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	q := strings.TrimSpace(c.Query("q"))

	query := h.db.Model(&models.User{})
	if q != "" {
		if id, err := strconv.Atoi(q); err == nil && id > 0 {
			query = query.Where("id = ? OR email ILIKE ? OR name ILIKE ?", id, "%"+q+"%", "%"+q+"%")
		} else {
			query = query.Where("email ILIKE ? OR name ILIKE ?", "%"+q+"%", "%"+q+"%")
		}
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户数量失败"})
		return
	}

	var users []models.User
	if err := query.Order("id ASC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户列表失败"})
		return
	}

	items := make([]adminUserResponse, 0, len(users))
	for _, user := range users {
		items = append(items, toAdminUserResponse(user))
	}

	c.JSON(http.StatusOK, gin.H{"users": items, "total": total, "page": page, "page_size": pageSize})
}

func (h *AdminHandler) GetUser(c *gin.Context) {
	user, ok := h.findUserByParam(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": toAdminUserResponse(user)})
}

type adminUpdateUserRequest struct {
	Name            *string `json:"name"`
	Role            *string `json:"role"`
	PlanTier        *string `json:"plan_tier"`
	BasicCredits    *int    `json:"basic_credits"`
	AdvancedCredits *int    `json:"advanced_credits"`
	EliteCredits    *int    `json:"elite_credits"`
}

func (h *AdminHandler) UpdateUser(c *gin.Context) {
	user, ok := h.findUserByParam(c)
	if !ok {
		return
	}
	var req adminUpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}
	updates := map[string]any{}
	if req.Name != nil {
		updates["name"] = strings.TrimSpace(*req.Name)
	}
	if req.Role != nil {
		role := strings.TrimSpace(*req.Role)
		if role != "user" && role != "admin" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "角色只能是 user 或 admin"})
			return
		}
		updates["role"] = role
	}
	if req.PlanTier != nil {
		plan := strings.TrimSpace(*req.PlanTier)
		if plan == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "套餐不能为空"})
			return
		}
		updates["plan_tier"] = plan
	}
	if req.BasicCredits != nil {
		updates["basic_credits"] = *req.BasicCredits
	}
	if req.AdvancedCredits != nil {
		updates["advanced_credits"] = *req.AdvancedCredits
	}
	if req.EliteCredits != nil {
		updates["elite_credits"] = *req.EliteCredits
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "没有可更新的字段"})
		return
	}
	if err := h.db.Model(&user).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新用户失败"})
		return
	}
	h.db.First(&user, user.ID)
	c.JSON(http.StatusOK, gin.H{"user": toAdminUserResponse(user)})
}

type adminAdjustCreditsRequest struct {
	Tier   string `json:"tier" binding:"required"`
	Amount int    `json:"amount" binding:"required"`
	Mode   string `json:"mode"`
}

func (h *AdminHandler) AdjustCredits(c *gin.Context) {
	user, ok := h.findUserByParam(c)
	if !ok {
		return
	}
	var req adminAdjustCreditsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}
	mode := req.Mode
	if mode == "" {
		mode = "add"
	}
	field := ""
	switch req.Tier {
	case "basic":
		field = "basic_credits"
	case "advanced":
		field = "advanced_credits"
	case "elite":
		field = "elite_credits"
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "积分类型只能是 basic / advanced / elite"})
		return
	}

	current := map[string]int{"basic_credits": user.BasicCredits, "advanced_credits": user.AdvancedCredits, "elite_credits": user.EliteCredits}[field]
	newValue := current
	switch mode {
	case "add":
		newValue = current + req.Amount
	case "set":
		newValue = req.Amount
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "调整模式只能是 add 或 set"})
		return
	}
	if newValue < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "积分不能小于 0"})
		return
	}

	if err := h.db.Model(&user).Update(field, newValue).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "调整积分失败"})
		return
	}
	h.db.First(&user, user.ID)
	c.JSON(http.StatusOK, gin.H{"user": toAdminUserResponse(user)})
}

func (h *AdminHandler) UsageSummary(c *gin.Context) {
	start := parseRangeStart(c.Query("range"))
	var requests int64
	var failures int64
	var cost float64
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ?", start).Count(&requests)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ? AND status <> ?", start, "success").Count(&failures)
	h.db.Model(&models.APIUsageLog{}).Where("created_at >= ?", start).Select("COALESCE(SUM(total_cost_rmb), 0)").Scan(&cost)
	c.JSON(http.StatusOK, gin.H{"requests": requests, "failures": failures, "cost_rmb": cost, "range_start": start})
}

func (h *AdminHandler) UsageLogs(c *gin.Context) {
	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	query := h.db.Model(&models.APIUsageLog{})
	if service := strings.TrimSpace(c.Query("service")); service != "" {
		query = query.Where("service = ?", service)
	}
	if provider := strings.TrimSpace(c.Query("provider")); provider != "" {
		query = query.Where("provider = ?", provider)
	}
	if status := strings.TrimSpace(c.Query("status")); status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	query.Count(&total)
	var logs []models.APIUsageLog
	if err := query.Order("created_at DESC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用量日志失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"logs": logs, "total": total, "page": page, "page_size": pageSize})
}

func (h *AdminHandler) Models(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"models": modelmeta.AllModels()})
}

func (h *AdminHandler) Tasks(c *gin.Context) {
	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	query := h.db.Model(&models.AIBackgroundTask{})
	if status := strings.TrimSpace(c.Query("status")); status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	query.Count(&total)
	var tasks []models.AIBackgroundTask
	if err := query.Order("created_at DESC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&tasks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询任务失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tasks": tasks, "total": total, "page": page, "page_size": pageSize})
}

func (h *AdminHandler) findUserByParam(c *gin.Context) (models.User, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "用户 ID 无效"})
		return models.User{}, false
	}
	var user models.User
	if err := h.db.First(&user, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户失败"})
		}
		return models.User{}, false
	}
	return user, true
}

func parsePositiveInt(raw string, fallback int) int {
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func parseRangeStart(raw string) time.Time {
	now := time.Now()
	switch raw {
	case "30d":
		return now.AddDate(0, 0, -30)
	case "7d":
		return now.AddDate(0, 0, -7)
	default:
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	}
}
