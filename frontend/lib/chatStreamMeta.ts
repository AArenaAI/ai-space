export type ChatStreamPayload =
  | { type: "chat_meta"; meta: any; requestId: string }
  | { type: "generation_task"; task: any }
  | { type: "background_task"; task: any }
  | { type: "error"; error: any; message: string; errorCode: string; retryable: boolean; requestId?: string }
  | { type: "activity"; meta: any }
  | { type: "search"; meta: any }
  | { type: "delta"; rawDelta: any };

export function normalizeChatStreamPayload(parsed: any): ChatStreamPayload {
  if (parsed?._chat_meta) {
    const meta = parsed._chat_meta;
    return {
      type: "chat_meta",
      meta,
      requestId: meta.request_id || "",
    };
  }

  if (parsed?._generation_task) {
    return { type: "generation_task", task: parsed._generation_task };
  }

  if (parsed?._background_task) {
    return { type: "background_task", task: parsed._background_task };
  }

  if (parsed?._error || parsed?._error_meta) {
    const error = parsed._error || parsed._error_meta;
    return {
      type: "error",
      error,
      message: error.message || error.user_message || "请求失败",
      errorCode: error.error_code || error.code || "unknown",
      retryable: error.retryable === true || error.retriable === true,
      requestId: error.request_id,
    };
  }

  if (parsed?._activity_meta) {
    return { type: "activity", meta: parsed._activity_meta };
  }

  if (parsed?._search_meta) {
    return { type: "search", meta: parsed._search_meta };
  }

  return {
    type: "delta",
    rawDelta: parsed?.choices?.[0]?.delta || {},
  };
}
