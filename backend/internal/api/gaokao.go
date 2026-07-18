package api

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"aipool-backend/internal/models"
	"aipool-backend/internal/services"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type GaokaoHandler struct {
	db            *gorm.DB
	service       *services.GaokaoService
	aiService     chatAIService
	searchService *services.SearchService
	usageService  *services.UsageService
}

type gaokaoAdvisorTask struct {
	ID        string      `json:"id"`
	Status    string      `json:"status"`
	Track     string      `json:"track"`
	Progress  int         `json:"progress"`
	Stage     string      `json:"stage"`
	Events    []gin.H     `json:"events"`
	Result    interface{} `json:"result,omitempty"`
	Error     string      `json:"error,omitempty"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}

var gaokaoAdvisorTasks = struct {
	sync.RWMutex
	items map[string]*gaokaoAdvisorTask
}{items: map[string]*gaokaoAdvisorTask{}}

func NewGaokaoHandler(db *gorm.DB, service *services.GaokaoService, aiService chatAIService, searchService *services.SearchService, usageService ...*services.UsageService) *GaokaoHandler {
	h := &GaokaoHandler{db: db, service: service, aiService: aiService, searchService: searchService}
	if len(usageService) > 0 {
		h.usageService = usageService[0]
	}
	return h
}

type gaokaoRecommendRequest struct {
	Province          string   `json:"province"`
	Score             int      `json:"score"`
	Rank              int      `json:"rank"`
	Subjects          string   `json:"subjects"`
	PreferredCities   []string `json:"preferred_cities"`
	PreferredMajors   []string `json:"preferred_majors"`
	RejectedMajors    []string `json:"rejected_majors"`
	SchoolType        string   `json:"school_type"`
	TuitionLimit      int      `json:"tuition_limit"`
	AcceptCooperation bool     `json:"accept_cooperation"`
	ObeyAdjustment    bool     `json:"obey_adjustment"`
	Strategy          string   `json:"strategy"`
}

type gaokaoGuideRequest struct {
	Mode    string              `json:"mode"`
	Answers map[string][]string `json:"answers"`
}

func (h *GaokaoHandler) Guide(c *gin.Context) {
	var req gaokaoGuideRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if h.aiService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AIService 未注入"})
		return
	}
	payload, _ := json.MarshalIndent(req.Answers, "", "  ")
	mode := strings.TrimSpace(req.Mode)
	focus := "综合推荐：只输出城市×专业×学校层次×风险策略的组合建议。"
	if strings.Contains(mode, "城市") {
		focus = "城市推荐：只输出城市/区域建议，不要给专业推荐和综合填报方案。"
	} else if strings.Contains(mode, "专业") {
		focus = "专业推荐：只输出专业方向建议，不要给城市推荐和综合填报方案。"
	}
	prompt := fmt.Sprintf(`你是高考志愿规划顾问。用户正在填写%s问卷，请基于答案生成专属建议。
核心边界：%s
硬性要求：
1. 只返回严格 JSON，不要 Markdown，不要代码块，不要链接 URL，不要 utm_source/openai 等乱码。
2. JSON schema：{"title":"","summary":"","table_columns":[""],"table_rows":[{"name":"","score":0,"cells":[""]}],"bar_chart":{"title":"","items":[{"label":"","value":0}]},"pie_chart":{"title":"","items":[{"label":"","value":0}]},"trend_chart":{"title":"","items":[{"label":"","value":0}]},"next_steps":[""]}。
3. table_rows 至少 6 行，score 0-100；cells 数量必须等于 table_columns 数量。
4. bar_chart 用于匹配度，pie_chart 用于因素权重，trend_chart 用于长期发展/风险趋势。
5. 内容要具体、全面、可执行，但不要混入其它入口类型的结果。

问卷答案 JSON：
%s`, mode, focus, string(payload))
	ctx, cancel := context.WithTimeout(c.Request.Context(), 300_000_000_000)
	defer cancel()
	text, err := callCliproxyChatText(ctx, "gpt-5.5", []services.Message{{Role: "system", Content: "你是专业高考志愿规划师，回答清晰具体。"}, {Role: "user", Content: prompt}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	clean := extractGaokaoAIJSONObject(text)
	var guide any
	if err := json.Unmarshal([]byte(clean), &guide); err != nil {
		c.JSON(http.StatusOK, gin.H{"markdown": strings.TrimSpace(text)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"guide": guide})
}

func (h *GaokaoHandler) Recommend(c *gin.Context) {
	var req gaokaoRecommendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	if req.Rank <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写有效的全省位次"})
		return
	}
	profile := services.GaokaoProfile{
		Province: strings.TrimSpace(req.Province), Score: req.Score, Rank: req.Rank, Subjects: strings.TrimSpace(req.Subjects),
		PreferredCities: cleanStringList(req.PreferredCities), PreferredMajors: cleanStringList(req.PreferredMajors), RejectedMajors: cleanStringList(req.RejectedMajors),
		SchoolType: strings.TrimSpace(req.SchoolType), TuitionLimit: req.TuitionLimit, AcceptCooperation: req.AcceptCooperation, ObeyAdjustment: req.ObeyAdjustment, Strategy: strings.TrimSpace(req.Strategy),
	}
	result, err := h.service.Recommend(profile)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成志愿推荐失败"})
		return
	}
	c.JSON(http.StatusOK, result)
}

type gaokaoAdvisorRequest struct {
	Profile        gaokaoRecommendRequest `json:"profile"`
	Message        string                 `json:"message"`
	AllowWebLookup bool                   `json:"allow_web_lookup"`
	Model          string                 `json:"model"`
	Track          string                 `json:"track"`
}

func (h *GaokaoHandler) usageRecorder(c *gin.Context) gaokaoReportUsageRecorder {
	var userID uint
	if raw, ok := c.Get("userID"); ok {
		if v, ok := raw.(uint); ok {
			userID = v
		}
	}
	return gaokaoReportUsageRecorder{usageService: h.usageService, userID: userID, guestID: getGuestID(c), requestID: c.GetHeader("X-Request-ID")}
}

func (h *GaokaoHandler) Advisor(c *gin.Context) {
	var req gaokaoAdvisorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	profile := services.GaokaoProfile{
		Province: strings.TrimSpace(req.Profile.Province), Score: req.Profile.Score, Rank: req.Profile.Rank, Subjects: strings.TrimSpace(req.Profile.Subjects),
		PreferredCities: cleanStringList(req.Profile.PreferredCities), PreferredMajors: cleanStringList(req.Profile.PreferredMajors), RejectedMajors: cleanStringList(req.Profile.RejectedMajors),
		SchoolType: strings.TrimSpace(req.Profile.SchoolType), TuitionLimit: req.Profile.TuitionLimit, AcceptCooperation: req.Profile.AcceptCooperation, ObeyAdjustment: req.Profile.ObeyAdjustment, Strategy: strings.TrimSpace(req.Profile.Strategy),
	}
	if profile.Rank <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写有效的全省位次"})
		return
	}
	result, err := h.service.Recommend(profile)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 Advisor 推荐失败"})
		return
	}
	track := strings.TrimSpace(req.Track)
	recommendations := services.FilterGaokaoRecommendationsByTrack(result.Recommendations, track)
	message := strings.TrimSpace(req.Message)
	advisor := services.BuildGaokaoAdvisorResponse(profile, message, recommendations)
	provider := strings.TrimSpace(req.Model)
	if provider == "" {
		provider = "committee"
	}
	shouldLookup := req.AllowWebLookup
	if shouldLookup {
		advisor.NeedsWebLookup = advisor.NeedsWebLookup || len(advisor.LocalRecommendations) == 0
		if len(advisor.WebLookupPlan) == 0 {
			advisor.WebLookupPlan = []string{fmt.Sprintf("补查%s%s位次%d的%s批次院校和招生计划", profile.Province, profile.Subjects, profile.Rank, strings.TrimSpace(req.Track))}
		}
		lookupCtx, cancel := context.WithTimeout(c.Request.Context(), 10_000_000_000)
		advisor.ExternalSourceHits = services.LookupGaokaoAdvisorSources(lookupCtx, profile, message)
		advisor.EvidenceLinks = services.BuildGaokaoAdvisorEvidenceLinks(advisor.ExternalSourceHits)
		advisor.ExternalCandidates = services.ExtractGaokaoAdvisorExternalCandidates(lookupCtx, profile, advisor.ExternalSourceHits)
		advisor.ExternalCandidatePlan = services.BuildGaokaoExternalCandidatePlan(profile, advisor.ExternalCandidates)
		advisor.ExternalCandidatePlan = services.FilterGaokaoExternalCandidatePlanByTrack(advisor.ExternalCandidatePlan, strings.TrimSpace(req.Track))
		advisor.AdvisorPlanSections = services.BuildGaokaoAdvisorPlanSectionsForTrack(profile, advisor.ExternalCandidatePlan, advisor.EvidenceLinks, strings.TrimSpace(req.Track))
		cancel()
		advisor.ModelNote += " 已执行少量联网来源发现、文本抽取和待复核方案分层；结果不写库、不混入正式推荐。"
	}
	modelRecommendations := recommendations
	if len(modelRecommendations) == 0 {
		modelRecommendations = append(modelRecommendations, services.BuildGaokaoProfessionalSeedRecommendations(profile)...)
		modelRecommendations = append(modelRecommendations, services.ExternalCandidatePlanToGaokaoRecommendations(profile, advisor.ExternalCandidatePlan)...)
	}
	advisor.ProfessionalReport = services.BuildGaokaoProfessionalReport(profile, modelRecommendations, advisor.EvidenceLinks)
	advisor.FinalReportMarkdown = services.BuildGaokaoFinalReportMarkdown(profile, "", advisor.ProfessionalReport, advisor.EvidenceLinks)
	if strings.ToLower(provider) != "none" {
		reportCtx, cancel := context.WithTimeout(c.Request.Context(), 480_000_000_000)
		var md, status string
		var aiErr error
		switch {
		case strings.EqualFold(provider, "committee_v2"):
			md, status, aiErr = generateGaokaoReportWithMultiCandidateV2(reportCtx, h.aiService, h.searchService, h.usageRecorder(c), profile, message, track, modelRecommendations, advisor.EvidenceLinks)
		case strings.EqualFold(provider, "committee_clip"):
			md, status, aiErr = generateGaokaoReportWithCliproxyCommittee(reportCtx, h.aiService, h.searchService, h.usageRecorder(c), profile, message, track, modelRecommendations, advisor.EvidenceLinks)
		default:
			md, status, aiErr = generateGaokaoReportWithAIService(reportCtx, h.aiService, h.searchService, h.usageRecorder(c), profile, message, track, modelRecommendations, advisor.EvidenceLinks)
		}
		if aiErr == nil && strings.TrimSpace(md) != "" {
			advisor.FinalReportMarkdown = md
			advisor.ModelStatus = status
			advisor.ModelNote = "已通过统一 AIService 生成：GPT-5.5联网生成候选和数据 → DeepSeek生成逐校搜索查询并联网复核/补充学校 → 后端执行结构化结果 → GPT-5.5联网整理终稿 → 全文后检。"
		} else if status == "postcheck_failed" || status == "deepseek_web_verify_failed" {
			advisor.ModelStatus = status
			advisor.ModelNote = "AIService/DeepSeek 复核未通过，未展示未核验推荐：" + aiErr.Error()
			advisor.FinalReportMarkdown = "# 高考志愿规划报告\n\nDeepSeek 联网逐校复核未能确认足够的明确最低位次，因此本次不输出院校推荐表。\n\n请稍后重试，或补充考试院/高校招生网的官方投档表后再生成。"
		} else if md, status, err := services.GenerateGaokaoFinalReportMarkdown(reportCtx, profile, message, track, modelRecommendations, advisor.EvidenceLinks); err == nil && strings.TrimSpace(md) != "" {
			advisor.FinalReportMarkdown = md
			advisor.ModelStatus = status
			advisor.ModelNote = "统一 AIService 不可用，已使用旧模型终稿兜底。"
		} else if err != nil {
			advisor.ModelNote = "模型终稿生成失败，已展示结构化兜底报告：" + err.Error()
		}
		cancel()
	}
	c.JSON(http.StatusOK, advisor)
}

func (h *GaokaoHandler) AdvisorTaskStart(c *gin.Context) {
	var req gaokaoAdvisorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	id := fmt.Sprintf("gaokao-%d", time.Now().UnixNano())
	task := &gaokaoAdvisorTask{ID: id, Status: "running", Track: strings.TrimSpace(req.Track), Progress: 8, Stage: "整理需求", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	gaokaoAdvisorTasks.Lock()
	gaokaoAdvisorTasks.items[id] = task
	gaokaoAdvisorTasks.Unlock()
	go h.runAdvisorTask(id, req, h.usageRecorder(c))
	c.JSON(http.StatusOK, gin.H{"task_id": id, "status": "running"})
}

func (h *GaokaoHandler) AdvisorTaskGet(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	gaokaoAdvisorTasks.RLock()
	task := gaokaoAdvisorTasks.items[id]
	gaokaoAdvisorTasks.RUnlock()
	if task == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在或已过期"})
		return
	}
	c.JSON(http.StatusOK, task)
}

func updateGaokaoAdvisorTask(id, status, stage string, progress int, event gin.H, result interface{}, errText string) {
	gaokaoAdvisorTasks.Lock()
	defer gaokaoAdvisorTasks.Unlock()
	task := gaokaoAdvisorTasks.items[id]
	if task == nil {
		return
	}
	if status != "" {
		task.Status = status
	}
	if stage != "" {
		task.Stage = stage
	}
	if progress > task.Progress {
		task.Progress = progress
	}
	if event != nil {
		task.Events = append(task.Events, event)
		if len(task.Events) > 30 {
			task.Events = task.Events[len(task.Events)-30:]
		}
	}
	if result != nil {
		task.Result = result
	}
	if errText != "" {
		task.Error = errText
	}
	task.UpdatedAt = time.Now()
}

func (h *GaokaoHandler) runAdvisorTask(id string, req gaokaoAdvisorRequest, usageRecorder gaokaoReportUsageRecorder) {
	emit := func(stage string, progress int, text string) {
		updateGaokaoAdvisorTask(id, "running", stage, progress, gin.H{"text": text, "at": time.Now()}, nil, "")
	}
	profile := services.GaokaoProfile{Province: strings.TrimSpace(req.Profile.Province), Score: req.Profile.Score, Rank: req.Profile.Rank, Subjects: strings.TrimSpace(req.Profile.Subjects), PreferredCities: cleanStringList(req.Profile.PreferredCities), PreferredMajors: cleanStringList(req.Profile.PreferredMajors), RejectedMajors: cleanStringList(req.Profile.RejectedMajors), SchoolType: strings.TrimSpace(req.Profile.SchoolType), TuitionLimit: req.Profile.TuitionLimit, AcceptCooperation: req.Profile.AcceptCooperation, ObeyAdjustment: req.Profile.ObeyAdjustment, Strategy: strings.TrimSpace(req.Profile.Strategy)}
	if profile.Rank <= 0 {
		updateGaokaoAdvisorTask(id, "error", "生成失败", 100, nil, nil, "请填写有效的全省位次")
		return
	}
	emit("整理需求", 16, "理解档案和偏好")
	result, err := h.service.Recommend(profile)
	if err != nil {
		updateGaokaoAdvisorTask(id, "error", "生成失败", 100, nil, nil, "生成 Advisor 推荐失败")
		return
	}
	track := strings.TrimSpace(req.Track)
	message := strings.TrimSpace(req.Message)
	recommendations := services.FilterGaokaoRecommendationsByTrack(result.Recommendations, track)
	emit("整理需求", 28, fmt.Sprintf("本地候选 %d 个", len(recommendations)))
	advisor := services.BuildGaokaoAdvisorResponse(profile, message, recommendations)
	if req.AllowWebLookup {
		emit("整理需求", 36, "开始联网补查")
		lookupCtx, cancel := context.WithTimeout(context.Background(), 30_000_000_000)
		advisor.ExternalSourceHits = services.LookupGaokaoAdvisorSources(lookupCtx, profile, message)
		advisor.EvidenceLinks = services.BuildGaokaoAdvisorEvidenceLinks(advisor.ExternalSourceHits)
		advisor.ExternalCandidates = services.ExtractGaokaoAdvisorExternalCandidates(lookupCtx, profile, advisor.ExternalSourceHits)
		advisor.ExternalCandidatePlan = services.BuildGaokaoExternalCandidatePlan(profile, advisor.ExternalCandidates)
		advisor.ExternalCandidatePlan = services.FilterGaokaoExternalCandidatePlanByTrack(advisor.ExternalCandidatePlan, track)
		advisor.AdvisorPlanSections = services.BuildGaokaoAdvisorPlanSectionsForTrack(profile, advisor.ExternalCandidatePlan, advisor.EvidenceLinks, track)
		cancel()
		emit("生成初稿", 56, "联网候选和来源已整理")
	}
	modelRecommendations := recommendations
	if len(modelRecommendations) == 0 {
		modelRecommendations = append(modelRecommendations, services.BuildGaokaoProfessionalSeedRecommendations(profile)...)
		modelRecommendations = append(modelRecommendations, services.ExternalCandidatePlanToGaokaoRecommendations(profile, advisor.ExternalCandidatePlan)...)
	}
	advisor.ProfessionalReport = services.BuildGaokaoProfessionalReport(profile, modelRecommendations, advisor.EvidenceLinks)
	advisor.FinalReportMarkdown = services.BuildGaokaoFinalReportMarkdown(profile, "", advisor.ProfessionalReport, advisor.EvidenceLinks)
	emit("复核报告", 68, "正在生成正式报告")
	provider := strings.TrimSpace(req.Model)
	if provider == "" {
		provider = "committee"
	}
	if strings.ToLower(provider) != "none" {
		reportCtx, cancel := context.WithTimeout(context.Background(), 480_000_000_000)
		var md, status string
		var aiErr error
		switch {
		case strings.EqualFold(provider, "committee_v2"):
			md, status, aiErr = generateGaokaoReportWithMultiCandidateV2(reportCtx, h.aiService, h.searchService, usageRecorder, profile, message, track, modelRecommendations, advisor.EvidenceLinks)
		case strings.EqualFold(provider, "committee_clip"):
			md, status, aiErr = generateGaokaoReportWithCliproxyCommittee(reportCtx, h.aiService, h.searchService, usageRecorder, profile, message, track, modelRecommendations, advisor.EvidenceLinks)
		default:
			md, status, aiErr = generateGaokaoReportWithAIService(reportCtx, h.aiService, h.searchService, usageRecorder, profile, message, track, modelRecommendations, advisor.EvidenceLinks)
		}
		if aiErr == nil && strings.TrimSpace(md) != "" {
			advisor.FinalReportMarkdown = md
			advisor.ModelStatus = status
			advisor.ModelNote = "后台任务已通过统一 AIService 生成终稿。"
		} else if md, status, err := services.GenerateGaokaoFinalReportMarkdown(reportCtx, profile, message, track, modelRecommendations, advisor.EvidenceLinks); err == nil && strings.TrimSpace(md) != "" {
			advisor.FinalReportMarkdown = md
			advisor.ModelStatus = status
			advisor.ModelNote = "后台任务使用旧模型终稿兜底。"
		}
		cancel()
	}
	emit("生成终稿", 96, "报告已生成")
	updateGaokaoAdvisorTask(id, "done", "生成完成", 100, gin.H{"text": "完成", "at": time.Now()}, advisor, "")
}

func (h *GaokaoHandler) AdvisorStream(c *gin.Context) {
	var req gaokaoAdvisorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	profile := services.GaokaoProfile{
		Province: strings.TrimSpace(req.Profile.Province), Score: req.Profile.Score, Rank: req.Profile.Rank, Subjects: strings.TrimSpace(req.Profile.Subjects),
		PreferredCities: cleanStringList(req.Profile.PreferredCities), PreferredMajors: cleanStringList(req.Profile.PreferredMajors), RejectedMajors: cleanStringList(req.Profile.RejectedMajors),
		SchoolType: strings.TrimSpace(req.Profile.SchoolType), TuitionLimit: req.Profile.TuitionLimit, AcceptCooperation: req.Profile.AcceptCooperation, ObeyAdjustment: req.Profile.ObeyAdjustment, Strategy: strings.TrimSpace(req.Profile.Strategy),
	}
	if profile.Rank <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写有效的全省位次"})
		return
	}
	message := strings.TrimSpace(req.Message)
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	flusher, _ := c.Writer.(http.Flusher)
	emit := func(event string, payload interface{}) {
		_, _ = c.Writer.Write([]byte(services.EncodeGaokaoAdvisorSSEEvent(event, payload)))
		if flusher != nil {
			flusher.Flush()
		}
	}
	emit("intent", gin.H{"province": profile.Province, "subjects": profile.Subjects, "rank": profile.Rank, "message": message})
	result, err := h.service.Recommend(profile)
	if err != nil {
		emit("error", gin.H{"message": "生成 Advisor 推荐失败"})
		return
	}
	track := strings.TrimSpace(req.Track)
	recommendations := services.FilterGaokaoRecommendationsByTrack(result.Recommendations, track)
	emit("local_recommendations", gin.H{"count": len(recommendations), "needs_web_lookup": result.NeedsModelLookup || len(recommendations) == 0, "note": result.DataSourceNote})
	advisor := services.BuildGaokaoAdvisorResponse(profile, message, recommendations)
	provider := strings.TrimSpace(req.Model)
	if provider == "" {
		provider = "committee"
	}
	shouldLookup := req.AllowWebLookup
	if shouldLookup {
		advisor.NeedsWebLookup = advisor.NeedsWebLookup || len(advisor.LocalRecommendations) == 0
		if len(advisor.WebLookupPlan) == 0 {
			advisor.WebLookupPlan = []string{fmt.Sprintf("补查%s%s位次%d的%s批次院校和招生计划", profile.Province, profile.Subjects, profile.Rank, strings.TrimSpace(req.Track))}
		}
		emit("search_started", gin.H{"queries": advisor.WebLookupPlan})
		lookupCtx, cancel := context.WithTimeout(c.Request.Context(), 12_000_000_000)
		advisor.ExternalSourceHits = services.LookupGaokaoAdvisorSources(lookupCtx, profile, message)
		advisor.EvidenceLinks = services.BuildGaokaoAdvisorEvidenceLinks(advisor.ExternalSourceHits)
		emit("source_hits", gin.H{"count": len(advisor.ExternalSourceHits), "items": advisor.ExternalSourceHits})
		emit("evidence_links", gin.H{"count": len(advisor.EvidenceLinks), "items": advisor.EvidenceLinks})
		advisor.ExternalCandidates = services.ExtractGaokaoAdvisorExternalCandidates(lookupCtx, profile, advisor.ExternalSourceHits)
		emit("external_candidates", gin.H{"count": len(advisor.ExternalCandidates), "items": advisor.ExternalCandidates})
		advisor.ExternalCandidatePlan = services.BuildGaokaoExternalCandidatePlan(profile, advisor.ExternalCandidates)
		advisor.ExternalCandidatePlan = services.FilterGaokaoExternalCandidatePlanByTrack(advisor.ExternalCandidatePlan, strings.TrimSpace(req.Track))
		advisor.AdvisorPlanSections = services.BuildGaokaoAdvisorPlanSectionsForTrack(profile, advisor.ExternalCandidatePlan, advisor.EvidenceLinks, strings.TrimSpace(req.Track))
		emit("external_candidate_plan", advisor.ExternalCandidatePlan)
		emit("advisor_plan_sections", gin.H{"count": len(advisor.AdvisorPlanSections), "items": advisor.AdvisorPlanSections})
		cancel()
		advisor.ModelNote += " 已执行少量联网来源发现、文本抽取和待复核方案分层；结果不写库、不混入正式推荐。"
	}
	modelRecommendations := recommendations
	if len(modelRecommendations) == 0 {
		modelRecommendations = append(modelRecommendations, services.BuildGaokaoProfessionalSeedRecommendations(profile)...)
		modelRecommendations = append(modelRecommendations, services.ExternalCandidatePlanToGaokaoRecommendations(profile, advisor.ExternalCandidatePlan)...)
	}
	advisor.ProfessionalReport = services.BuildGaokaoProfessionalReport(profile, modelRecommendations, advisor.EvidenceLinks)
	advisor.FinalReportMarkdown = services.BuildGaokaoFinalReportMarkdown(profile, "", advisor.ProfessionalReport, advisor.EvidenceLinks)
	emit("professional_report", advisor.ProfessionalReport)
	if strings.ToLower(provider) != "none" {
		emit("report_generating", gin.H{"stage": "生成候选、逐校搜索并硬过滤", "progress": 68})
		reportCtx, cancel := context.WithTimeout(c.Request.Context(), 480_000_000_000)
		var md, status string
		var aiErr error
		switch {
		case strings.EqualFold(provider, "committee_v2"):
			md, status, aiErr = generateGaokaoReportWithMultiCandidateV2(reportCtx, h.aiService, h.searchService, h.usageRecorder(c), profile, message, track, modelRecommendations, advisor.EvidenceLinks)
		case strings.EqualFold(provider, "committee_clip"):
			md, status, aiErr = generateGaokaoReportWithCliproxyCommittee(reportCtx, h.aiService, h.searchService, h.usageRecorder(c), profile, message, track, modelRecommendations, advisor.EvidenceLinks)
		default:
			md, status, aiErr = generateGaokaoReportWithAIService(reportCtx, h.aiService, h.searchService, h.usageRecorder(c), profile, message, track, modelRecommendations, advisor.EvidenceLinks)
		}
		if aiErr == nil && strings.TrimSpace(md) != "" {
			advisor.FinalReportMarkdown = md
			advisor.ModelStatus = status
			advisor.ModelNote = "已通过统一 AIService 生成：GPT-5.5联网生成候选和数据 → DeepSeek生成逐校搜索查询并联网复核/补充学校 → 后端执行结构化结果 → GPT-5.5联网整理终稿 → 全文后检。"
		} else if status == "postcheck_failed" || status == "deepseek_web_verify_failed" {
			advisor.ModelStatus = status
			advisor.ModelNote = "AIService/DeepSeek 复核未通过，未展示未核验推荐：" + aiErr.Error()
			advisor.FinalReportMarkdown = "# 高考志愿规划报告\n\nDeepSeek 联网逐校复核未能确认足够的明确最低位次，因此本次不输出院校推荐表。\n\n请稍后重试，或补充考试院/高校招生网的官方投档表后再生成。"
		} else if md, status, err := services.GenerateGaokaoFinalReportMarkdown(reportCtx, profile, message, track, modelRecommendations, advisor.EvidenceLinks); err == nil && strings.TrimSpace(md) != "" {
			advisor.FinalReportMarkdown = md
			advisor.ModelStatus = status
			advisor.ModelNote = "统一 AIService 不可用，已使用旧模型终稿兜底。"
		} else if err != nil {
			advisor.ModelNote = "模型终稿生成失败，已展示结构化兜底报告：" + err.Error()
		}
		cancel()
	}
	emit("final_report_markdown", gin.H{"markdown": advisor.FinalReportMarkdown})
	emit("plan_ready", gin.H{"plans": advisor.FinalPlans, "analysis": advisor.AgentAnalysis})
	emit("done", advisor)
}

func runGaokaoAdvisorModelCommittee(parent context.Context, requested string, profile services.GaokaoProfile, message string, recs []services.GaokaoRecommendation, emit func(string, interface{})) []services.GaokaoAdvisorModelReport {
	tasks := advisorCommitteeTasks(requested)
	reports := []services.GaokaoAdvisorModelReport{}
	for _, task := range tasks {
		provider, role := task[0], task[1]
		if emit != nil {
			emit("model_started", gin.H{"provider": provider, "role": role})
		}
		ctx, cancel := context.WithTimeout(parent, 12_000_000_000)
		analysis, status, err := services.CallGaokaoAdvisorModel(ctx, provider, profile, message, recs)
		cancel()
		report := services.GaokaoAdvisorModelReport{Provider: provider, Role: role, Status: status, Analysis: analysis}
		if err != nil {
			report.Error = err.Error()
		}
		reports = append(reports, report)
		if emit != nil {
			if err != nil {
				emit("model_error", gin.H{"provider": provider, "role": role, "status": status, "message": err.Error()})
			} else {
				emit("model_report", report)
			}
		}
	}
	return reports
}

func advisorCommitteeTasks(requested string) [][2]string {
	switch strings.ToLower(strings.TrimSpace(requested)) {
	case "deepseek", "openai", "kimi", "moonshot", "gemini":
		return [][2]string{{strings.ToLower(strings.TrimSpace(requested)), "single"}}
	default:
		return [][2]string{{"deepseek", "ranking_risk"}, {"openai", "final_explanation"}}
	}
}

func summarizeGaokaoAdvisorModelReports(reports []services.GaokaoAdvisorModelReport) string {
	called, failed := 0, 0
	providers := []string{}
	for _, report := range reports {
		if strings.HasPrefix(report.Status, "called") || report.Status == "called" {
			called++
			providers = append(providers, report.Provider)
		} else {
			failed++
		}
	}
	if called == 0 {
		return fmt.Sprintf("committee:error:%d", failed)
	}
	return fmt.Sprintf("committee:called:%d failed:%d providers:%s", called, failed, strings.Join(providers, ","))
}

type gaokaoVolunteerTableRequest struct {
	Profile         gaokaoRecommendRequest          `json:"profile"`
	Recommendations []services.GaokaoRecommendation `json:"recommendations"`
	TotalSlots      int                             `json:"total_slots"`
}

func (h *GaokaoHandler) VolunteerTable(c *gin.Context) {
	var req gaokaoVolunteerTableRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	profile := services.GaokaoProfile{
		Province: strings.TrimSpace(req.Profile.Province), Score: req.Profile.Score, Rank: req.Profile.Rank, Subjects: strings.TrimSpace(req.Profile.Subjects),
		PreferredCities: cleanStringList(req.Profile.PreferredCities), PreferredMajors: cleanStringList(req.Profile.PreferredMajors), RejectedMajors: cleanStringList(req.Profile.RejectedMajors),
		SchoolType: strings.TrimSpace(req.Profile.SchoolType), TuitionLimit: req.Profile.TuitionLimit, AcceptCooperation: req.Profile.AcceptCooperation, ObeyAdjustment: req.Profile.ObeyAdjustment, Strategy: strings.TrimSpace(req.Profile.Strategy),
	}
	recommendations := req.Recommendations
	if len(recommendations) == 0 {
		result, err := h.service.Recommend(profile)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "生成志愿推荐失败"})
			return
		}
		recommendations = result.Recommendations
	}
	total := req.TotalSlots
	if total <= 0 {
		total = services.GaokaoVolunteerRuleForProvince(profile.Province).DefaultSlots
	}
	if total > 112 {
		total = 112
	}
	table := services.BuildGaokaoVolunteerTable(profile, recommendations, total)
	services.EnrichGaokaoVolunteerTableGroups(profile, &table, h.loadMajorGroupsForVolunteerTable(profile, table))
	c.JSON(http.StatusOK, table)
}

func (h *GaokaoHandler) loadMajorGroupsForVolunteerTable(profile services.GaokaoProfile, table services.GaokaoVolunteerTableResult) map[string][]string {
	out := map[string][]string{}
	seen := map[string]bool{}
	if len(table.Items) == 0 {
		return out
	}
	for _, item := range table.Items {
		var rows []struct {
			School     string
			MajorGroup string
			Major      string
		}
		q := h.db.Table("gaokao_admission_records ar").
			Select("s.name as school, ar.major_group as major_group, m.name as major").
			Joins("join gaokao_schools s on s.id = ar.school_id").
			Joins("join gaokao_majors m on m.id = ar.major_id").
			Where("ar.source_province = ? AND s.name = ? AND ar.major_group = ? AND m.name <> ?", profile.Province, item.School, item.MajorGroup, "院校投档线")
		if item.Year > 0 {
			q = q.Where("ar.year = ?", item.Year)
		}
		if err := q.Group("s.name, ar.major_group, m.name").Order("m.name asc").Find(&rows).Error; err != nil {
			continue
		}
		for _, row := range rows {
			key := row.School + "::" + row.MajorGroup
			seenKey := key + "::" + row.Major
			if row.Major == "" || seen[seenKey] {
				continue
			}
			seen[seenKey] = true
			out[key] = append(out[key], row.Major)
		}
	}
	return out
}

func cleanStringList(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		for _, part := range strings.FieldsFunc(value, func(r rune) bool {
			return r == ',' || r == '，' || r == '、' || r == '/' || r == ' ' || r == '\n' || r == '\t'
		}) {
			part = strings.TrimSpace(part)
			if part != "" {
				out = append(out, part)
			}
		}
	}
	return out
}

type gaokaoSavePlanRequest struct {
	Title           string                 `json:"title"`
	Profile         map[string]interface{} `json:"profile"`
	Recommendations []interface{}          `json:"recommendations"`
	Summary         string                 `json:"summary"`
}

func (h *GaokaoHandler) SavePlan(c *gin.Context) {
	rawUserID, ok := c.Get("userID")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	userID := rawUserID.(uint)
	var req gaokaoSavePlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	profileJSON, _ := json.Marshal(req.Profile)
	recsJSON, _ := json.Marshal(req.Recommendations)
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "高考志愿方案"
	}
	plan := models.GaokaoPlan{UserID: userID, Title: title, ProfileJSON: string(profileJSON), Recommendations: string(recsJSON), Summary: strings.TrimSpace(req.Summary)}
	if v, ok := req.Profile["province"].(string); ok {
		plan.Province = strings.TrimSpace(v)
	}
	if v, ok := req.Profile["subjects"].(string); ok {
		plan.Subjects = strings.TrimSpace(v)
	}
	if v, ok := req.Profile["strategy"].(string); ok {
		plan.Strategy = strings.TrimSpace(v)
	}
	plan.Score = intFromProfile(req.Profile["score"])
	plan.Rank = intFromProfile(req.Profile["rank"])
	if err := h.db.Create(&plan).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存志愿方案失败"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": plan.ID, "title": plan.Title, "created_at": plan.CreatedAt})
}

func (h *GaokaoHandler) ListPlans(c *gin.Context) {
	rawUserID, ok := c.Get("userID")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	userID := rawUserID.(uint)
	limit := 20
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 100 {
		limit = v
	}
	var plans []models.GaokaoPlan
	if err := h.db.Where("user_id = ?", userID).Order("updated_at DESC, id DESC").Limit(limit).Find(&plans).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取方案列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": plans})
}

func (h *GaokaoHandler) GetPlan(c *gin.Context) {
	rawUserID, ok := c.Get("userID")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	if id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的方案 ID"})
		return
	}
	var plan models.GaokaoPlan
	if err := h.db.Where("id = ? AND user_id = ?", uint(id), rawUserID.(uint)).First(&plan).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "方案不存在"})
		return
	}
	var profile map[string]interface{}
	var recs []interface{}
	_ = json.Unmarshal([]byte(plan.ProfileJSON), &profile)
	_ = json.Unmarshal([]byte(plan.Recommendations), &recs)
	c.JSON(http.StatusOK, gin.H{"id": plan.ID, "title": plan.Title, "profile": profile, "recommendations": recs, "summary": plan.Summary, "created_at": plan.CreatedAt, "updated_at": plan.UpdatedAt})
}

type gaokaoAgentAdjustRequest struct {
	Command string                 `json:"command"`
	Profile map[string]interface{} `json:"profile"`
	Track   string                 `json:"track"`
	History []services.Message     `json:"history"`
}

func (h *GaokaoHandler) AgentAdjust(c *gin.Context) {
	var req gaokaoAgentAdjustRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	command := strings.TrimSpace(req.Command)
	profile, patch, actions := gaokaoAgentProfilePatch(command, req.Profile)
	shouldGenerate := gaokaoAgentShouldGenerate(command)
	reply := "可以，我们先聊清楚目标。我会根据你的表达继续追问和记录偏好；等你说“按这个生成报告”或“重写报告”时，我再正式生成右侧文档。"
	if len(actions) > 0 && shouldGenerate {
		reply = strings.Join(actions, "") + "我会基于新条件重新生成方案卡片。"
	} else if len(actions) > 0 {
		reply = strings.Join(actions, "") + "我已先记录这些偏好，暂不重写报告。你可以继续补充城市、专业、预算、风险偏好；确认后说“按这个生成报告”。"
	} else if shouldGenerate {
		reply = "收到，我会按当前已确认条件生成右侧志愿报告。"
	}
	if len(actions) == 0 && !shouldGenerate && h.aiService != nil {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 60_000_000_000)
		defer cancel()
		historyJSON, _ := json.Marshal(req.History)
		track := strings.TrimSpace(req.Track)
		if track == "" {
			track = "本科"
		}
		prompt := fmt.Sprintf("你是高考志愿咨询Agent。当前专项=%s。当前不是生成报告阶段，只和用户聊天、澄清目标、追问关键信息，不要输出长报告。必须记住并延续聊天历史，不要刚问过又忘。若专项是专科，就只围绕高考专科批/高职高专路径，不能切到已在读专科/已毕业专科咨询，也不要主动问是否已读专科；专升本只能作为专科入学后的后续升学路径讨论。当前档案：%v\n聊天历史JSON：%s\n用户说：%s", track, profile, string(historyJSON), command)
		if text, err := callGaokaoAITextWithSearchContext(ctx, h.aiService, h.searchService, "gpt-5.5", []services.Message{{Role: "system", Content: "你是高考志愿咨询Agent，先聊天澄清，不直接生成报告；必须延续上下文。专科专项只讨论高考专科批路径和后续专升本可能。"}, {Role: "user", Content: prompt}}, false); err == nil && strings.TrimSpace(text) != "" {
			reply = strings.TrimSpace(text)
		}
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile, "profile_patch": patch, "rerun_advisor": shouldGenerate, "advisor_message": command, "reply": reply})
}

func gaokaoAgentShouldGenerate(command string) bool {
	return gaokaoContainsAny(command, "生成报告", "生成方案", "出方案", "出报告", "重写报告", "重新生成", "按这个生成", "按这个出", "开始生成", "确认生成", "就这样生成", "可以生成了")
}

func gaokaoAgentProfilePatch(command string, input map[string]interface{}) (map[string]interface{}, map[string]interface{}, []string) {
	profile := map[string]interface{}{}
	for k, v := range input {
		profile[k] = v
	}
	patch := map[string]interface{}{}
	actions := []string{}
	set := func(key string, value interface{}, action string) {
		profile[key] = value
		patch[key] = value
		if action != "" {
			actions = append(actions, action)
		}
	}
	if gaokaoContainsAny(command, "只看公办", "不要民办", "排除民办", "不考虑民办") {
		set("schoolType", "只看公办", "已切换为只看公办。")
		set("acceptCooperation", false, "已排除中外合作/高学费合作项目。")
	}
	if strings.Contains(command, "中外合作") && gaokaoContainsAny(command, "接受", "可以", "加入", "看看") {
		set("acceptCooperation", true, "已允许中外合作项目进入备选。")
		set("schoolType", "公办优先", "已切换为公办优先。")
	}
	if gaokaoContainsAny(command, "保守", "更稳", "安全", "保底") {
		set("strategy", "safe", "已切换为稳妥保录策略。")
	}
	if gaokaoContainsAny(command, "激进", "大胆", "冲") {
		set("strategy", "aggressive", "已切换为冲刺优先策略。")
	}
	if gaokaoContainsAny(command, "专业优先", "计算机", "软件", "电子", "自动化", "通信") {
		set("strategy", "major", "已切换为专业优先策略。")
		majors := mergeTextList(fmt.Sprint(profile["preferredMajors"]), command, []string{"计算机", "软件工程", "电子信息", "自动化", "通信"})
		set("preferredMajors", majors, "已扩展相近工科专业池。")
	}
	if gaokaoContainsAny(command, "城市优先", "广州", "深圳", "杭州", "南京", "上海", "北京", "成都", "苏州", "湖南", "长沙") {
		set("strategy", "city", "已切换为城市/地域优先策略。")
		cities := mergeTextList(fmt.Sprint(profile["preferredCities"]), command, []string{"广州", "深圳", "杭州", "南京", "上海", "北京", "成都", "苏州", "湖南", "长沙"})
		set("preferredCities", cities, "已更新城市/地域偏好。")
	}
	if gaokaoContainsAny(command, "可以接受专科", "接受专科", "专科兜底", "考虑专科") {
		set("allowCollegeFallback", true, "已加入专科兜底预案。")
	}
	if gaokaoContainsAny(command, "不要专科", "不接受专科", "只要本科") {
		set("allowCollegeFallback", false, "已关闭专科兜底。")
	}
	if gaokaoContainsAny(command, "不要", "去掉", "排除", "不想") {
		rejected := mergeTextList(fmt.Sprint(profile["rejectedMajors"]), command, []string{"医学", "护理", "土木", "化学", "材料", "生物", "农学"})
		if rejected != "" {
			set("rejectedMajors", rejected, "已更新排除专业。")
		}
	}
	if limit, ok := parseGaokaoTuitionLimit(command); ok {
		set("tuitionLimit", limit, fmt.Sprintf("已把学费上限调整为%d。", limit))
	}
	return profile, patch, actions
}

func parseGaokaoTuitionLimit(command string) (int, bool) {
	for _, marker := range []string{"学费最多", "学费上限", "最多", "不超过"} {
		idx := strings.Index(command, marker)
		if idx >= 0 {
			rest := command[idx+len(marker):]
			digits := ""
			for _, r := range rest {
				if r >= '0' && r <= '9' {
					digits += string(r)
					continue
				}
				if digits != "" {
					break
				}
			}
			if digits != "" {
				n, _ := strconv.Atoi(digits)
				if n > 0 {
					return n, true
				}
			}
		}
	}
	return 0, false
}

func filterGaokaoRecommendationsByTrack(recs []services.GaokaoRecommendation, track string) []services.GaokaoRecommendation {
	track = strings.TrimSpace(track)
	if track == "" {
		return recs
	}
	out := []services.GaokaoRecommendation{}
	for _, rec := range recs {
		text := strings.Join([]string{rec.School, rec.Level, rec.Type, rec.SchoolType, rec.Major, rec.MajorGroup, rec.Note, rec.Source}, " ")
		isCollege := gaokaoContainsAny(text, "专科", "高职", "职业学院", "职业技术", "高等专科学校", "高等职业")
		switch track {
		case "专科", "college":
			if isCollege {
				out = append(out, rec)
			}
		case "本科", "undergraduate":
			if !isCollege {
				out = append(out, rec)
			}
		default:
			out = append(out, rec)
		}
	}
	return out
}

func intFromProfile(v interface{}) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case string:
		n, _ := strconv.Atoi(x)
		return n
	default:
		return 0
	}
}
func gaokaoContainsAny(text string, words ...string) bool {
	for _, w := range words {
		if strings.Contains(text, w) {
			return true
		}
	}
	return false
}
func mergeTextList(existing, command string, candidates []string) string {
	if existing == "<nil>" || existing == "nil" {
		existing = ""
	}
	parts := cleanStringList([]string{existing})
	seen := map[string]bool{}
	out := []string{}
	for _, p := range parts {
		if p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	for _, c := range candidates {
		if strings.Contains(command, c) && !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	return strings.Join(out, "、")
}

type gaokaoRiskCheckRequest struct {
	Profile map[string]interface{} `json:"profile"`
	Text    string                 `json:"text"`
}

func (h *GaokaoHandler) RiskCheck(c *gin.Context) {
	var req gaokaoRiskCheckRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	text := strings.TrimSpace(req.Text)
	if text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请粘贴志愿表文本"})
		return
	}
	profile := req.Profile
	if profile == nil {
		profile = map[string]interface{}{}
	}
	lines := splitVolunteerLines(text)
	issues := []gin.H{}
	stats := gin.H{"total": len(lines), "estimated_high_risk": 0, "estimated_safe": 0}
	if len(lines) == 0 {
		issues = append(issues, gin.H{"level": "high", "title": "未识别到志愿项", "detail": "请按每行一个学校/专业的方式粘贴志愿表。"})
	}
	rejected := fmt.Sprint(profile["rejectedMajors"])
	cities := fmt.Sprint(profile["preferredCities"])
	tuitionLimit := intFromProfile(profile["tuitionLimit"])
	for i, line := range lines {
		lowerRisk := gaokaoContainsAny(line, "冲", "冲刺", "985", "热门")
		safe := gaokaoContainsAny(line, "保", "垫", "稳妥", "学院")
		if lowerRisk {
			stats["estimated_high_risk"] = stats["estimated_high_risk"].(int) + 1
		}
		if safe {
			stats["estimated_safe"] = stats["estimated_safe"].(int) + 1
		}
		for _, m := range cleanStringList([]string{rejected}) {
			if m != "" && strings.Contains(line, m) {
				issues = append(issues, gin.H{"level": "high", "title": "包含已排除专业", "detail": fmt.Sprintf("第 %d 行包含你排除的“%s”：%s", i+1, m, line)})
			}
		}
		if gaokaoContainsAny(line, "中外合作", "国际", "联合办学") && !truthy(profile["acceptCooperation"]) {
			issues = append(issues, gin.H{"level": "medium", "title": "存在中外合作/高学费风险", "detail": fmt.Sprintf("第 %d 行疑似中外合作或国际项目，请核查学费和培养模式：%s", i+1, line)})
		}
		if tuitionLimit > 0 && gaokaoContainsAny(line, "88000", "80000", "60000", "50000") {
			issues = append(issues, gin.H{"level": "medium", "title": "可能超过学费预算", "detail": fmt.Sprintf("第 %d 行疑似高学费项目，当前预算上限约 %d：%s", i+1, tuitionLimit, line)})
		}
	}
	if len(lines) > 0 {
		high := stats["estimated_high_risk"].(int)
		safe := stats["estimated_safe"].(int)
		if high > len(lines)/2 {
			issues = append(issues, gin.H{"level": "high", "title": "冲刺项比例偏高", "detail": "志愿表中疑似冲刺项过多，建议增加稳/保梯度。"})
		}
		if safe == 0 {
			issues = append(issues, gin.H{"level": "high", "title": "缺少明确保底项", "detail": "未识别到明显保底/垫底志愿，存在滑档风险。"})
		}
		if cities != "" && !lineListHasAny(lines, cleanStringList([]string{cities})) {
			issues = append(issues, gin.H{"level": "low", "title": "城市偏好匹配度不明显", "detail": "志愿表中未明显出现你的城市偏好，建议核查地域是否符合预期。"})
		}
	}
	if len(issues) == 0 {
		issues = append(issues, gin.H{"level": "low", "title": "未发现明显结构性风险", "detail": "仍需逐项核查官方招生计划、选科要求、学费和专业组调剂风险。"})
	}
	c.JSON(http.StatusOK, gin.H{"stats": stats, "issues": issues, "disclaimer": "体检结果基于文本规则识别，仅供参考；最终以省考试院和高校招生章程为准。"})
}

func splitVolunteerLines(text string) []string {
	raw := strings.FieldsFunc(text, func(r rune) bool { return r == '\n' || r == '\r' })
	out := []string{}
	for _, line := range raw {
		line = strings.TrimSpace(line)
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}
func truthy(v interface{}) bool {
	b, ok := v.(bool)
	if ok {
		return b
	}
	s := strings.TrimSpace(fmt.Sprint(v))
	return s == "true" || s == "1" || s == "是"
}
func lineListHasAny(lines []string, words []string) bool {
	for _, line := range lines {
		for _, w := range words {
			if w != "" && strings.Contains(line, w) {
				return true
			}
		}
	}
	return false
}

func (h *GaokaoHandler) ImportTemplate(c *gin.Context) {
	template := "source_province,year,batch,subject_type,school_code,school_name,school_province,school_city,school_level,ownership,major_code,major_name,major_category,major_heat,major_group,subject_requirement,min_score,min_rank,avg_score,avg_rank,plan_count,tuition,campus,source\n" +
		"广东,2025,本科批,物理类,scnu,华南师范大学,广东,广州,211 / 双一流,公办,cs,计算机科学与技术,计算机类,高,物理组 214,物理+化学,581,37100,586,35900,53,6850,石牌校区,省考试院/高校官网\n"
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=gaokao_admission_template.csv")
	c.String(http.StatusOK, "\ufeff"+template)
}

func (h *GaokaoHandler) ImportCSV(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请上传 CSV 文件，字段需匹配模板"})
		return
	}
	opened, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "读取文件失败"})
		return
	}
	defer opened.Close()
	reader := csv.NewReader(opened)
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true
	headers, err := reader.Read()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "CSV 为空或表头错误"})
		return
	}
	if len(headers) > 0 {
		headers[0] = strings.TrimPrefix(headers[0], "\ufeff")
	}
	idx := map[string]int{}
	for i, hname := range headers {
		idx[strings.TrimSpace(hname)] = i
	}
	required := []string{"source_province", "year", "school_code", "school_name", "major_code", "major_name", "min_rank"}
	for _, key := range required {
		if _, ok := idx[key]; !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少必要字段: " + key})
			return
		}
	}
	createdSchools, createdMajors, upsertedRecords, skipped := 0, 0, 0, 0
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			skipped++
			continue
		}
		get := func(key string) string {
			if i, ok := idx[key]; ok && i < len(row) {
				return strings.TrimSpace(row[i])
			}
			return ""
		}
		sourceProvince := get("source_province")
		schoolCode := get("school_code")
		schoolName := get("school_name")
		majorCode := get("major_code")
		majorName := get("major_name")
		if sourceProvince == "" || schoolCode == "" || schoolName == "" || majorCode == "" || majorName == "" {
			skipped++
			continue
		}
		year := atoiDefault(get("year"), 0)
		minRank := atoiDefault(get("min_rank"), 0)
		if year == 0 || minRank == 0 {
			skipped++
			continue
		}
		var school models.GaokaoSchool
		if err := h.db.Where("code = ?", schoolCode).First(&school).Error; err != nil {
			school = models.GaokaoSchool{Code: schoolCode, Name: schoolName, Province: get("school_province"), City: get("school_city"), Level: get("school_level"), Ownership: get("ownership")}
			if school.Ownership == "" {
				school.Ownership = "公办"
			}
			if err := h.db.Create(&school).Error; err != nil {
				skipped++
				continue
			}
			createdSchools++
		} else {
			h.db.Model(&school).Updates(map[string]interface{}{"name": schoolName, "province": get("school_province"), "city": get("school_city"), "level": get("school_level"), "ownership": defaultString(get("ownership"), school.Ownership)})
		}
		var major models.GaokaoMajor
		if err := h.db.Where("code = ?", majorCode).First(&major).Error; err != nil {
			major = models.GaokaoMajor{Code: majorCode, Name: majorName, Category: get("major_category"), Heat: defaultString(get("major_heat"), "中")}
			if err := h.db.Create(&major).Error; err != nil {
				skipped++
				continue
			}
			createdMajors++
		} else {
			h.db.Model(&major).Updates(map[string]interface{}{"name": majorName, "category": get("major_category"), "heat": defaultString(get("major_heat"), major.Heat)})
		}
		rec := models.GaokaoAdmissionRecord{Year: year, SourceProvince: sourceProvince, Batch: get("batch"), SubjectType: get("subject_type"), SchoolID: school.ID, MajorID: major.ID, MajorGroup: get("major_group"), SubjectRequirement: get("subject_requirement"), MinScore: atoiDefault(get("min_score"), 0), MinRank: minRank, AvgScore: atoiDefault(get("avg_score"), 0), AvgRank: atoiDefault(get("avg_rank"), 0), PlanCount: atoiDefault(get("plan_count"), 0), Tuition: atoiDefault(get("tuition"), 0), Campus: get("campus"), Source: get("source")}
		var existing models.GaokaoAdmissionRecord
		q := h.db.Where("year = ? AND source_province = ? AND school_id = ? AND major_id = ? AND major_group = ?", rec.Year, rec.SourceProvince, rec.SchoolID, rec.MajorID, rec.MajorGroup)
		if err := q.First(&existing).Error; err == nil {
			rec.ID = existing.ID
			h.db.Save(&rec)
		} else {
			h.db.Create(&rec)
		}
		upsertedRecords++
	}
	c.JSON(http.StatusOK, gin.H{"created_schools": createdSchools, "created_majors": createdMajors, "upserted_records": upsertedRecords, "skipped": skipped})
}

func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}
func defaultString(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return strings.TrimSpace(v)
}

func (h *GaokaoHandler) Coverage(c *gin.Context) {
	type row struct {
		SourceProvince string `json:"source_province"`
		Records        int64  `json:"records"`
		MajorRecords   int64  `json:"major_records"`
		PlanRecords    int64  `json:"plan_records"`
		LatestYear     int    `json:"latest_year"`
	}
	var admissionRows []struct {
		SourceProvince string
		Records        int64
		MajorRecords   int64
		LatestYear     int
	}
	h.db.Table("gaokao_admission_records").
		Select("source_province, count(*) as records, sum(case when source like 'GaokaoCompass-11M major %' then 1 else 0 end) as major_records, max(year) as latest_year").
		Where("source like ?", "GaokaoCompass-11M%").Group("source_province").Scan(&admissionRows)
	planCounts := map[string]int64{}
	var planRows []struct {
		SourceProvince string
		Count          int64
	}
	h.db.Table("gaokao_enrollment_plans").Select("source_province, count(*) as count").Where("year = ?", 2025).Group("source_province").Scan(&planRows)
	for _, item := range planRows {
		planCounts[item.SourceProvince] = item.Count
	}
	items := []row{}
	for _, item := range admissionRows {
		items = append(items, row{SourceProvince: item.SourceProvince, Records: item.Records, MajorRecords: item.MajorRecords, PlanRecords: planCounts[item.SourceProvince], LatestYear: item.LatestYear})
	}
	c.JSON(http.StatusOK, gin.H{
		"items":   items,
		"summary": gin.H{"admission_provinces": len(items), "plan_provinces": len(planRows), "source": "GaokaoCompass-11M", "notes": []string{"青海、山西部分数据使用历史年份补位次", "西藏缺最低位次，不适合位次推荐", "学费/计划来自独立 enrollment-plan 表，按专业名/专业ID补全"}},
	})
}
