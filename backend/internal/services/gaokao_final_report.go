package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

func BuildGaokaoFinalReportMarkdown(profile GaokaoProfile, _ string, report GaokaoProfessionalReport, links []GaokaoAdvisorEvidenceLink) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s%s志愿规划报告\n\n", profile.Province, profile.Subjects)
	b.WriteString("## 一、考生画像\n\n")
	b.WriteString(report.ProfileSummary + "\n\n")
	b.WriteString("## 二、总体策略\n\n")
	b.WriteString(report.StrategySummary + "\n\n")
	b.WriteString("## 三、院校建议\n\n")
	for _, band := range []string{"冲", "稳", "保"} {
		fmt.Fprintf(&b, "### %s\n\n", band)
		items := report.Bands[band]
		if len(items) == 0 {
			b.WriteString("建议补充该梯度院校，最终以考试院和高校招生网复核。\n\n")
			continue
		}
		for _, item := range items {
			fmt.Fprintf(&b, "- **%s**（%s｜%s）：推荐专业 %s，2025参考最低位次 %s，经验概率 %s。%s\n", item.School, item.City, item.SchoolLevel, item.RecommendedMajors, item.ReferenceRank, item.AdmissionChance, item.WhyRecommend)
		}
		b.WriteString("\n")
	}
	b.WriteString("## 四、最终建议\n\n")
	if len(report.FinalSuggestion.Chong) > 0 {
		fmt.Fprintf(&b, "- 冲刺：%s\n", strings.Join(report.FinalSuggestion.Chong, "、"))
	}
	if len(report.FinalSuggestion.Core) > 0 {
		fmt.Fprintf(&b, "- 主力：%s\n", strings.Join(report.FinalSuggestion.Core, "、"))
	}
	if len(report.FinalSuggestion.Safe) > 0 {
		fmt.Fprintf(&b, "- 保底：%s\n", strings.Join(report.FinalSuggestion.Safe, "、"))
	}
	b.WriteString("\n## 五、来源与免责声明\n\n")
	for _, l := range links {
		fmt.Fprintf(&b, "- [%s](%s)\n", l.Title, l.URL)
	}
	b.WriteString("\n" + report.Disclaimer + "\n")
	return b.String()
}

func GenerateGaokaoFinalReportMarkdown(ctx context.Context, profile GaokaoProfile, message string, track string, recs []GaokaoRecommendation, links []GaokaoAdvisorEvidenceLink) (string, string, error) {
	materials := buildGaokaoFinalReportMaterials(profile, track, recs, links)
	collegeTrack := strings.Contains(track, "专科") || strings.EqualFold(track, "college")
	tableColumns := "学校、城市、层次、2025参考最低位次、推荐专业、录取概率、保研率（约）、深造率（约）、就业特色、推荐指数"
	collegeRule := "本科专项可使用保研率/深造率等本科口径。"
	dataRule := "2025参考最低位次、保研率、深造率若缺少官方材料，可给行业经验估计并标“约/参考/需复核”，但不能留空。"
	if collegeTrack {
		tableColumns = "学校、城市、层次、2025参考最低位次、推荐专业、录取概率、专升本概率（约）、升学路径、就业特色、推荐指数"
		collegeRule = "专科专项禁止出现保研率、推免率、保研、保送研究生等本科口径；如需升学指标，统一写专升本概率（约）和升学路径。"
		dataRule = "2025参考最低位次、专升本概率、升学路径若缺少官方材料，可给行业经验估计并标“约/参考/需复核”，但不能留空；不得出现保研率/推免率列。"
	}
	draftPrompt := fmt.Sprintf(`你是资深高考志愿规划师。请像 ChatGPT 专业报告一样，基于考生需求和可用材料，生成一份完整自然语言《高考志愿规划报告》初稿。

要求：
1. GPT 主导择校和报告表达，不要写“模型/DeepSeek/OpenAI/候选调试/待复核/初稿/复核意见”等生产者术语。
2. 允许给经验估计的录取概率、专业实力、深造/就业倾向，但必须写明“经验估计，非官方概率”。
3. 不要因为材料缺少逐条官方投档线就空报告；可以用“约/参考/需复核”标注。
4. 必须包含：考生画像、总体策略、冲刺/稳妥/保底院校建议、最推荐Top10、专业排序、风险提示、来源与复核说明。
5. 进入%s专项，只做%s相关建议，不要混入其它批次。
6. 注意：考生省份是考试省份，不等于城市/地域偏好；除非用户明确“只看省内/偏好安徽”，否则必须全国择优，不能 Top10 全是本省院校。
7. 院校表必须使用 Markdown 表格，并至少包含这些列：%s。
8. %s
9. 层次列必须明确写成：985/211/双一流/公办一本/公办二本/民办本科/职业本科/专科/本科院校专科专业。专科专项里，如果学校本身是本科院校但招生专业属于专科批，层次必须写“本科院校专科专业”；独立高职高专写“专科/高职高专”。不能只用“省重点”“电子强校”这类模糊标签。
9. %s
10. 严格位次过滤：严禁推荐录取位次显著高于考生位次的民办本科或低层级院校。例如，考生位次4万左右，推荐的院校最低位次原则上不应超过考生位次的1.5倍（约6万位）；民办本科、职业本科、独立学院只允许出现在考生位次接近本科线或已接近民办本科录取区间时使用。绝对不能把录取位次19万的民办本科推荐给位次4万的考生。
11. 输出 Markdown，正文完整，可直接作为用户报告。

用户补充需求：%s

材料：
%s`, track, track, tableColumns, collegeRule, dataRule, message, materials)
	draft, err := callGaokaoFinalReportChat(ctx, "openai", draftPrompt, 5200)
	log.Printf("[gaokao-final-report] draft len=%d err=%v", len(draft), err)
	if err != nil {
		return "", "draft_error:" + err.Error(), err
	}

	reviewPrompt := fmt.Sprintf(`你是高考志愿报告复核员。请复核下面报告，重点检查：
1. 是否有不适合考生位次的过远推荐；
2. 是否混入错误批次；
3. 是否把“待复核/来源不足”写成确定事实；
4. 是否遗漏明显更适合目标专业的院校；
5. 是否需要补充保底。

只输出复核意见，不要重写全文。

考生与材料：
%s

报告初稿：
%s`, materials, draft)
	review, err := callGaokaoFinalReportChat(ctx, "deepseek", reviewPrompt, 1800)
	if err != nil {
		// DeepSeek is auxiliary. If it fails, still let GPT produce a final report with a self-check instruction.
		review = "复核模型暂不可用。请自行检查：批次一致性、位次风险、经验估计免责声明、保底是否充分、是否避免无来源确定表述。"
	}

	finalPrompt := fmt.Sprintf(`你是资深高考志愿规划师。请根据复核意见，把初稿改成最终版 Markdown 报告。

硬性要求：
- 用户看不到模型流程，不要出现“DeepSeek、OpenAI、GPT、模型委员会、多模型、provider、待复核候选、初稿、复核意见、调整结论”等生产者/过程词。
- 不要出现“没有足够可靠候选所以无法推荐”这种空报告；必须给出可执行的冲/稳/保建议。
- 数据不确定时用“约、参考、需以考试院/高校官网复核”，但仍要给规划建议。
- Top10 不要放非学校名、排名榜单标题、网页标题。
- 注意：考生省份是考试省份，不等于城市/地域偏好；除非用户明确“只看省内/偏好本省”，否则必须全国择优，不能 Top10 全是本省院校。
- 必须输出一张“重点推荐院校表”，Markdown 表格列为：%s。
- %s
- 层次列必须明确写成：985/211/双一流/公办一本/公办二本/民办本科/职业本科/专科/本科院校专科专业。专科专项里，如果学校本身是本科院校但招生专业属于专科批，层次必须写“本科院校专科专业”；独立高职高专写“专科/高职高专”。不要写“省重点”“电子强校”等模糊标签。
- 每所学校必须写出学校特点/就业特色，不能只写学校名和概率。
- 语言要像完整的 ChatGPT 志愿规划报告，而不是后端数据面板。
- 保留免责声明：录取概率为经验估计，非官方概率。
- 严格位次过滤：严禁把录取位次远高于考生位次的民办本科/职业本科/独立学院推荐给位次较高的考生。如考生位次4万，推荐院校最低位次原则上不超过约6万；民办本科只应在考生位次接近民办本科录取区间时使用。

复核意见：
%s

初稿：
%s`, tableColumns, collegeRule, review, draft)
	final, err := callGaokaoFinalReportChat(ctx, "openai", finalPrompt, 6200)
	log.Printf("[gaokao-final-report] final len=%d err=%v", len(final), err)
	if err != nil {
		return draft, "final_error_used_draft:" + err.Error(), err
	}
	final = cleanGaokaoFinalReportMarkdown(final)
	log.Printf("[gaokao-final-report] cleaned final len=%d", len(final))
	if strings.TrimSpace(final) == "" {
		return draft, "final_empty_used_draft", nil
	}
	return final, "called:openai:gpt-final+deepseek-review", nil
}

func buildGaokaoFinalReportMaterials(profile GaokaoProfile, track string, recs []GaokaoRecommendation, links []GaokaoAdvisorEvidenceLink) string {
	var b strings.Builder
	fmt.Fprintf(&b, "考生：%s，%s，%d分，位次%d。目标：%s专项。\n", profile.Province, profile.Subjects, profile.Score, profile.Rank, track)
	b.WriteString("重要地域规则：省份表示考试省份，不代表城市偏好；除非用户明确只看省内，否则需全国择优，避免只推荐本省学校。\n")
	fmt.Fprintf(&b, "专业偏好：%s；排除专业：%s；城市偏好：%s；策略：%s；学费上限：%d；中外合作：%v；服从调剂：%v\n", strings.Join(profile.PreferredMajors, "、"), strings.Join(profile.RejectedMajors, "、"), strings.Join(profile.PreferredCities, "、"), profile.Strategy, profile.TuitionLimit, profile.AcceptCooperation, profile.ObeyAdjustment)
	b.WriteString("\n参考候选（仅作上下文，不要求逐条照搬）：\n")
	limit := 24
	if len(recs) < limit {
		limit = len(recs)
	}
	for i := 0; i < limit; i++ {
		r := recs[i]
		fmt.Fprintf(&b, "%d. [%s] %s｜%s｜%s｜专业/组：%s/%s｜近年位次：%v｜来源：%s\n", i+1, r.Band, r.School, r.City, r.Level, r.MajorGroup, r.Major, r.Ranks, r.Source)
	}
	b.WriteString("\n可点击来源链接：\n")
	linkLimit := 10
	if len(links) < linkLimit {
		linkLimit = len(links)
	}
	for i := 0; i < linkLimit; i++ {
		l := links[i]
		fmt.Fprintf(&b, "- %s：%s (%s)\n", l.Title, l.URL, l.Kind)
	}
	if linkLimit == 0 {
		b.WriteString("- 暂无可用链接，报告仍需提醒用户到省考试院/高校招生网复核。\n")
	}
	return b.String()
}

func callGaokaoFinalReportChat(ctx context.Context, provider string, prompt string, maxTokens int) (string, error) {
	cfg, ok := gaokaoAdvisorModelConfig(provider)
	if !ok {
		return "", fmt.Errorf("provider %s not configured", provider)
	}
	if provider == "openai" || provider == "gpt" {
		if strings.TrimSpace(os.Getenv("GPT55_MODEL")) != "" {
			cfg.Model = strings.TrimSpace(os.Getenv("GPT55_MODEL"))
		} else {
			cfg.Model = "gpt-5.5-2026-04-23"
		}
		if strings.Contains(cfg.BaseURL, "cli-proxy-api") || strings.Contains(cfg.BaseURL, "127.0.0.1:8317") || cfg.BaseURL == "" {
			cfg.BaseURL = "https://api.openai.com/v1"
		}
	}
	if provider == "deepseek" && cfg.Model == "" {
		cfg.Model = "deepseek-v4-pro"
	}
	body := map[string]interface{}{
		"model":    cfg.Model,
		"messages": []map[string]string{{"role": "system", "content": "你是高考志愿规划专家，输出中文 Markdown。"}, {"role": "user", "content": prompt}},
	}
	if strings.HasPrefix(cfg.Model, "gpt-5") {
		body["max_completion_tokens"] = maxTokens
	} else {
		body["temperature"] = 0.25
		body["max_tokens"] = maxTokens
	}
	raw, _ := json.Marshal(body)
	url := cfg.BaseURL
	if !strings.HasSuffix(url, "/chat/completions") {
		url += "/chat/completions"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	client := &http.Client{Timeout: 180 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("chat http %d: %s", resp.StatusCode, truncateGaokaoAdvisorText(string(data), 600))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil || len(parsed.Choices) == 0 {
		return "", fmt.Errorf("invalid chat response: %s", truncateGaokaoAdvisorText(string(data), 600))
	}
	return strings.TrimSpace(parsed.Choices[0].Message.Content), nil
}

func cleanGaokaoFinalReportMarkdown(text string) string {
	bad := []string{"DeepSeek", "OpenAI", "GPT", "多模型", "模型委员会", "provider", "待复核候选", "初稿", "复核意见", "调整结论"}
	for _, token := range bad {
		text = strings.ReplaceAll(text, token, "")
	}
	// 用户端报告不展示原始 URL/域名来源码；来源可放在单独来源区，不塞进表格单元格。
	text = regexp.MustCompile(`\((?:https?://)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^)]*\)`).ReplaceAllString(text, "")
	text = regexp.MustCompile(`\[[^\]]+\]\(https?://[^)]+\)`).ReplaceAllString(text, "")
	text = regexp.MustCompile(`https?://\S+`).ReplaceAllString(text, "")
	text = strings.ReplaceAll(text, "utm_source=openai", "")
	for _, token := range []string{"（专业最低位次待核验）", "(专业最低位次待核验)", "专业最低位次待核验", "[专业最低位次:待核验]"} {
		text = strings.ReplaceAll(text, token, "")
	}
	return strings.TrimSpace(text)
}

func SanitizeGaokaoFinalReportMarkdown(text string) string {
	return cleanGaokaoFinalReportMarkdown(text)
}
