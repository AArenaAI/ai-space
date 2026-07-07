package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"aipool-backend/internal/modelmeta"
	"aipool-backend/internal/services"
)

type gaokaoAICandidate struct {
	School            string   `json:"school"`
	City              string   `json:"city"`
	Level             string   `json:"level"`
	RecommendedMajors []string `json:"recommended_majors"`
	ReferenceRank     string   `json:"reference_rank"`
	ReferenceRankMin  int      `json:"reference_rank_min"`
	ReferenceRankMax  int      `json:"reference_rank_max"`
	VerifiedMinScore  int      `json:"verified_min_score,omitempty"`
	VerifiedMinRank   int      `json:"verified_min_rank,omitempty"`
	EvidenceSource    string   `json:"evidence_source,omitempty"`
	EvidenceTitle     string   `json:"evidence_title,omitempty"`
	Band              string   `json:"band"`
	AdmissionChance   string   `json:"admission_chance,omitempty"`
	Reason            string   `json:"reason"`
	Employment        string   `json:"employment"`
}

type gaokaoAICandidatePayload struct {
	Candidates []gaokaoAICandidate `json:"candidates"`
}

func generateGaokaoReportWithAIService(ctx context.Context, ai chatAIService, searchService *services.SearchService, profile services.GaokaoProfile, message, track string, recs []services.GaokaoRecommendation, links []services.GaokaoAdvisorEvidenceLink) (string, string, error) {
	if ai == nil {
		return "", "ai_service_missing", fmt.Errorf("AIService 未注入")
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Minute)
	defer cancel()

	seedMaterials := gaokaoCandidateMaterials(profile, recs)
	candidatePrompt := buildGaokaoCandidatePrompt(profile, message, track, seedMaterials)
	candidateText, err := callGaokaoAIText(ctx, ai, "gpt-5.5", []services.Message{{Role: "system", Content: "你是高考志愿规划师。必须联网查询最新可用投档线/最低位次/招生信息，再返回严格 JSON，不要 Markdown。"}, {Role: "user", Content: candidatePrompt}}, true)
	if err != nil {
		return "", "candidate_error", err
	}
	candidates := parseGaokaoAICandidates(candidateText)
	validated := validateGaokaoAICandidates(profile, candidates, track)
	if len(validated) == 0 {
		validated = validateGaokaoAICandidates(profile, recsToGaokaoAICandidates(profile, services.BuildGaokaoProfessionalSeedRecommendations(profile)), track)
	}
	if len(validated) == 0 {
		return "", "no_validated_candidates", fmt.Errorf("没有通过硬过滤的候选")
	}
	// DeepSeek only provides review/correction advice. It must not directly mutate the table;
	// the second GPT pass receives GPT candidates + DS review and rewrites the final plan.
	dsReviewText, err := buildGaokaoDeepSeekReviewAdvice(ctx, ai, searchService, profile, track, validated)
	if err != nil {
		return "", "deepseek_review_failed", fmt.Errorf("DeepSeek 联网复核意见生成失败: %w", err)
	}

	finalPrompt := buildGaokaoFinalAIPromptWithReview(profile, message, track, validated, dsReviewText, links)
	markdown, err := callGaokaoAIText(ctx, ai, "gpt-5.5", []services.Message{{Role: "system", Content: "你是资深高考志愿规划师。输出完整中文 Markdown 报告。你必须综合第一轮 GPT 候选和 DeepSeek 复核意见，自行重整最终候选；DeepSeek 只提供整改意见，不是最终表格。可联网核对来源。"}, {Role: "user", Content: finalPrompt}}, true)
	if err != nil {
		return "", "final_error", err
	}
	markdown = strings.TrimSpace(markdown)
	if err := validateGaokaoFinalMarkdown(profile, markdown, validated); err != nil {
		return "", "postcheck_failed", err
	}
	return markdown, "ai_service:gpt-5.5:candidates+hardfilter+final+postcheck", nil
}

func callGaokaoAIText(ctx context.Context, ai chatAIService, model string, messages []services.Message, searchEnabled ...bool) (string, error) {
	useSearch := len(searchEnabled) > 0 && searchEnabled[0]
	resp, err := ai.ChatCompletion(ctx, model, messages, false, false, "", useSearch, nil)
	if err != nil {
		return "", err
	}
	if resp == nil || resp.Body == nil {
		return "", fmt.Errorf("模型未返回响应体")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return "", err
	}
	if resp.Background {
		body, err = waitForNotebookBackgroundAIResponse(ctx, ai, body, "report:gaokao")
		if err != nil {
			return "", err
		}
	}
	text := strings.TrimSpace(string(body))
	text = stripGaokaoThinkBlock(text)
	return strings.TrimSpace(text), nil
}

func callGaokaoAITextWithSearchContext(ctx context.Context, ai chatAIService, searchService *services.SearchService, model string, messages []services.Message, searchEnabled bool) (string, error) {
	if !searchEnabled {
		return callGaokaoAIText(ctx, ai, model, messages, false)
	}
	if modelmeta.SupportsSearch(model) {
		return callGaokaoAIText(ctx, ai, model, messages, true)
	}
	processed := append([]services.Message(nil), messages...)
	if searchService != nil {
		query := ""
		for i := len(processed) - 1; i >= 0; i-- {
			if processed[i].Role == "user" {
				query = processed[i].Content
				break
			}
		}
		if strings.TrimSpace(query) != "" {
			searchResult, _, err := searchService.Search(query, "Asia/Shanghai")
			if err == nil && strings.TrimSpace(searchResult) != "" {
				searchCtx := "<web_search_context>\n以下是联网搜索结果，仅用于补充外部背景。\n\n" + searchResult + "\n</web_search_context>"
				processed = append([]services.Message{{Role: "system", Content: searchCtx}}, processed...)
			}
		}
	}
	return callGaokaoAIText(ctx, ai, model, processed, false)
}

func stripGaokaoThinkBlock(text string) string {
	text = strings.TrimSpace(text)
	for {
		start := strings.Index(strings.ToLower(text), "<think>")
		end := strings.Index(strings.ToLower(text), "</think>")
		if start < 0 || end < start {
			break
		}
		text = strings.TrimSpace(text[:start] + text[end+len("</think>"):])
	}
	return text
}

func gaokaoTrackBatchLabel(track string) string {
	if strings.Contains(track, "补录专科") {
		return "补录专科/专科征集志愿"
	}
	if strings.Contains(track, "补录本科") {
		return "补录本科/本科征集志愿"
	}
	if strings.Contains(track, "专科") || strings.EqualFold(track, "college") {
		return "专科批/高职高专批"
	}
	return "本科批/普通本科批"
}

func buildGaokaoCandidatePrompt(profile services.GaokaoProfile, message, track, materials string) string {
	batchLabel := gaokaoTrackBatchLabel(track)
	return fmt.Sprintf(`请为高考志愿规划生成候选院校 JSON。

考生：%s，%s，%d分，位次%d。
专项：%s。只允许推荐该专项对应批次，不得混入其它批次。
本次批次口径：%s。
专业偏好：%s。
排除专业：%s。
城市偏好：%s。
用户补充：%s。

硬规则：
1. 先按全国范围规划，不要把考试省份误当城市偏好。
2. 位次%d左右的考生，严禁推荐录取位次约18万/19万/20万的院校。
3. 民办本科、职业本科、独立学院不是一律禁入；只有在其 verified_min_rank 与考生位次匹配、能作为合理保底/稳妥、且不违背用户学校类型偏好时才可推荐。严禁把录取位次远低于考生层次的民办/职业本科推荐给高位次考生。
4. 层次必须写清：985/211/双一流/公办一本/公办二本/民办本科/职业本科/专科。
5. reference_rank_min/reference_rank_max 使用整数位次。若只有区间，如2.4万-2.6万，填 24000/26000。
6. 推荐专业如能查到真实专业/专业组最低位次，必须写成“专业名[专业最低位次:整数]”；查不到就只写专业名，禁止复制学校最低位次。
7. 输出 12-18 所，必须有真实梯度：冲刺院校约占 25%%-35%%，其学校最低位次应略优于考生位次（例如 4万位考生要包含约3.3万-3.9万位的冲刺），稳位接近考生位次，保底低于考生位次；禁止全部推荐比考生位次更低门槛的稳保学校。
8. 不要输出解释文字。

参考材料（可参考但不必照搬；若材料不合理，以志愿规划常识修正）：
%s

严格返回 JSON：
{"candidates":[{"school":"","city":"","level":"公办一本","recommended_majors":["自动化[专业最低位次:38620]"],"reference_rank":"3.8万-4.2万","reference_rank_min":38000,"reference_rank_max":42000,"band":"稳","reason":"","employment":""}]}`, profile.Province, profile.Subjects, profile.Score, profile.Rank, track, batchLabel, strings.Join(profile.PreferredMajors, "、"), strings.Join(profile.RejectedMajors, "、"), strings.Join(profile.PreferredCities, "、"), message, profile.Rank, materials)
}

func gaokaoCandidateMaterials(profile services.GaokaoProfile, recs []services.GaokaoRecommendation) string {
	var b strings.Builder
	all := append([]services.GaokaoRecommendation{}, recs...)
	if len(all) == 0 {
		all = services.BuildGaokaoProfessionalSeedRecommendations(profile)
	}
	for i, r := range all {
		if i >= 30 {
			break
		}
		fmt.Fprintf(&b, "- %s｜%s｜%s｜%s｜ranks=%v｜band=%s｜source=%s\n", r.School, r.City, r.Level, r.Major, r.Ranks, r.Band, r.Source)
	}
	return b.String()
}

func parseGaokaoAICandidates(text string) []gaokaoAICandidate {
	text = strings.TrimSpace(text)
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	text = strings.TrimSpace(text)
	if i := strings.Index(text, "{"); i >= 0 {
		text = text[i:]
	}
	if j := strings.LastIndex(text, "}"); j >= 0 {
		text = text[:j+1]
	}
	var p gaokaoAICandidatePayload
	if err := json.Unmarshal([]byte(text), &p); err == nil && len(p.Candidates) > 0 {
		return p.Candidates
	}
	var arr []gaokaoAICandidate
	_ = json.Unmarshal([]byte(text), &arr)
	return arr
}

func validateGaokaoAICandidates(profile services.GaokaoProfile, in []gaokaoAICandidate, track string) []gaokaoAICandidate {
	seen := map[string]bool{}
	out := []gaokaoAICandidate{}
	for _, c := range in {
		c.School = strings.TrimSpace(c.School)
		if c.School == "" || seen[c.School] {
			continue
		}
		if !validGaokaoAILevelForRank(profile, c, track) {
			continue
		}
		minR, maxR := c.ReferenceRankMin, c.ReferenceRankMax
		if c.VerifiedMinRank > 0 {
			minR, maxR = c.VerifiedMinRank, c.VerifiedMinRank
			c.ReferenceRank = fmt.Sprintf("约%d（逐校搜索复核）", c.VerifiedMinRank)
		}
		if minR <= 0 && maxR <= 0 {
			minR, maxR = parseGaokaoAIRankRange(c.ReferenceRank)
		}
		if minR <= 0 && maxR > 0 {
			minR = maxR
		}
		if maxR <= 0 && minR > 0 {
			maxR = minR
		}
		if maxR > 0 && profile.Rank > 0 {
			// 高分位考生绝不允许把过宽尾部院校当保底；但允许少量极限冲刺靠前院校。
			upper := int(float64(profile.Rank) * 1.55)
			if profile.Rank < 100000 && maxR > upper {
				continue
			}
		}
		c.ReferenceRankMin, c.ReferenceRankMax = minR, maxR
		if c.Level == "" {
			if strings.Contains(track, "专科") || strings.EqualFold(track, "college") {
				c.Level = "专科"
			} else {
				c.Level = "公办本科"
			}
		}
		seen[c.School] = true
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool { return gaokaoBandOrder(out[i].Band) < gaokaoBandOrder(out[j].Band) })
	if len(out) > 16 {
		return out[:16]
	}
	return out
}

func enrichGaokaoCandidatesWithSchoolRankEvidence(ctx context.Context, profile services.GaokaoProfile, in []gaokaoAICandidate) []gaokaoAICandidate {
	if len(in) == 0 {
		return in
	}
	limit := len(in)
	if limit > 16 {
		limit = 16
	}
	out := make([]gaokaoAICandidate, limit)
	copy(out, in[:limit])
	ctx, cancel := context.WithTimeout(ctx, 55*time.Second)
	defer cancel()
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i := 0; i < limit; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}
			schoolCtx, cancelOne := context.WithTimeout(ctx, 14*time.Second)
			defer cancelOne()
			evidence := services.LookupGaokaoSchoolRankEvidence(schoolCtx, profile, out[i].School)
			if evidence.MinRank <= 0 {
				return
			}
			out[i].VerifiedMinRank = evidence.MinRank
			out[i].VerifiedMinScore = evidence.MinScore
			out[i].EvidenceSource = evidence.SourceURL
			out[i].EvidenceTitle = evidence.SourceTitle
			out[i].ReferenceRankMin = evidence.MinRank
			out[i].ReferenceRankMax = evidence.MinRank
			out[i].ReferenceRank = fmt.Sprintf("%d分 / %d位（%s）", evidence.MinScore, evidence.MinRank, fallbackText(evidence.Confidence, "来源复核"))
			out[i].Band = gaokaoBandFromVerifiedRank(profile.Rank, evidence.MinRank)
			out[i].AdmissionChance = gaokaoChanceFromVerifiedRank(profile.Rank, evidence.MinRank)
		}()
	}
	wg.Wait()
	return out
}

func gaokaoBandFromVerifiedRank(rank, minRank int) string {
	if rank <= 0 || minRank <= 0 {
		return "待核验"
	}
	ratio := float64(minRank) / float64(rank)
	switch {
	case ratio < 0.8:
		return "极限冲"
	case ratio < 0.97:
		return "冲"
	case ratio < 1.18:
		return "稳"
	default:
		return "保"
	}
}

func gaokaoChanceFromVerifiedRank(rank, minRank int) string {
	if rank <= 0 || minRank <= 0 {
		return "待核验"
	}
	ratio := float64(minRank) / float64(rank)
	switch {
	case ratio < 0.75:
		return "约1%-5%（极限冲）"
	case ratio < 0.90:
		return "约5%-20%（冲）"
	case ratio < 1.03:
		return "约35%-60%（临界稳）"
	case ratio < 1.18:
		return "约60%-75%（稳）"
	case ratio < 1.45:
		return "约75%-90%（保）"
	default:
		return "不建议：位次利用不足"
	}
}

func extractGaokaoAIJSONObject(content string) string {
	content = strings.TrimSpace(content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start >= 0 && end >= start {
		return strings.TrimSpace(content[start : end+1])
	}
	return content
}

func buildGaokaoDeepSeekReviewAdvice(ctx context.Context, ai chatAIService, searchService *services.SearchService, profile services.GaokaoProfile, track string, in []gaokaoAICandidate) (string, error) {
	if ai == nil || len(in) == 0 {
		return "", nil
	}
	limit := len(in)
	if limit > 12 {
		limit = 12
	}
	candidates := in[:limit]
	payload, _ := json.MarshalIndent(candidates, "", "  ")
	batchLabel := gaokaoTrackBatchLabel(track)
	queryPrompt := fmt.Sprintf(`你是高考志愿数据复核员。请为每所候选学校生成联网搜索查询，用于核验 2025 年%s%s%s最低分、最低位次。
要求：候选学校每校 1 个 query；如果你认为还有更适合该考生位次/专业的学校，可额外给最多 5 个学校 query。query 必须包含省份、学校、2025、%s、最低分、最低位次、选科。只返回 JSON：{"queries":[{"school":"","query":""}]}。
候选：
%s`, profile.Province, profile.Subjects, batchLabel, batchLabel, string(payload))
	ctx2, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	queryText, err := callGaokaoAITextWithSearchContext(ctx2, ai, searchService, "deepseek-chat", []services.Message{{Role: "system", Content: "你是严谨的高考数据检索规划员，只返回 JSON。"}, {Role: "user", Content: queryPrompt}}, true)
	if err != nil {
		return "", err
	}
	var qout struct {
		Queries []struct {
			School string `json:"school"`
			Query  string `json:"query"`
		} `json:"queries"`
	}
	if err := json.Unmarshal([]byte(extractGaokaoAIJSONObject(queryText)), &qout); err != nil {
		return "", err
	}
	snippetsBySchool := map[string][]services.GaokaoDSSearchSnippet{}
	for _, q := range qout.Queries {
		school := strings.TrimSpace(q.School)
		if school == "" {
			continue
		}
		searchCtx, cancelSearch := context.WithTimeout(ctx2, 18*time.Second)
		snippetsBySchool[school] = services.ExecuteGaokaoDSSearchQuery(searchCtx, q.Query, 3)
		cancelSearch()
	}
	snippetsJSON, _ := json.MarshalIndent(snippetsBySchool, "", "  ")
	verifyPrompt := fmt.Sprintf(`你是 DeepSeek 高考志愿复核顾问。你不能直接修改最终推荐表，只能给第二轮 GPT 提供整改意见。
考生：%s，%s，位次%d。
请根据联网搜索摘录，逐校指出：原 GPT 学校最低位次是否可能错误、正确最低分/最低位次建议、推荐专业的真实专业/专业组最低位次是否查到、冲稳保/录取概率是否应调整、是否应删除、是否建议补充其它学校。专业最低位次必须逐专业给出，不能复用学校最低位次。还要检查梯度是否过保守：若考生约4万位却没有3.3万-3.9万位左右的冲刺学校，应提出补充冲刺院校建议。
示例：{"school":"某大学","issue":"原位次45232疑似错误","correction":"2025最低位次应为10259","advice":"应从稳位改为极限冲或删除"}。
输出严格 JSON：{"review_advice":[{"school":"","issue":"","correction":"","major_rank_advice":[{"major":"","min_rank":0,"source_hint":""}],"advice":"","source_hint":""}],"additional_school_advice":[{"school":"","reason":"","rank_evidence":"","advice":""}]}。
GPT第一轮候选：
%s
联网搜索摘录：
%s`, profile.Province, profile.Subjects, profile.Rank, string(payload), string(snippetsJSON))
	verifyText, err := callGaokaoAITextWithSearchContext(ctx2, ai, searchService, "deepseek-chat", []services.Message{{Role: "system", Content: "你是严谨的高考志愿复核顾问，只返回 JSON。"}, {Role: "user", Content: verifyPrompt}}, true)
	if err != nil {
		return "", err
	}
	return extractGaokaoAIJSONObject(verifyText), nil
}

func validateGaokaoCandidatesWithDeepSeekWeb(ctx context.Context, ai chatAIService, profile services.GaokaoProfile, in []gaokaoAICandidate) ([]gaokaoAICandidate, error) {
	if ai == nil || len(in) == 0 {
		return in, nil
	}
	limit := len(in)
	if limit > 12 {
		limit = 12
	}
	candidates := in[:limit]
	payload, _ := json.MarshalIndent(candidates, "", "  ")
	queryPrompt := fmt.Sprintf(`你是高考志愿数据复核员。请为每所候选学校生成联网搜索查询，用于核验 2025 年%s%s本科批/普通本科批最低分、最低位次。
要求：候选学校每校 1 个 query；如果你认为还有更适合该考生位次/专业的学校，可额外给最多 5 个学校 query。query 必须包含省份、学校、2025、本科批、最低分、最低位次、选科。只返回 JSON：{"queries":[{"school":"","query":""}]}。
候选：
%s`, profile.Province, profile.Subjects, string(payload))
	ctx2, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	queryText, err := callGaokaoAIText(ctx2, ai, "deepseek-chat", []services.Message{{Role: "system", Content: "你是严谨的高考数据检索规划员，只返回 JSON。"}, {Role: "user", Content: queryPrompt}})
	if err != nil {
		return nil, err
	}
	var qout struct {
		Queries []struct {
			School string `json:"school"`
			Query  string `json:"query"`
		} `json:"queries"`
	}
	if err := json.Unmarshal([]byte(extractGaokaoAIJSONObject(queryText)), &qout); err != nil {
		return nil, err
	}
	snippetsBySchool := map[string][]services.GaokaoDSSearchSnippet{}
	for _, q := range qout.Queries {
		school := strings.TrimSpace(q.School)
		if school == "" {
			continue
		}
		searchCtx, cancelSearch := context.WithTimeout(ctx2, 18*time.Second)
		snippetsBySchool[school] = services.ExecuteGaokaoDSSearchQuery(searchCtx, q.Query, 3)
		cancelSearch()
	}
	snippetsJSON, _ := json.MarshalIndent(snippetsBySchool, "", "  ")
	verifyPrompt := fmt.Sprintf(`你是 DeepSeek 高考志愿数据复核员。你必须只根据下面联网搜索摘录核验候选学校，不要写报告。
考生：%s，%s，位次%d。
核验口径：学校最低位次 = 本省本批次、符合选科可报专业组中，收分最低/位次最大的学校最低投档位次；不是专业最低位次，不是学校排名。
任务：逐校给出 verified_min_score、verified_min_rank、band、admission_chance。若摘录不足以改判，但候选本身已有明确整数位次，可 passed=true、verified_min_rank=0，并在 note 说明“未改判”；只有明显跨批次、无任何位次、位次极不合理或不符合目标时，才 passed=false 或 band="移除"。严禁把明显难录学校标成稳/保。
输出严格 JSON：{"reviews":[{"school":"","passed":true,"verified_min_score":0,"verified_min_rank":0,"band":"极限冲|冲|临界稳|稳|保|移除","admission_chance":"","note":""}],"additional_candidates":[{"school":"","city":"","level":"","recommended_majors":[""],"verified_min_score":0,"verified_min_rank":0,"band":"","admission_chance":"","reason":""}]}。
候选：
%s
联网搜索摘录：
%s`, profile.Province, profile.Subjects, profile.Rank, string(payload), string(snippetsJSON))
	verifyText, err := callGaokaoAIText(ctx2, ai, "deepseek-chat", []services.Message{{Role: "system", Content: "你是严谨的高考数据审核员，只返回 JSON。"}, {Role: "user", Content: verifyPrompt}})
	if err != nil {
		return nil, err
	}
	var vout struct {
		Reviews []struct {
			School           string `json:"school"`
			Passed           bool   `json:"passed"`
			VerifiedMinScore int    `json:"verified_min_score"`
			VerifiedMinRank  int    `json:"verified_min_rank"`
			Band             string `json:"band"`
			AdmissionChance  string `json:"admission_chance"`
			Note             string `json:"note"`
		} `json:"reviews"`
		AdditionalCandidates []struct {
			School            string   `json:"school"`
			City              string   `json:"city"`
			Level             string   `json:"level"`
			RecommendedMajors []string `json:"recommended_majors"`
			VerifiedMinScore  int      `json:"verified_min_score"`
			VerifiedMinRank   int      `json:"verified_min_rank"`
			Band              string   `json:"band"`
			AdmissionChance   string   `json:"admission_chance"`
			Reason            string   `json:"reason"`
		} `json:"additional_candidates"`
	}
	if err := json.Unmarshal([]byte(extractGaokaoAIJSONObject(verifyText)), &vout); err != nil {
		return nil, err
	}
	reviews := map[string]struct {
		passed bool
		score  int
		rank   int
		band   string
		chance string
		note   string
	}{}
	for _, r := range vout.Reviews {
		reviews[strings.TrimSpace(r.School)] = struct {
			passed bool
			score  int
			rank   int
			band   string
			chance string
			note   string
		}{r.Passed, r.VerifiedMinScore, r.VerifiedMinRank, strings.TrimSpace(r.Band), strings.TrimSpace(r.AdmissionChance), strings.TrimSpace(r.Note)}
	}
	out := []gaokaoAICandidate{}
	for _, c := range candidates {
		r, ok := reviews[c.School]
		if ok && r.band == "移除" {
			continue
		}
		if ok && r.rank > 0 {
			c.VerifiedMinRank = r.rank
			c.VerifiedMinScore = r.score
			c.ReferenceRankMin = r.rank
			c.ReferenceRankMax = r.rank
			c.ReferenceRank = fmt.Sprintf("%d位（DeepSeek联网复核）", r.rank)
			if r.score > 0 {
				c.ReferenceRank = fmt.Sprintf("%d分 / %d位（DeepSeek联网复核）", r.score, r.rank)
			}
			c.Band = fallbackText(r.band, gaokaoBandFromVerifiedRank(profile.Rank, r.rank))
			c.AdmissionChance = fallbackText(r.chance, gaokaoChanceFromVerifiedRank(profile.Rank, r.rank))
			out = append(out, c)
			continue
		}
		seedRank := c.VerifiedMinRank
		if seedRank <= 0 {
			seedRank = c.ReferenceRankMax
		}
		if seedRank <= 0 {
			seedRank = c.ReferenceRankMin
		}
		if seedRank <= 0 {
			continue
		}
		// GPT 第一轮已经联网给出明确整数位次时，DS 未确认不等于整份报告为空；
		// 保留为 GPT 联网初核数据，后检仍会挡明显不合理项。
		c.VerifiedMinRank = seedRank
		c.ReferenceRankMin = seedRank
		c.ReferenceRankMax = seedRank
		c.ReferenceRank = fmt.Sprintf("%d位（GPT联网初核，DS未改判）", seedRank)
		c.Band = fallbackText(c.Band, gaokaoBandFromVerifiedRank(profile.Rank, seedRank))
		c.AdmissionChance = fallbackText(c.AdmissionChance, gaokaoChanceFromVerifiedRank(profile.Rank, seedRank))
		out = append(out, c)
	}
	seen := map[string]bool{}
	for _, c := range out {
		seen[c.School] = true
	}
	for _, a := range vout.AdditionalCandidates {
		school := strings.TrimSpace(a.School)
		if school == "" || seen[school] || a.VerifiedMinRank <= 0 {
			continue
		}
		c := gaokaoAICandidate{School: school, City: strings.TrimSpace(a.City), Level: strings.TrimSpace(a.Level), RecommendedMajors: a.RecommendedMajors, VerifiedMinScore: a.VerifiedMinScore, VerifiedMinRank: a.VerifiedMinRank, ReferenceRankMin: a.VerifiedMinRank, ReferenceRankMax: a.VerifiedMinRank, Band: fallbackText(strings.TrimSpace(a.Band), gaokaoBandFromVerifiedRank(profile.Rank, a.VerifiedMinRank)), AdmissionChance: fallbackText(strings.TrimSpace(a.AdmissionChance), gaokaoChanceFromVerifiedRank(profile.Rank, a.VerifiedMinRank)), Reason: strings.TrimSpace(a.Reason)}
		c.ReferenceRank = fmt.Sprintf("%d位（DeepSeek联网补充）", a.VerifiedMinRank)
		if a.VerifiedMinScore > 0 {
			c.ReferenceRank = fmt.Sprintf("%d分 / %d位（DeepSeek联网补充）", a.VerifiedMinScore, a.VerifiedMinRank)
		}
		out = append(out, c)
		seen[school] = true
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("DeepSeek 未能为任何候选学校确认明确最低位次")
	}
	return out, nil
}

func validateGaokaoCandidatesWithDeepSeek(ctx context.Context, ai chatAIService, profile services.GaokaoProfile, in []gaokaoAICandidate) []gaokaoAICandidate {
	if ai == nil || len(in) == 0 {
		return in
	}
	payload, _ := json.MarshalIndent(in, "", "  ")
	prompt := fmt.Sprintf(`你是高考志愿候选审核员。请只审查候选 JSON，不写报告。
考生位次：%d。省份：%s。科类：%s。
重点审查：
1. 每所学校的 verified_min_rank / reference_rank 是否和录取概率、冲稳保匹配。
2. 如果 verified_min_rank 明显靠前，不得说很好录取；应标极限冲/冲。
3. 民办本科/职业本科/独立学院允许存在，但必须与考生位次匹配且符合用户学校类型偏好；若 verified_min_rank 与考生位次差距过大、明显浪费分数或不合目标，应移除。
4. 输出严格 JSON：{"must_remove":["学校名"],"warnings":[{"school":"","reason":""}]}。

候选：
%s`, profile.Rank, profile.Province, profile.Subjects, string(payload))
	ctx2, cancel := context.WithTimeout(ctx, 80*time.Second)
	defer cancel()
	text, err := callGaokaoAIText(ctx2, ai, "deepseek-chat", []services.Message{{Role: "system", Content: "你是严谨的数据审核员，只返回 JSON。"}, {Role: "user", Content: prompt}})
	if err != nil || strings.TrimSpace(text) == "" {
		return in
	}
	text = strings.TrimSpace(strings.TrimPrefix(strings.TrimSuffix(text, "```"), "```json"))
	var review struct {
		MustRemove []string `json:"must_remove"`
		Warnings   []struct {
			School string `json:"school"`
			Reason string `json:"reason"`
		} `json:"warnings"`
	}
	if i := strings.Index(text, "{"); i >= 0 {
		text = text[i:]
	}
	if j := strings.LastIndex(text, "}"); j >= 0 {
		text = text[:j+1]
	}
	if err := json.Unmarshal([]byte(text), &review); err != nil {
		return in
	}
	remove := map[string]bool{}
	for _, s := range review.MustRemove {
		remove[strings.TrimSpace(s)] = true
	}
	out := []gaokaoAICandidate{}
	for _, c := range in {
		if remove[c.School] {
			continue
		}
		out = append(out, c)
	}
	return out
}

func validGaokaoAILevelForRank(profile services.GaokaoProfile, c gaokaoAICandidate, track string) bool {
	text := c.School + " " + c.Level
	isCollegeTrack := strings.Contains(track, "专科") || strings.EqualFold(track, "college")
	isCollegeCandidate := strings.Contains(text, "专科") || strings.Contains(text, "高职") || strings.Contains(text, "职业技术学院") || strings.Contains(text, "高等专科学校")
	if isCollegeTrack {
		return isCollegeCandidate
	}
	return !isCollegeCandidate
}

func parseGaokaoAIRankRange(text string) (int, int) {
	text = strings.ReplaceAll(text, ",", "")
	re := regexp.MustCompile(`([0-9]+(?:\.[0-9]+)?)\s*万?`)
	ms := re.FindAllStringSubmatch(text, -1)
	vals := []int{}
	for _, m := range ms {
		if len(m) < 2 {
			continue
		}
		var f float64
		_, _ = fmt.Sscanf(m[1], "%f", &f)
		v := int(f)
		if strings.Contains(m[0], "万") {
			v = int(f * 10000)
		}
		if v > 0 {
			vals = append(vals, v)
		}
	}
	if len(vals) == 0 {
		return 0, 0
	}
	if len(vals) == 1 {
		return vals[0], vals[0]
	}
	if vals[0] > vals[1] {
		vals[0], vals[1] = vals[1], vals[0]
	}
	return vals[0], vals[1]
}

func recsToGaokaoAICandidates(profile services.GaokaoProfile, recs []services.GaokaoRecommendation) []gaokaoAICandidate {
	out := []gaokaoAICandidate{}
	for _, r := range recs {
		rank := 0
		if len(r.Ranks) > 0 {
			rank = r.Ranks[0]
		}
		majors := []string{r.Major}
		if len(r.RecommendedMajorPool) > 0 {
			majors = r.RecommendedMajorPool
		}
		out = append(out, gaokaoAICandidate{School: r.School, City: r.City, Level: servicesLevelForGaokaoRec(r), RecommendedMajors: majors, ReferenceRank: fmt.Sprintf("约%d", rank), ReferenceRankMin: rank, ReferenceRankMax: rank, Band: r.Band, Reason: r.Note, Employment: "工科就业与区域产业匹配"})
	}
	return out
}

func servicesLevelForGaokaoRec(r services.GaokaoRecommendation) string {
	if strings.TrimSpace(r.DualClass) != "" {
		return r.DualClass
	}
	if strings.TrimSpace(r.Level) != "" {
		return r.Level
	}
	return "公办本科"
}

func gaokaoBandOrder(b string) int {
	switch b {
	case "冲":
		return 0
	case "稳":
		return 1
	case "保":
		return 2
	default:
		return 3
	}
}

func buildGaokaoFinalAIPromptWithReview(profile services.GaokaoProfile, message, track string, candidates []gaokaoAICandidate, dsReviewText string, links []services.GaokaoAdvisorEvidenceLink) string {
	base := buildGaokaoFinalAIPrompt(profile, message, track, candidates, links)
	return fmt.Sprintf(`%s

DeepSeek 联网复核意见（只作为整改建议，不是最终表格；请你作为第二轮 GPT 自行核对、取舍、重排）：
%s

终稿要求：
- 你必须根据 DS 指出的纠错建议修正明显错误位次和风险档位。
- 如果 DS 指出某校实际位次远高于/远低于 GPT 第一轮，应在终稿中调整或删除，不要机械照搬第一轮。
- DS 只提供建议，最终推荐表由你综合 GPT 第一轮联网数据、DS 复核意见和实时联网核对后整理。
- 推荐专业如果有真实专业级最低位次，必须在专业名后保留标记：[专业最低位次:整数]，例如 自动化[专业最低位次:38620]；没有真实专业位次则不要写标记，严禁所有专业复用同一个学校最低位次。
- 最终推荐必须有真实冲稳保梯度，不能全部比考生位次门槛更低。以4万位为例，必须包含若干约3.3万-3.9万位的冲刺项，再搭配接近4万位的稳和4万位以后的保底。`, base, dsReviewText)
}

func buildGaokaoFinalAIPrompt(profile services.GaokaoProfile, message, track string, candidates []gaokaoAICandidate, links []services.GaokaoAdvisorEvidenceLink) string {
	payload, _ := json.MarshalIndent(candidates, "", "  ")
	var src strings.Builder
	for i, l := range links {
		if i >= 8 {
			break
		}
		// 4万位考生不展示民办排名链接，避免误导。
		if profile.Rank < 100000 && strings.Contains(l.Title, "民办") {
			continue
		}
		fmt.Fprintf(&src, "- %s：%s\n", l.Title, l.URL)
	}
	return fmt.Sprintf(`请基于 validated_candidates 写一份完整《高考志愿规划报告》。

硬规则：
1. 只能使用 validated_candidates 中的学校，严禁新增任何学校。
2. 进入%s专项，只写%s方案。
3. 层次必须写清：985/211/双一流/公办一本/公办二本等。
4. 表格列必须是：学校、城市、层次、2025参考最低位次、推荐专业、录取概率、保研率（约）、深造率（约）、就业特色、推荐指数。
5. 不要出现“全国参考排名”这几个字；如需表达学校实力，只写“学校层次/院校特色”，录取相关只写“2025参考最低位次”。
6. 学校最低位次口径：展示该校在本省本批次、符合选科的可报专业组/院校组中“收分最低、位次最大”的学校最低位次；不是专业最低位次，也不是学校排名。
7. 如果 candidate 有 verified_min_rank，表格“2025参考最低位次”必须展示这个明确整数（如 31331），不得改写成区间、约数或大概值。
8. 对录取概率/保研率/深造率标注“约/参考/经验估计，非官方概率”。
9. 推荐专业的专业最低位次必须是该专业/专业组的真实去年最低录取位次；不能把学校最低位次复制给每个专业。没有查到专业级数据时，只写专业名称，不要声称专业最低位次。
10. 禁止出现“很好录取”“稳录取”“包录取”“高概率”这类绝对化/口语化判断；只能写“极限冲/冲/临界稳/稳/保”和非官方概率。
11. 必须包含冲刺项：冲刺学校的学校最低位次应优于考生当前位次但不要离谱，例如4万位考生应包含若干约3.3万-3.9万位学校；不能整表都是4万位以后/门槛更低的稳保。
12. 写作风格参考专业志愿规划 Word 报告：考生基本情况、最终志愿推荐、院校优势概览、推荐专业排序、最终填报建议、免责声明。

考生：%s，%s，%d分，位次%d。
专业偏好：%s。
用户补充：%s。

validated_candidates JSON：
%s

可复核来源：
%s`, track, track, profile.Province, profile.Subjects, profile.Score, profile.Rank, strings.Join(profile.PreferredMajors, "、"), message, string(payload), src.String())
}

func validateGaokaoFinalMarkdown(profile services.GaokaoProfile, md string, candidates []gaokaoAICandidate) error {
	if strings.TrimSpace(md) == "" {
		return fmt.Errorf("终稿为空")
	}
	for _, banned := range []string{"全国参考排名", "很好录取", "稳录取", "包录取", "高概率", "5686"} {
		if strings.Contains(md, banned) {
			return fmt.Errorf("终稿包含禁用表达：%s", banned)
		}
	}
	if profile.Rank > 0 && profile.Rank < 100000 {
		bad := []string{"文达", "安徽文达", "191410", "187484", "录取位次19万", "19万位", "20万位"}
		for _, kw := range bad {
			if strings.Contains(md, kw) {
				return fmt.Errorf("终稿包含高位次考生禁入内容：%s", kw)
			}
		}
	}
	allowed := map[string]bool{}
	for _, c := range candidates {
		allowed[c.School] = true
	}
	privateNames := []string{"安徽文达信息工程学院", "安徽新华学院", "安徽三联学院"}
	for _, name := range privateNames {
		if strings.Contains(md, name) && !allowed[name] {
			return fmt.Errorf("终稿包含未验证院校：%s", name)
		}
	}
	return nil
}
