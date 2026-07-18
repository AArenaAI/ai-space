package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type GaokaoModelFirstReportResult struct {
	Markdown string
	Status   string
	Review   string
}

func GenerateGaokaoModelFirstReport(ctx context.Context, profile GaokaoProfile, message string, report GaokaoProfessionalReport, links []GaokaoAdvisorEvidenceLink) (GaokaoModelFirstReportResult, error) {
	contextText := buildGaokaoReportContext(profile, message, report, links)
	draftPrompt := `你是资深高考志愿规划老师。请根据以下考生信息、候选院校参考、公开来源，写一份完整自然语言志愿规划报告。
要求：
1. 以考生/家长能读懂的报告口吻写，不要提及模型、provider、DeepSeek、OpenAI、后台流程。
2. 允许给经验概率和参考位次，但必须说明“经验估计，非官方概率”。
3. 报告必须包含：考生画像、总体策略、冲刺/稳妥/保底建议、Top10重点院校、专业排序、风险与复核、来源说明。
4. 不要把“联网待复核”“候选数据为空”“请提供候选”这类生产者语句写给用户。
5. 如果某些数据不足，用“需以考试院/高校官网复核”表达，不要中断报告。

材料：
` + contextText
	draft, err := callGaokaoReportRawModel(ctx, "openai", gaokaoReportOpenAIModel(), draftPrompt, 7600)
	if err != nil {
		return GaokaoModelFirstReportResult{}, err
	}
	reviewPrompt := `你是高考志愿报告复核员。检查下面报告是否存在：学校不真实、位次明显不合理、本科/专科混用、把估计当官方事实、遗漏风险、表达误导。只输出复核意见，给最终写手修改用，不要重写全文。

考生和材料：
` + contextText + `

初稿：
` + draft
	review, reviewErr := callGaokaoReportRawModel(ctx, "deepseek", "deepseek-v4-pro", reviewPrompt, 1600)
	if reviewErr != nil {
		review = "复核模型暂不可用；终稿需保留来源复核和经验估计说明。"
	}
	finalPrompt := `你是资深高考志愿规划老师。请根据初稿和复核意见，输出最终版完整自然语言报告。
要求：
- 只输出给用户看的报告正文，Markdown 格式。
- 不要提及 GPT、DeepSeek、OpenAI、多模型、复核模型、provider、后台流程。
- 不要出现“候选数据为空”“请提供候选数据”“联网待复核”这类生产者话术。
- 报告要像专业志愿规划文档，不要像后端数据面板。
- 对估计概率/参考位次必须标注“经验估计/参考”。

材料：
` + contextText + `

初稿：
` + draft + `

复核意见：
` + review
	final, err := callGaokaoReportRawModel(ctx, "openai", gaokaoReportOpenAIModel(), finalPrompt, 9000)
	if err != nil {
		return GaokaoModelFirstReportResult{}, err
	}
	final = sanitizeGaokaoFinalReportMarkdown(final)
	return GaokaoModelFirstReportResult{Markdown: final, Status: "model_first:gpt_primary:deepseek_review", Review: review}, nil
}

func gaokaoReportOpenAIModel() string {
	for _, key := range []string{"GAOKAO_REPORT_MODEL", "OPENAI_MODEL"} {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
	}
	return "gpt-5.5"
}

func buildGaokaoReportContext(profile GaokaoProfile, message string, report GaokaoProfessionalReport, links []GaokaoAdvisorEvidenceLink) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("考生：%s，%s，%d分，位次%d。\n", profile.Province, profile.Subjects, profile.Score, profile.Rank))
	if len(profile.PreferredMajors) > 0 {
		b.WriteString("意向专业：" + strings.Join(profile.PreferredMajors, "、") + "。\n")
	}
	if len(profile.RejectedMajors) > 0 {
		b.WriteString("排除专业：" + strings.Join(profile.RejectedMajors, "、") + "。\n")
	}
	if message != "" {
		b.WriteString("用户补充：" + message + "\n")
	}
	b.WriteString("\n候选参考（仅作报告材料，可重新取舍排序）：\n")
	for i, item := range report.TopRecommendations {
		if i >= 16 {
			break
		}
		b.WriteString(fmt.Sprintf("- %s｜%s｜推荐专业：%s｜参考位次：%s｜经验概率：%s｜理由：%s\n", item.School, item.SchoolLevel, item.RecommendedMajors, item.ReferenceRank, item.AdmissionChance, item.WhyRecommend))
	}
	if len(report.MajorRanking) > 0 {
		b.WriteString("\n专业排序参考：\n")
		for _, item := range report.MajorRanking {
			b.WriteString(fmt.Sprintf("- %d. %s：%s，%s\n", item.Rank, item.Major, item.RecommendIndex, item.Reason))
		}
	}
	allLinks := append([]GaokaoAdvisorEvidenceLink{}, report.EvidenceLinks...)
	allLinks = append(allLinks, links...)
	if len(allLinks) > 0 {
		b.WriteString("\n可核验来源：\n")
		seen := map[string]bool{}
		for _, link := range allLinks {
			if link.URL == "" || seen[link.URL] {
				continue
			}
			seen[link.URL] = true
			b.WriteString(fmt.Sprintf("- %s：%s\n", fallbackText(link.Title, "来源"), link.URL))
		}
	}
	return b.String()
}

func callGaokaoReportRawModel(ctx context.Context, provider, model, prompt string, maxTokens int) (string, error) {
	cfg, ok := gaokaoAdvisorModelConfig(provider)
	if !ok {
		return "", fmt.Errorf("report model provider %s not configured", provider)
	}
	if strings.TrimSpace(model) != "" {
		cfg.Model = strings.TrimSpace(model)
	}
	body := map[string]interface{}{
		"model": cfg.Model,
		"messages": []map[string]string{
			{"role": "system", "content": "你是资深高考志愿规划师，擅长生成自然语言志愿规划报告。"},
			{"role": "user", "content": prompt},
		},
	}
	if strings.HasPrefix(strings.ToLower(cfg.Model), "gpt-5") {
		body["max_completion_tokens"] = maxTokens
	} else {
		body["temperature"] = 0.35
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
	client := &http.Client{Timeout: 150 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("report model http %d: %s", resp.StatusCode, truncateGaokaoAdvisorText(string(data), 300))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil || len(parsed.Choices) == 0 {
		return "", fmt.Errorf("invalid report model response")
	}
	content := strings.TrimSpace(parsed.Choices[0].Message.Content)
	if content == "" {
		return "", fmt.Errorf("empty report model response")
	}
	return content, nil
}
