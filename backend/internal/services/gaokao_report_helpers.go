package services

import "strings"

func fallbackText(value string, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func sanitizeGaokaoFinalReportMarkdown(text string) string {
	text = cleanGaokaoFinalReportMarkdown(text)
	for _, phrase := range []string{
		"当前没有足够可靠候选，建议继续补充官方投档线和高校招生计划后再定稿。",
		"候选数据为空",
		"请提供候选数据",
		"联网待复核",
	} {
		text = strings.ReplaceAll(text, phrase, "")
	}
	return strings.TrimSpace(text)
}
