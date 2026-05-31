import type { ApiErrorPayload } from "./types";

export async function readApiError(res: Response): Promise<ApiErrorPayload> {
  const status = res.status;
  let rawText = "";
  try {
    rawText = await res.text();
  } catch {
    return {
      status,
      code: "response_read_failed",
      message: "服务器响应读取失败",
    };
  }

  if (!rawText || rawText.trim() === "") {
    return {
      status,
      code: "empty_response",
      message: "服务器返回空响应",
      rawText,
    };
  }

  try {
    const data = JSON.parse(rawText) as Record<string, unknown>;
    const code = typeof data.code === "string" ? data.code : typeof data.error_code === "string" ? data.error_code : undefined;
    const error = typeof data.error === "string" ? data.error : undefined;
    const message = typeof data.message === "string" ? data.message : error;
    const debug = typeof data.debug === "string" ? data.debug : typeof data.detail === "string" ? data.detail : undefined;
    return { code, error, message, debug, status, rawText };
  } catch {
    return {
      status,
      code: "non_json_response",
      message: "服务器返回异常",
      rawText: rawText.slice(0, 300),
    };
  }
}

export async function throwApiError(res: Response, fallbackMessage?: string): Promise<never> {
  const payload = await readApiError(res);
  if (!payload.message && fallbackMessage) payload.message = fallbackMessage;
  throw payload;
}
