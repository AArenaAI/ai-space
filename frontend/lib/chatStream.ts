import { normalizeError } from "@/lib/errors";

export type ChatStreamCallbacks = {
  onDelta?: (delta: string, fullText: string) => void;
  onDone?: (fullText: string) => void;
  onError?: (error: Error) => void;
  onMeta?: (meta: Record<string, unknown>) => void;
};

function stringifyDelta(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => stringifyDelta(item)).filter(Boolean).join("");
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return stringifyDelta(obj.text || obj.content || obj.summary || obj.delta || obj.value || "");
  }
  return "";
}

function extractDeltaFromPayload(payload: any): string {
  const choice = payload?.choices?.[0];
  const rawDelta = choice?.delta || {};
  return stringifyDelta(rawDelta.content) || stringifyDelta(choice?.message?.content) || stringifyDelta(payload?.message?.content) || stringifyDelta(payload?.content);
}

export async function consumeChatStream(response: Response, callbacks: ChatStreamCallbacks = {}): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw normalizeError("无法读取流", { module: "chat", fallbackMessage: "连接中断，已保留当前内容，可稍后重试。" });

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const processEvent = (eventText: string) => {
    const lines = eventText.split("\n");
    let data = "";

    for (const line of lines) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("data: ")) data += line.slice(6);
      else if (line.startsWith("data:")) data += line.slice(5).trimStart();
    }

    if (!data) return;
    if (data === "[DONE]") {
      callbacks.onDone?.(fullText);
      return;
    }

    try {
      const parsed = JSON.parse(data);

      if (parsed._error || parsed._error_meta) {
        const userError = normalizeError(parsed._error || parsed._error_meta || parsed, { module: "chat", fallbackMessage: "生成失败，请稍后重试。" });
        const error = Object.assign(new Error(userError.message), userError);
        callbacks.onError?.(error);
        throw error;
      }

      if (parsed._chat_meta || parsed._generation_task || parsed._background_task || parsed._activity_meta || parsed._search_meta) {
        callbacks.onMeta?.(parsed);
        return;
      }

      const delta = extractDeltaFromPayload(parsed);
      if (delta) {
        fullText += delta;
        callbacks.onDelta?.(delta, fullText);
      }
    } catch (err) {
      if (err instanceof Error && err.message !== "Unexpected end of JSON input") {
        throw err;
      }
      fullText += data;
      callbacks.onDelta?.(data, fullText);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const eventText = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        processEvent(eventText);
        idx = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) processEvent(buffer.trim());
    return fullText.trim();
  } finally {
    reader.releaseLock();
  }
}
