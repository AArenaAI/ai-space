package services

import "strings"

// IsDocumentOverviewQuery 判断用户问题是否属于文档/日志级概览分析请求。
// 概览问题会走确定性 chunk 选择策略（开头+关键词+结尾），
// 而不是走 RAG 检索。
func IsDocumentOverviewQuery(query string) bool {
	q := strings.TrimSpace(strings.ToLower(query))
	if q == "" {
		return false
	}

	keywords := []string{
		"总结",
		"概括",
		"分析",
		"解析",
		"这是什么",
		"看下",
		"帮我看",
		"文档内容",
		"主要内容",
		"提取重点",
		"日志",
		"报告",
		"整理一下",
		"summary",
		"summarize",
		"analyze",
		"what is this",
		"overview",
		"describe",
	}

	for _, kw := range keywords {
		if strings.Contains(q, kw) {
			return true
		}
	}

	return false
}
