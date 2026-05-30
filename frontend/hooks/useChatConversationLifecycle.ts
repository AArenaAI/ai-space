import { useCallback, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Message } from "@/lib/chatTypes";
import {
  buildLoadMorePage,
  fetchLoadMoreMessages,
  mapLoadMoreMessages,
  prependUniqueOlderMessages,
  resolveLoadedPersistedMessages,
  resolveTotalMessages,
  shouldStartLoadMore,
} from "@/lib/chatLoadMoreCoordinator";

export type ChatConversationLifecycleState = {
  conversationTitle: string;
  setConversationTitle: Dispatch<SetStateAction<string>>;
  currentConversation: number | undefined;
  setCurrentConversation: Dispatch<SetStateAction<number | undefined>>;
  totalMessages: number;
  setTotalMessages: Dispatch<SetStateAction<number>>;
  loadedPersistedMessages: number;
  setLoadedPersistedMessages: Dispatch<SetStateAction<number>>;
  isLoadingMore: boolean;
  setIsLoadingMore: Dispatch<SetStateAction<boolean>>;
  hasMoreMessages: boolean;
  conversationLoadSeqRef: MutableRefObject<number>;
  shouldResetRef: MutableRefObject<boolean>;
  justCreatedRef: MutableRefObject<number | undefined>;
  setCreatedConversation: (conversationId: number, title: string) => void;
  resetConversationPagination: () => void;
  applyNavigationResetLifecycle: (plan: ConversationNavigationResetLifecyclePlan) => void;
  applyJustCreatedNavigationLifecycle: (plan: ConversationJustCreatedNavigationLifecyclePlan) => void;
  applyLoadExistingNavigationLifecycle: (plan: ConversationLoadExistingNavigationLifecyclePlan) => void;
};

export type ConversationNavigationResetLifecyclePlan = {
  shouldClearConversationTitle?: boolean;
  conversationTitle: string;
  shouldSetCurrentConversation?: boolean;
  currentConversation?: number | undefined;
  loadedPersistedMessages: number;
  totalMessages: number;
};

export type ConversationJustCreatedNavigationLifecyclePlan = {
  shouldClearJustCreated?: boolean;
  conversationId: number;
  loadedPersistedMessages: number;
  totalMessages: number;
};

export type ConversationLoadExistingNavigationLifecyclePlan = {
  shouldSetCurrentConversation?: boolean;
  conversationId: number;
};

export type CreateLoadMoreMessagesActionInput = {
  apiBaseUrl: string;
  getCurrentConversation: () => number | undefined;
  getIsLoadingMore: () => boolean;
  getHasMoreMessages: () => boolean;
  getTotalMessages: () => number;
  getLoadedPersistedMessages: () => number;
  getToken: () => string | null;
  fallbackId: () => string;
  setIsLoadingMore: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setLoadedPersistedMessages: Dispatch<SetStateAction<number>>;
  setTotalMessages: Dispatch<SetStateAction<number>>;
  fetchPage?: typeof fetchLoadMoreMessages;
  mapMessages?: typeof mapLoadMoreMessages;
  prependMessages?: typeof prependUniqueOlderMessages;
  resolveLoaded?: typeof resolveLoadedPersistedMessages;
  resolveTotal?: typeof resolveTotalMessages;
};

export function hasMorePersistedMessages(totalMessages: number, loadedPersistedMessages: number): boolean {
  return totalMessages > loadedPersistedMessages;
}

export function markConversationCreated(input: {
  shouldResetRef: MutableRefObject<boolean>;
  justCreatedRef: MutableRefObject<number | undefined>;
  conversationId: number;
}) {
  input.shouldResetRef.current = false;
  input.justCreatedRef.current = input.conversationId;
}

export function createSetCreatedConversationAction(input: {
  setConversationTitle: Dispatch<SetStateAction<string>>;
  setCurrentConversation: Dispatch<SetStateAction<number | undefined>>;
  shouldResetRef: MutableRefObject<boolean>;
  justCreatedRef: MutableRefObject<number | undefined>;
}) {
  return (conversationId: number, title: string) => {
    input.setConversationTitle(title);
    input.setCurrentConversation(conversationId);
    markConversationCreated({
      shouldResetRef: input.shouldResetRef,
      justCreatedRef: input.justCreatedRef,
      conversationId,
    });
  };
}

export function createResetConversationPaginationAction(input: {
  setLoadedPersistedMessages: Dispatch<SetStateAction<number>>;
  setTotalMessages: Dispatch<SetStateAction<number>>;
}) {
  return () => {
    input.setLoadedPersistedMessages(0);
    input.setTotalMessages(0);
  };
}

export function createSetLoadedConversationAction(input: {
  setConversationTitle: Dispatch<SetStateAction<string>>;
  setCurrentConversation: Dispatch<SetStateAction<number | undefined>>;
  setLoadedPersistedMessages: Dispatch<SetStateAction<number>>;
  setTotalMessages: Dispatch<SetStateAction<number>>;
}) {
  return (conversation: {
    id: number;
    title: string;
    loadedPersistedMessages: number;
    totalMessages: number;
  }) => {
    input.setConversationTitle(conversation.title);
    input.setCurrentConversation(conversation.id);
    input.setLoadedPersistedMessages(conversation.loadedPersistedMessages);
    input.setTotalMessages(conversation.totalMessages);
  };
}

export function createApplyNavigationResetLifecycleAction(input: {
  setConversationTitle: Dispatch<SetStateAction<string>>;
  setCurrentConversation: Dispatch<SetStateAction<number | undefined>>;
  setLoadedPersistedMessages: Dispatch<SetStateAction<number>>;
  setTotalMessages: Dispatch<SetStateAction<number>>;
}) {
  return (plan: ConversationNavigationResetLifecyclePlan) => {
    if (plan.shouldClearConversationTitle) input.setConversationTitle(plan.conversationTitle);
    if (plan.shouldSetCurrentConversation) input.setCurrentConversation(plan.currentConversation);
    input.setLoadedPersistedMessages(plan.loadedPersistedMessages);
    input.setTotalMessages(plan.totalMessages);
  };
}

export function createApplyJustCreatedNavigationLifecycleAction(input: {
  setCurrentConversation: Dispatch<SetStateAction<number | undefined>>;
  setLoadedPersistedMessages: Dispatch<SetStateAction<number>>;
  setTotalMessages: Dispatch<SetStateAction<number>>;
  justCreatedRef: MutableRefObject<number | undefined>;
}) {
  return (plan: ConversationJustCreatedNavigationLifecyclePlan) => {
    if (plan.shouldClearJustCreated) {
      input.justCreatedRef.current = undefined;
    }
    input.setCurrentConversation(plan.conversationId);
    input.setLoadedPersistedMessages(plan.loadedPersistedMessages);
    input.setTotalMessages(plan.totalMessages);
  };
}

export function createApplyLoadExistingNavigationLifecycleAction(input: {
  setCurrentConversation: Dispatch<SetStateAction<number | undefined>>;
}) {
  return (plan: ConversationLoadExistingNavigationLifecyclePlan) => {
    if (plan.shouldSetCurrentConversation) input.setCurrentConversation(plan.conversationId);
  };
}

export function createLoadMoreMessagesAction(input: CreateLoadMoreMessagesActionInput) {
  const fetchPage = input.fetchPage ?? fetchLoadMoreMessages;
  const mapMessages = input.mapMessages ?? mapLoadMoreMessages;
  const prependMessages = input.prependMessages ?? prependUniqueOlderMessages;
  const resolveLoaded = input.resolveLoaded ?? resolveLoadedPersistedMessages;
  const resolveTotal = input.resolveTotal ?? resolveTotalMessages;

  return async () => {
    const token = input.getToken();
    const currentConversation = input.getCurrentConversation();
    const isLoadingMore = input.getIsLoadingMore();
    const hasMoreMessages = input.getHasMoreMessages();
    if (!shouldStartLoadMore({ currentConversation, isLoadingMore, hasMoreMessages, token })) return;

    const conversationId = currentConversation as number;
    const totalMessages = input.getTotalMessages();
    const loadedPersistedMessages = input.getLoadedPersistedMessages();
    const page = buildLoadMorePage({ totalMessages, loadedPersistedMessages });
    input.setIsLoadingMore(true);

    try {
      const data = await fetchPage({
        apiBaseUrl: input.apiBaseUrl,
        conversationId,
        token: token as string,
        page,
      });
      if (!data) return;
      const olderMessages = mapMessages(data, { fallbackId: input.fallbackId }) as Message[];
      input.setMessages((prev) => prependMessages(prev, olderMessages));
      input.setLoadedPersistedMessages((prev) =>
        resolveLoaded({
          previousLoaded: prev,
          olderMessagesCount: olderMessages.length,
          responseTotal: data.total,
          fallbackTotal: totalMessages,
        })
      );
      input.setTotalMessages(resolveTotal(data.total, totalMessages));
    } catch {
      // Preserve legacy load-more behavior: transient errors are ignored.
    } finally {
      input.setIsLoadingMore(false);
    }
  };
}

export function useLoadMoreMessagesAction(input: Omit<CreateLoadMoreMessagesActionInput,
  | "getCurrentConversation"
  | "getIsLoadingMore"
  | "getHasMoreMessages"
  | "getTotalMessages"
  | "getLoadedPersistedMessages"
> & {
  currentConversation: number | undefined;
  isLoadingMore: boolean;
  hasMoreMessages: boolean;
  totalMessages: number;
  loadedPersistedMessages: number;
}) {
  return useCallback(
    createLoadMoreMessagesAction({
      ...input,
      getCurrentConversation: () => input.currentConversation,
      getIsLoadingMore: () => input.isLoadingMore,
      getHasMoreMessages: () => input.hasMoreMessages,
      getTotalMessages: () => input.totalMessages,
      getLoadedPersistedMessages: () => input.loadedPersistedMessages,
    }),
    [
      input.apiBaseUrl,
      input.currentConversation,
      input.isLoadingMore,
      input.hasMoreMessages,
      input.totalMessages,
      input.loadedPersistedMessages,
      input.getToken,
      input.fallbackId,
      input.setIsLoadingMore,
      input.setMessages,
      input.setLoadedPersistedMessages,
      input.setTotalMessages,
      input.fetchPage,
      input.mapMessages,
      input.prependMessages,
      input.resolveLoaded,
      input.resolveTotal,
    ]
  );
}

export function useChatConversationLifecycle(initialConversationId: number | undefined): ChatConversationLifecycleState {
  const [conversationTitle, setConversationTitle] = useState("");
  const [currentConversation, setCurrentConversation] = useState<number | undefined>(initialConversationId);
  const [totalMessages, setTotalMessages] = useState(0);
  const [loadedPersistedMessages, setLoadedPersistedMessages] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const conversationLoadSeqRef = useRef(0);
  const shouldResetRef = useRef(true);
  const justCreatedRef = useRef<number | undefined>(undefined);

  const hasMoreMessages = useMemo(
    () => hasMorePersistedMessages(totalMessages, loadedPersistedMessages),
    [totalMessages, loadedPersistedMessages]
  );

  const setCreatedConversation = useCallback(
    createSetCreatedConversationAction({
      setConversationTitle,
      setCurrentConversation,
      shouldResetRef,
      justCreatedRef,
    }),
    []
  );

  const resetConversationPagination = useCallback(
    createResetConversationPaginationAction({ setLoadedPersistedMessages, setTotalMessages }),
    []
  );

  const applyNavigationResetLifecycle = useCallback(
    createApplyNavigationResetLifecycleAction({
      setConversationTitle,
      setCurrentConversation,
      setLoadedPersistedMessages,
      setTotalMessages,
    }),
    []
  );

  const applyJustCreatedNavigationLifecycle = useCallback(
    createApplyJustCreatedNavigationLifecycleAction({
      setCurrentConversation,
      setLoadedPersistedMessages,
      setTotalMessages,
      justCreatedRef,
    }),
    []
  );

  const applyLoadExistingNavigationLifecycle = useCallback(
    createApplyLoadExistingNavigationLifecycleAction({ setCurrentConversation }),
    []
  );

  return {
    conversationTitle,
    setConversationTitle,
    currentConversation,
    setCurrentConversation,
    totalMessages,
    setTotalMessages,
    loadedPersistedMessages,
    setLoadedPersistedMessages,
    isLoadingMore,
    setIsLoadingMore,
    hasMoreMessages,
    conversationLoadSeqRef,
    shouldResetRef,
    justCreatedRef,
    setCreatedConversation,
    resetConversationPagination,
    applyNavigationResetLifecycle,
    applyJustCreatedNavigationLifecycle,
    applyLoadExistingNavigationLifecycle,
  };
}
