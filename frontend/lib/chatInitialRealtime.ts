import { realtimeUpdate } from "./streaming";

export function initializeAssistantRealtime(messageId: string, startedAt: number) {
  realtimeUpdate(messageId, {
    content: "",
    answerContent: "",
    reasoningContent: "",
    phase: "waiting_provider",
    generationStartedAt: startedAt,
  });
}

export function initializeAssistantRealtimeBatch(messages: Array<{ id: string; createdAt?: number }>, startedAt: number) {
  messages.forEach((message) => initializeAssistantRealtime(message.id, message.createdAt || startedAt));
}
