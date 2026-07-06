import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useChatConversationCreateRuntime } from "@/hooks/useChatConversationCreateRuntime";
import { useChatSingleSendRuntime } from "@/hooks/useChatSingleSendRuntime";
import { useChatCompareSendRuntime } from "@/hooks/useChatCompareSendRuntime";
import type { ChatStreamGroupContext, ChatStreamRunResult } from "@/lib/chatStreamRunResult";
import type { ChatModel, Message } from "@/lib/chatTypes";

type AbortReason = "user" | "navigation" | null;
type StreamResponse = (
  response: Response,
  assistantMsg: Message,
  controller: AbortController,
  convId?: number,
  onGroupContext?: (context: ChatStreamGroupContext) => void
) => Promise<ChatStreamRunResult | undefined>;
type StartBackgroundPolling = (
  convId: number | undefined,
  localMessageId: string,
  serverMessageId?: number
) => void;
type SendReasoning = { enabled: boolean; effort?: string };

export type UseChatSendRuntimeOptions = {
  apiBaseUrl: string;
  messages: Message[];
  models: ChatModel[];
  selectedModel: ChatModel;
  currentConversation: number | undefined;
  notebookId?: number;
  notebookFileIds?: number[];
  effectiveSkillKey: string | undefined;
  setCreatedConversation: (conversationId: number, title: string) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsCompare: Dispatch<SetStateAction<boolean>>;
  setCompareModels: Dispatch<SetStateAction<string[]>>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  compareAbortControllersRef: MutableRefObject<AbortController[]>;
  abortReasonRef: MutableRefObject<AbortReason>;
  taskStreamsRef: MutableRefObject<Record<string, AbortController>>;
  pendingLocalAssistantsRef?: MutableRefObject<Record<string, { convId?: number; message: Message }>>;
  backgroundPollersRef: MutableRefObject<Record<string, number>>;
  lastReasoningRef: MutableRefObject<SendReasoning>;
  lastSearchRef: MutableRefObject<boolean>;
  streamResponse: StreamResponse;
  startBackgroundPolling: StartBackgroundPolling;
  translate: (key: string) => string;
  now?: () => number;
  createId?: () => string;
  getToken?: () => string | null;
  getWorkspaceId?: () => string | null;
  getCurrentHref?: () => string;
  replaceHistory?: (url: string) => void;
  dispatchWindowEvent?: (event: Event) => void;
};

export function useChatSendRuntime({
  apiBaseUrl,
  messages,
  models,
  selectedModel,
  currentConversation,
  notebookId,
  notebookFileIds,
  effectiveSkillKey,
  setCreatedConversation,
  setMessages,
  setIsLoading,
  setIsCompare,
  setCompareModels,
  abortControllerRef,
  compareAbortControllersRef,
  abortReasonRef,
  taskStreamsRef,
  pendingLocalAssistantsRef,
  backgroundPollersRef,
  lastReasoningRef,
  lastSearchRef,
  streamResponse,
  startBackgroundPolling,
  translate,
  now,
  createId,
  getToken,
  getWorkspaceId,
  getCurrentHref,
  replaceHistory,
  dispatchWindowEvent,
}: UseChatSendRuntimeOptions) {
  const { createConversation } = useChatConversationCreateRuntime({
    apiBaseUrl,
    setCreatedConversation,
    notebookId,
    getToken,
    getWorkspaceId,
    getCurrentHref,
    replaceHistory,
    dispatchWindowEvent,
  });

  const { sendMessage } = useChatSingleSendRuntime({
    apiBaseUrl,
    messages,
    selectedModel,
    currentConversation,
    notebookId,
    notebookFileIds,
    effectiveSkillKey,
    createConversation,
    setMessages,
    setIsLoading,
    abortControllerRef,
    abortReasonRef,
    taskStreamsRef,
    pendingLocalAssistantsRef,
    lastReasoningRef,
    lastSearchRef,
    streamResponse,
    translate,
    now,
    createId,
    getToken,
    dispatchWindowEvent,
  });

  const { sendCompareMessages, retryCompareColumn } = useChatCompareSendRuntime({
    apiBaseUrl,
    messages,
    models,
    currentConversation,
    notebookId,
    notebookFileIds,
    effectiveSkillKey,
    createConversation,
    setMessages,
    setIsLoading,
    setIsCompare,
    setCompareModels,
    abortControllerRef,
    compareAbortControllersRef,
    abortReasonRef,
    taskStreamsRef,
    backgroundPollersRef,
    lastReasoningRef,
    lastSearchRef,
    streamResponse,
    startBackgroundPolling,
    translate,
    now,
    createId,
    getToken,
    getWorkspaceId,
    dispatchWindowEvent,
  });

  return {
    createConversation,
    sendCompareMessages,
    retryCompareColumn,
    sendMessage,
  };
}
