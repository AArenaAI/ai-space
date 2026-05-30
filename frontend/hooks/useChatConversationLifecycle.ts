import { useCallback, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

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
  };
}
