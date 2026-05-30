import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { v4 as uuidv4 } from "uuid";
import { getGuestId as defaultGetGuestId } from "@/lib/guestId";
import {
  cancelGenerationTask as defaultCancelGenerationTask,
  runStopGeneration as defaultRunStopGeneration,
} from "@/lib/chatStopGenerationCoordinator";
import {
  buildForkRefreshState,
  fetchForkConversationRefresh as defaultFetchForkConversationRefresh,
  resolveForkConversationId,
  resolveForkedModels,
  runForkChatRequest as defaultRunForkChatRequest,
} from "@/lib/chatForkCoordinator";
import { buildChatRequestHeaders } from "@/lib/chatRequestBuilder";
import type { Message } from "@/lib/chatTypes";

type AbortReason = "user" | "navigation" | null;

type HeadersRecord = Record<string, string>;

type StopGenerationDeps = {
  apiBaseUrl: string;
  messages: Message[];
  taskStreamsRef: MutableRefObject<Record<string, AbortController>>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  compareAbortControllersRef: MutableRefObject<AbortController[]>;
  abortReasonRef: MutableRefObject<AbortReason>;
  getToken?: () => string | null;
  getGuestId?: () => string;
  runStopGeneration?: typeof defaultRunStopGeneration;
  cancelGenerationTask?: typeof defaultCancelGenerationTask;
};

export function createStopGenerationAction({
  apiBaseUrl,
  messages,
  taskStreamsRef,
  abortControllerRef,
  compareAbortControllersRef,
  abortReasonRef,
  getToken = () => (typeof localStorage === "undefined" ? null : localStorage.getItem("token")),
  getGuestId = defaultGetGuestId,
  runStopGeneration = defaultRunStopGeneration,
  cancelGenerationTask = defaultCancelGenerationTask,
}: StopGenerationDeps) {
  return () => {
    const token = getToken();
    const headers: HeadersRecord = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else {
      headers["X-Guest-ID"] = getGuestId();
    }

    runStopGeneration({
      messages,
      callbacks: {
        cancelTask: (taskId) => {
          cancelGenerationTask({
            apiBaseUrl,
            taskId,
            headers,
          });
        },
        abortTaskStreams: () => {
          Object.values(taskStreamsRef.current).forEach((controller) => controller.abort());
          taskStreamsRef.current = {};
        },
        getMainAbortController: () => abortControllerRef.current,
        clearMainAbortController: () => {
          abortControllerRef.current = null;
        },
        getCompareAbortControllers: () => compareAbortControllersRef.current,
        clearCompareAbortControllers: () => {
          compareAbortControllersRef.current = [];
        },
        setAbortReason: (reason) => {
          abortReasonRef.current = reason;
        },
      },
    });
  };
}

type ForkChatDeps = {
  apiBaseUrl: string;
  currentConversation: number | undefined;
  setIsCompare: Dispatch<SetStateAction<boolean>>;
  setCompareModels: Dispatch<SetStateAction<string[]>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setLoadedPersistedMessages: Dispatch<SetStateAction<number>>;
  setGroupViews: Dispatch<SetStateAction<Map<number, number>>>;
  getToken?: () => string | null;
  getGuestId?: () => string;
  fallbackId?: () => string;
  runForkChatRequest?: typeof defaultRunForkChatRequest;
  fetchForkConversationRefresh?: typeof defaultFetchForkConversationRefresh;
  logError?: (...args: unknown[]) => void;
};

export function createForkChatAction({
  apiBaseUrl,
  currentConversation,
  setIsCompare,
  setCompareModels,
  setMessages,
  setLoadedPersistedMessages,
  setGroupViews,
  getToken = () => (typeof localStorage === "undefined" ? null : localStorage.getItem("token")),
  getGuestId = defaultGetGuestId,
  fallbackId = uuidv4,
  runForkChatRequest = defaultRunForkChatRequest,
  fetchForkConversationRefresh = defaultFetchForkConversationRefresh,
  logError = console.error,
}: ForkChatDeps) {
  return async (messageId: number, modelIds: string[]) => {
    const token = getToken();
    const headers = buildChatRequestHeaders({ token, guestId: getGuestId() });
    const data = await runForkChatRequest({
      apiBaseUrl,
      messageId,
      modelIds,
      headers,
    });

    setIsCompare(true);
    setCompareModels(resolveForkedModels(data, modelIds));

    const convId = resolveForkConversationId(data, currentConversation);
    if (convId && token) {
      try {
        const refreshData = await fetchForkConversationRefresh({
          apiBaseUrl,
          conversationId: convId,
          token,
        });
        const refreshState = buildForkRefreshState(refreshData, {
          fallbackId,
        });
        if (refreshState) {
          setMessages(refreshState.messages as Message[]);
          setLoadedPersistedMessages(refreshState.messages.length);
          setGroupViews(refreshState.groupViews);
        }
      } catch (e) {
        logError("fork refresh failed:", e);
      }
    }

    return data;
  };
}

export type UseChatGenerationControlsRuntimeOptions = StopGenerationDeps & ForkChatDeps;

export function useChatGenerationControlsRuntime(options: UseChatGenerationControlsRuntimeOptions) {
  const stopGeneration = useCallback(
    createStopGenerationAction(options),
    [
      options.apiBaseUrl,
      options.messages,
      options.taskStreamsRef,
      options.abortControllerRef,
      options.compareAbortControllersRef,
      options.abortReasonRef,
      options.getToken,
      options.getGuestId,
      options.runStopGeneration,
      options.cancelGenerationTask,
    ]
  );

  const forkChat = useCallback(
    createForkChatAction(options),
    [
      options.apiBaseUrl,
      options.currentConversation,
      options.setIsCompare,
      options.setCompareModels,
      options.setMessages,
      options.setLoadedPersistedMessages,
      options.setGroupViews,
      options.getToken,
      options.getGuestId,
      options.fallbackId,
      options.runForkChatRequest,
      options.fetchForkConversationRefresh,
      options.logError,
    ]
  );

  return { stopGeneration, forkChat };
}
