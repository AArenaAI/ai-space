import type { Message } from "@/lib/chatTypes";
import { isMessageGenerating } from "@/lib/chatContent";

function isTerminalGenerationStatus(status?: string) {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "incomplete";
}

function hasCompletedAssistantContent(message: Message) {
  return message.role === "assistant" && Boolean(message.content?.trim());
}

function hasExplicitGenerationAnchor(message: Message) {
  return Boolean(message.generationTaskId || message.backgroundTaskId || message.useBackground || message.isComplexTask);
}

export type ConversationGenerationStatus = "idle" | "pending" | "streaming" | "polling" | "stopped" | "completed" | "failed";

export type ConversationGenerationState = {
  conversationId: number;
  status: ConversationGenerationStatus;
  localMessageId?: string;
  serverMessageId?: number;
  generationTaskId?: number;
  updatedAt: number;
};

export type ConversationGenerationStore = Record<number, ConversationGenerationState | undefined>;

export function setConversationGenerationState(
  store: ConversationGenerationStore,
  conversationId: number | undefined,
  patch: Omit<Partial<ConversationGenerationState>, "conversationId" | "updatedAt"> & { status: ConversationGenerationStatus },
  now = Date.now()
): ConversationGenerationStore {
  if (!conversationId) return store;
  return {
    ...store,
    [conversationId]: {
      ...(store[conversationId] || { conversationId }),
      ...patch,
      conversationId,
      updatedAt: now,
    },
  };
}

export function clearConversationGenerationState(
  store: ConversationGenerationStore,
  conversationId: number | undefined,
  now = Date.now()
): ConversationGenerationStore {
  if (!conversationId) return store;
  return setConversationGenerationState(store, conversationId, { status: "idle" }, now);
}

export function isConversationGenerationActive(state?: ConversationGenerationState): boolean {
  return state?.status === "pending" || state?.status === "streaming" || state?.status === "polling";
}

export function inferConversationGenerationState(input: {
  conversationId?: number;
  messages: Message[];
  hasActiveTaskStream?: boolean;
  hasCurrentPoller?: boolean;
  hasPendingLocalAssistant?: boolean;
  hasMainStream?: boolean;
  previous?: ConversationGenerationState;
  now?: number;
}): ConversationGenerationState | undefined {
  const { conversationId } = input;
  if (!conversationId) return undefined;
  const now = input.now ?? Date.now();
  const latestAssistantIndex = (() => {
    for (let index = input.messages.length - 1; index >= 0; index -= 1) {
      if (input.messages[index]?.role === "assistant") return index;
    }
    return -1;
  })();
  const hasTerminalGenerationMessage = input.messages.some((message) => isTerminalGenerationStatus(message.serverGenerationStatus));
  const hasRecoverableGeneratingMessage = input.messages.some((message, index) => {
    if (message.role === "assistant" && latestAssistantIndex !== -1 && index < latestAssistantIndex) return false;
    if (isTerminalGenerationStatus(message.serverGenerationStatus)) return false;
    if (!isMessageGenerating(message, false)) return false;
    if (hasCompletedAssistantContent(message) && !hasExplicitGenerationAnchor(message)) return false;
    return true;
  });
  if (input.hasActiveTaskStream && hasRecoverableGeneratingMessage) return { ...(input.previous || { conversationId }), conversationId, status: "streaming", updatedAt: now };
  if (input.hasCurrentPoller && hasRecoverableGeneratingMessage) return { ...(input.previous || { conversationId }), conversationId, status: "polling", updatedAt: now };
  if (input.hasPendingLocalAssistant || hasRecoverableGeneratingMessage || (input.hasMainStream && hasRecoverableGeneratingMessage)) {
    return { ...(input.previous || { conversationId }), conversationId, status: "pending", updatedAt: now };
  }
  if (input.previous && isConversationGenerationActive(input.previous)) {
    return { ...input.previous, status: "idle", updatedAt: now };
  }
  return input.previous;
}
