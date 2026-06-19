package api

import "strings"

const (
	defaultVideoGenerationErrorMessage = "视频生成失败，请稍后再试。若多次失败，请换个提示词或素材。"
	defaultImageGenerationErrorMessage = "图片生成失败，请稍后再试。若多次失败，请换个提示词或参考图。"
)

// cleanVideoGenerationErrorMessage converts provider/SDK errors into user-facing copy.
// Keep raw provider errors in logs only; never expose JSON blobs, request IDs, or SDK stack text to users.
func cleanVideoGenerationErrorMessage(err error) string {
	if err == nil {
		return defaultVideoGenerationErrorMessage
	}
	return cleanGenerationErrorString(err.Error(), "video")
}

func cleanVideoGenerationErrorString(raw string) string {
	return cleanGenerationErrorString(raw, "video")
}

func cleanVideoTaskSubmissionErrorMessage(err error) string {
	if err == nil {
		return defaultVideoGenerationErrorMessage
	}
	message := strings.TrimSpace(err.Error())
	lower := strings.ToLower(message)
	if containsAny(lower, "timeout", "deadline exceeded", "context deadline", "timed out") ||
		containsAny(message, "超时") {
		return "视频任务提交超时，请稍后重新提交。"
	}
	if containsAny(lower, "quota", "insufficient", "balance", "billing", "credit", "credits") ||
		containsAny(message, "额度", "余额", "欠费", "扣费", "积分") {
		return "当前生成服务额度不足，暂时无法完成生成。请稍后再试，"
	}
	if containsAny(lower, "unauthorized", "authentication", "permission", "api key", "apikey", "access denied", "401", "403") ||
		containsAny(message, "认证", "鉴权", "无权限", "未授权", "密钥") {
		return "生成服务暂时不可用，请稍后再试。"
	}
	if detail := extractProviderErrorDetail(message); detail != "" {
		return "视频任务提交失败：" + detail
	}
	if summary := summarizeProviderSubmissionError(message); summary != "" {
		return "视频任务提交失败：" + summary
	}
	return cleanVideoGenerationErrorMessage(err)
}

func extractProviderErrorDetail(message string) string {
	text := strings.TrimSpace(strings.ReplaceAll(message, "\n", " "))
	if text == "" {
		return ""
	}
	lower := strings.ToLower(text)
	// Prefer the provider's concrete parameter/safety message over our broad category copy.
	for _, marker := range []string{"message:", "error message:", "error_message:", "msg:"} {
		if idx := strings.LastIndex(lower, marker); idx >= 0 {
			detail := strings.TrimSpace(text[idx+len(marker):])
			return sanitizeProviderDetail(detail)
		}
	}
	if containsAny(lower, "duration", "resolution", "ratio", "reference", "first_frame", "last_frame", "image", "video") && len([]rune(text)) <= 220 {
		return sanitizeProviderDetail(text)
	}
	return ""
}

func sanitizeProviderDetail(detail string) string {
	detail = strings.TrimSpace(strings.Trim(detail, `"'`))
	for _, marker := range []string{"request id", "request_id", "requestId"} {
		lower := strings.ToLower(detail)
		if idx := strings.Index(lower, strings.ToLower(marker)); idx >= 0 {
			detail = strings.TrimSpace(detail[:idx])
		}
	}
	if len([]rune(detail)) > 180 {
		runes := []rune(detail)
		detail = string(runes[:180]) + "..."
	}
	return strings.TrimSpace(detail)
}

func summarizeProviderSubmissionError(message string) string {
	text := strings.TrimSpace(strings.ReplaceAll(message, "\n", " "))
	if text == "" {
		return ""
	}
	for _, prefix := range []string{"create video task failed:", "failed to create task:", "CreateContentGenerationTask"} {
		if idx := strings.Index(strings.ToLower(text), strings.ToLower(prefix)); idx >= 0 {
			text = strings.TrimSpace(text[idx+len(prefix):])
		}
	}
	text = strings.ReplaceAll(text, "	", " ")
	text = strings.Join(strings.Fields(text), " ")
	if text == "" {
		return ""
	}
	return sanitizeProviderDetail(text)
}

func cleanImageGenerationErrorMessage(err error) string {
	if err == nil {
		return defaultImageGenerationErrorMessage
	}
	return cleanGenerationErrorString(err.Error(), "image")
}

func cleanImageGenerationErrorString(raw string) string {
	return cleanGenerationErrorString(raw, "image")
}

func cleanGenerationErrorString(raw string, mediaType string) string {
	message := strings.TrimSpace(raw)
	if message == "" {
		return defaultGenerationErrorMessage(mediaType)
	}
	if isLocalReferenceValidationMessage(message) {
		return message
	}
	lower := strings.ToLower(message)

	if containsAny(lower, "sensitive", "content_filter", "contentpolicy", "content policy", "safety", "safe", "moderation", "risk", "policy_violation", "blocked", "forbidden", "inputimagesensitivecontentdetected") ||
		containsAny(message, "敏感", "敏感词", "安全", "违规", "审核", "风控", "不合规", "内容政策", "禁止") {
		return "您的请求无法处理，因为它可能包含敏感词或不合规内容。请修改提示词或更换素材后重试。"
	}

	if containsAny(lower, "privacyinformation", "privacy", "real person", "face", "portrait") ||
		containsAny(message, "真实人物", "真人", "人脸", "人体", "隐私", "肖像") {
		return "您的请求无法处理，因为参考素材可能包含真实人物或隐私信息。请更换素材后重试。"
	}

	if containsAny(lower, "copyright", "copyright restrictions", "policyviolation") ||
		containsAny(message, "版权") {
		return "生成结果触发了版权限制审核。请移除具体影视作品、演员或受版权保护风格的描述后重试。"
	}

	if containsAny(lower, "quota", "insufficient", "balance", "billing", "credit", "credits") ||
		containsAny(message, "额度", "余额", "欠费", "扣费", "积分") {
		return "当前生成服务额度不足，暂时无法完成生成。请稍后再试，"
	}

	if containsAny(lower, "unauthorized", "authentication", "permission", "api key", "apikey", "access denied", "401", "403") ||
		containsAny(message, "认证", "鉴权", "无权限", "未授权", "密钥") {
		return "生成服务暂时不可用，请稍后再试。"
	}

	if containsAny(lower, "rate limit", "ratelimit", "too many requests", "429") ||
		containsAny(message, "频率", "限流", "请求过多", "太频繁") {
		return "当前请求人数较多，请稍后再试。"
	}

	if containsAny(lower, "timeout", "deadline exceeded", "context deadline", "timed out") ||
		containsAny(message, "超时") {
		return "生成等待时间过长，请稍后重试。"
	}

	if containsAny(lower, "invalid", "badrequest", "bad request", "unsupported", "parameter", "param", "size", "resolution", "aspect") ||
		containsAny(message, "参数", "不支持", "尺寸", "分辨率", "比例", "格式") {
		if mediaType == "video" {
			return "当前生成设置不符合视频模型要求，请调整比例、分辨率、时长或参考素材后重试。"
		}
		return "当前生成设置不符合图片模型要求，请调整尺寸、清晰度或参考图后重试。"
	}

	if containsAny(lower, "network", "connection", "connect", "econnreset", "connection reset", "no such host") ||
		containsAny(message, "网络", "连接") {
		return "网络连接不稳定，生成没有完成。请稍后重试，"
	}

	if containsAny(lower, "unavailable", "service", "server", "502", "503", "504", "gateway", "upstream") ||
		containsAny(message, "繁忙", "服务异常", "服务器", "上游") {
		return "生成服务暂时繁忙，请稍后再试。"
	}

	if looksLikeProviderDebugError(message) || !looksUserFacingGenerationError(message) {
		return defaultGenerationErrorMessage(mediaType)
	}

	return message
}

func defaultGenerationErrorMessage(mediaType string) string {
	if mediaType == "video" {
		return defaultVideoGenerationErrorMessage
	}
	return defaultImageGenerationErrorMessage
}

func containsAny(text string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(text, needle) {
			return true
		}
	}
	return false
}

func looksUserFacingGenerationError(message string) bool {
	// Keep short Chinese business errors, but hide provider/SDK/debug blobs.
	if len([]rune(message)) > 120 {
		return false
	}
	return containsAny(message, "请", "失败", "无法", "不能", "稍后", "重试", "不支持", "不足", "必须", "当前", "超过", "仅支持")
}

func isLocalReferenceValidationMessage(message string) bool {
	if looksLikeProviderDebugError(message) || len([]rune(message)) > 120 {
		return false
	}
	return containsAny(message, "参考视频", "参考素材", "参考图") &&
		containsAny(message, "必须", "不能", "仅支持", "超过", "当前", "失败", "不存在", "无权访问")
}

func looksLikeProviderDebugError(message string) bool {
	lower := strings.ToLower(message)
	return strings.Contains(message, "{") ||
		strings.Contains(message, "}") ||
		strings.Contains(message, "<html") ||
		strings.Contains(message, "<!doctype") ||
		strings.Contains(lower, "request id") ||
		strings.Contains(lower, "request_id") ||
		strings.Contains(lower, "error code:") ||
		strings.Contains(lower, "badrequest") ||
		strings.Contains(lower, "create video task failed") ||
		strings.Contains(lower, "failed to create task") ||
		strings.Contains(lower, "get video task failed") ||
		strings.Contains(lower, "openai") ||
		strings.Contains(lower, "sdk") ||
		strings.Contains(lower, "http status") ||
		strings.Contains(lower, "status code") ||
		strings.Contains(lower, "base64") ||
		strings.Contains(lower, "b64_json")
}
