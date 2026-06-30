import type { Message } from "./chatTypes";
export type ChatErrorStateInput = Partial<Pick<Message, "content" | "errorCode" | "serverGenerationStatus" | "stopped" | "retryable">> & {
  phase?: string;
};

export function isAssistantFailureState(input: ChatErrorStateInput): boolean {
  const content = (input.content || "").trim().toLowerCase();
  return Boolean(
    input.errorCode ||
    (input.stopped && !content) ||
    input.serverGenerationStatus === "failed" ||
    input.phase === "failed" ||
    content === "failed to fetch" ||
    /^生成失败\s*[:：]/.test(content) ||
    content.includes("generation cancelled") ||
    content.includes("networkerror") ||
    content.includes("load failed")
  );
}

export function getAssistantFailureCopy(input: ChatErrorStateInput, t: (key: string, params?: Record<string, string>) => string) {
  const raw = (input.content || input.errorCode || "").trim();
  const normalized = raw.toLowerCase();
  if (input.stopped && !raw) {
    return t("chat.error.cancelledInline");
  }
  if (normalized.includes("generation cancelled") || /^生成失败\s*[:：]/.test(normalized)) {
    return t("chat.error.cancelledInline");
  }
  if (!raw || normalized === "failed to fetch" || normalized.includes("networkerror") || normalized.includes("load failed")) {
    return t("chat.error.networkInline");
  }
  if (normalized.includes("insufficient") || normalized.includes("balance") || normalized.includes("credit") || normalized.includes("quota")) {
    return t("chat.error.balanceInline");
  }
  return raw.length > 96 ? t("chat.error.genericInline") : raw;
}
