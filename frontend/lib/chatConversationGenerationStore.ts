import type { Message } from "@/lib/chatTypes";
import { isMessageGenerating } from "@/lib/chatContent";

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
  const hasGeneratingMessage = input.messages.some((message) => isMessageGenerating(message, false));
  if (input.hasActiveTaskStream) return { ...(input.previous || { conversationId }), conversationId, status: "streaming", updatedAt: now };
  if (input.hasCurrentPoller) return { ...(input.previous || { conversationId }), conversationId, status: "polling", updatedAt: now };
  if (input.hasPendingLocalAssistant || hasGeneratingMessage || (input.hasMainStream && hasGeneratingMessage)) {
    return { ...(input.previous || { conversationId }), conversationId, status: "pending", updatedAt: now };
  }
  if (input.previous && isConversationGenerationActive(input.previous)) {
    return { ...input.previous, status: "idle", updatedAt: now };
  }
  return input.previous;
}
