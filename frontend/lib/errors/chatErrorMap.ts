import type { UserFacingError } from "./types";

export function mapChatError(raw: string): Partial<UserFacingError> | null {
  const message = raw.trim();
  if (!message) return null;

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

  if (/model.*unavailable|模型.*不可用|provider.*unavailable|上游模型暂时不可用/i.test(message)) {
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

  if (/stream.*(closed|中断)|连接中断|无法读取流/i.test(message)) {
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
