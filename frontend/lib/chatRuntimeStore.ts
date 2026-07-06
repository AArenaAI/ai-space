import type { Message } from "./chatTypes";

export type ConversationRuntimeScrollState = {
  distanceToBottom?: number;
  atBottom?: boolean;
  updatedAt?: number;
  [key: string]: unknown;
};

export type ConversationRuntimeActivityTarget = {
  messageId?: string | number;
  column?: "left" | "right" | string;
  [key: string]: unknown;
};

export type ConversationRuntimeSlice = {
  conversationId: number;
  messages: Partial<Message>[];
  generationTasks: Record<string, unknown>;
  activeStreams: Record<string, unknown>;
  pendingOptimisticMessages: Partial<Message>[];
  compareModels: string[];
  activityTarget?: ConversationRuntimeActivityTarget;
  scrollState?: ConversationRuntimeScrollState;
  restoreVersion?: number;
  updatedAt?: number;
};

export type ConversationRuntimeSnapshot = {
  activeConversationId?: number;
  conversations: Map<number, ConversationRuntimeSlice>;
};

type ConversationRuntimeSubscriber = (snapshot: ConversationRuntimeSnapshot) => void;

function createEmptyConversationRuntimeSlice(conversationId: number): ConversationRuntimeSlice {
  return {
    conversationId,
    messages: [],
    generationTasks: {},
    activeStreams: {},
    pendingOptimisticMessages: [],
    compareModels: [],
  };
}

function cloneSlice(slice: ConversationRuntimeSlice): ConversationRuntimeSlice {
  return {
    ...slice,
    messages: [...slice.messages],
    generationTasks: { ...slice.generationTasks },
    activeStreams: { ...slice.activeStreams },
    pendingOptimisticMessages: [...slice.pendingOptimisticMessages],
    compareModels: [...slice.compareModels],
    activityTarget: slice.activityTarget ? { ...slice.activityTarget } : undefined,
    scrollState: slice.scrollState ? { ...slice.scrollState } : undefined,
  };
}

export function createConversationRuntimeStore() {
  let activeConversationId: number | undefined;
  const conversations = new Map<number, ConversationRuntimeSlice>();
  const subscribers = new Set<ConversationRuntimeSubscriber>();
  let cachedSnapshot: ConversationRuntimeSnapshot | undefined;

  const invalidateSnapshot = () => {
    cachedSnapshot = undefined;
  };

  const snapshot = (): ConversationRuntimeSnapshot => {
    if (cachedSnapshot) return cachedSnapshot;
    cachedSnapshot = {
      activeConversationId,
      conversations: new Map(Array.from(conversations.entries()).map(([id, slice]) => [id, cloneSlice(slice)])),
    };
    return cachedSnapshot;
  };

  const notify = () => {
    const current = snapshot();
    subscribers.forEach((subscriber) => subscriber(current));
  };

  const ensureConversation = (conversationId: number) => {
    const existing = conversations.get(conversationId);
    if (existing) return existing;
    const created = createEmptyConversationRuntimeSlice(conversationId);
    conversations.set(conversationId, created);
    return created;
  };

  return {
    subscribe(subscriber: ConversationRuntimeSubscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    getSnapshot: snapshot,
    getConversation(conversationId: number) {
      return cloneSlice(ensureConversation(conversationId));
    },
    patchConversation(conversationId: number, patch: Partial<Omit<ConversationRuntimeSlice, "conversationId">>) {
      const existing = ensureConversation(conversationId);
      conversations.set(conversationId, {
        ...existing,
        ...patch,
        conversationId,
        messages: patch.messages ? [...patch.messages] : existing.messages,
        generationTasks: patch.generationTasks ? { ...patch.generationTasks } : existing.generationTasks,
        activeStreams: patch.activeStreams ? { ...patch.activeStreams } : existing.activeStreams,
        pendingOptimisticMessages: patch.pendingOptimisticMessages ? [...patch.pendingOptimisticMessages] : existing.pendingOptimisticMessages,
        compareModels: patch.compareModels ? [...patch.compareModels] : existing.compareModels,
        activityTarget: patch.activityTarget ? { ...patch.activityTarget } : existing.activityTarget,
        scrollState: patch.scrollState ? { ...patch.scrollState } : existing.scrollState,
      });
      invalidateSnapshot();
      notify();
    },
    setActiveConversation(conversationId?: number) {
      activeConversationId = conversationId;
      if (conversationId !== undefined) ensureConversation(conversationId);
      invalidateSnapshot();
      notify();
    },
    deleteConversation(conversationId: number) {
      conversations.delete(conversationId);
      if (activeConversationId === conversationId) activeConversationId = undefined;
      invalidateSnapshot();
      notify();
    },
    clear() {
      conversations.clear();
      activeConversationId = undefined;
      invalidateSnapshot();
      notify();
    },
  };
}
