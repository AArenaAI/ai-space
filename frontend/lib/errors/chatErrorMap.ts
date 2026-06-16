import type { UserFacingError } from "./types";

export function mapChatError(raw: string): Partial<UserFacingError> | null {
  const message = raw.trim();
  if (!message) return null;

  if (/OpenAI response status\s*=\s*failed|response status\s*=\s*failed|insufficient[_\s-]?quota|quota[_\s-]?exceeded|billing|credit|balance|额度|积分|余额|provider.*failed|model.*failed|provider.*unavailable|上游.*失败|模型服务.*不可用/i.test(message)) {
    return {
      code: "model_service_unavailable",
      category: "model",
      severity: "error",
      title: "模型服务暂时不可用",
      message: "当前模型服务暂时不可用，请稍后重试，或切换其他模型。",
      action: "switch_model",
      actionLabel: "切换模型",
    };
  }

  if (/context.*length|maximum context|上下文|token.*limit|too many tokens/i.test(message)) {
    return {
      code: "chat_context_too_long",
      category: "chat",
      severity: "warning",
      title: "上下文过长",
      message: "当前会话内容过长，请新建会话或减少文件后重试。",
      action: "retry",
      actionLabel: "新建会话",
    };
  }

  if (/file.*not.*ready|文件.*(解析中|未解析|处理中)|parse.*pending/i.test(message)) {
    return {
      code: "chat_file_not_ready",
      category: "file",
      severity: "info",
      title: "文件仍在解析中",
      message: "文件仍在解析中，完成后再发送。",
      action: "wait",
    };
  }

  if (/search.*not.*support|不支持.*搜索|联网搜索.*不支持|native search/i.test(message)) {
    return {
      code: "chat_search_not_supported",
      category: "model",
      severity: "warning",
      title: "模型不支持联网搜索",
      message: "当前模型不支持联网搜索，请关闭搜索或切换模型。",
      action: "switch_model",
      actionLabel: "切换模型",
    };
  }

  if (/model.*unavailable|模型.*不可用|provider.*unavailable|上游模型暂时不可用|no available model|model not found/i.test(message)) {
    return {
      code: "chat_model_unavailable",
      category: "model",
      severity: "error",
      title: "模型暂不可用",
      message: "当前模型暂不可用，请稍后重试或切换模型。",
      action: "switch_model",
      actionLabel: "切换模型",
    };
  }

  if (/stream.*(closed|中断|unavailable)|sse|eventsource|连接中断|无法读取流|task stream unavailable|missing task stream id/i.test(message)) {
    return {
      code: "chat_stream_interrupted",
      category: "chat",
      severity: "warning",
      title: "连接中断",
      message: "连接中断，已保留当前内容，可稍后重试。",
      action: "retry",
      actionLabel: "重试",
    };
  }

  return null;
}
