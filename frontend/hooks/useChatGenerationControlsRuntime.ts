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
import { buildChatRequestHeaders, buildCompareChatRequestBody } from "@/lib/chatRequestBuilder";
import { createBusyGeneratingStatus, createGeneratingStatus } from "@/lib/chatActivityStatus";
import { initializeAssistantRealtimeBatch } from "@/lib/chatInitialRealtime";
import { toModelMessages } from "@/lib/chatHistoryTransform";
import { patchMessageById } from "@/lib/chatMessageStatePatch";
import type { ChatStreamRunResult } from "@/lib/chatStreamRunResult";
import type { Message } from "@/lib/chatTypes";
import { readAuthState } from "@/lib/auth/state";

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
  getToken = () => readAuthState().token,
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
  messages: Message[];
  currentConversation: number | undefined;
  setIsCompare: Dispatch<SetStateAction<boolean>>;
  setCompareModels: Dispatch<SetStateAction<string[]>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setLoadedPersistedMessages: Dispatch<SetStateAction<number>>;
  setGroupViews: Dispatch<SetStateAction<Map<number, number>>>;
  streamResponse?: (
    response: Response,
    assistant: Message,
    controller: AbortController,
    conversationId: number | undefined,
    onGroupContext?: (context?: { groupId?: number; userMessageId?: number; groupModels?: string[] }) => void
  ) => Promise<ChatStreamRunResult | undefined>;
  compareAbortControllersRef?: MutableRefObject<AbortController[]>;
  abortReasonRef?: MutableRefObject<AbortReason>;
  startBackgroundPolling?: (conversationId: number | undefined, assistantMessageId: string, serverMessageId: number) => void;
  reasoning?: { enabled: boolean; effort?: string };
  search?: boolean;
  templateId?: number;
  templatePrefix?: string;
  skillKey?: string;
  notebookId?: number;
  notebookFileIds?: number[];
  getToken?: () => string | null;
  getGuestId?: () => string;
  fallbackId?: () => string;
  now?: () => number;
  translate?: (key: string) => string;
  runForkChatRequest?: typeof defaultRunForkChatRequest;
  fetchForkConversationRefresh?: typeof defaultFetchForkConversationRefresh;
  logError?: (...args: unknown[]) => void;
};

export function createForkChatAction({
  apiBaseUrl,
  messages = [],
  currentConversation,
  setIsCompare,
  setCompareModels,
  setMessages,
  setLoadedPersistedMessages,
  setGroupViews,
  streamResponse,
  compareAbortControllersRef,
  abortReasonRef,
  startBackgroundPolling,
  reasoning = { enabled: false, effort: "high" },
  search = false,
  templateId = 0,
  templatePrefix,
  skillKey,
  notebookId,
  notebookFileIds,
  getToken = () => readAuthState().token,
  getGuestId = defaultGetGuestId,
  fallbackId = uuidv4,
  now = Date.now,
  translate = (key) => key,
  runForkChatRequest = defaultRunForkChatRequest,
  fetchForkConversationRefresh = defaultFetchForkConversationRefresh,
  logError = console.error,
}: ForkChatDeps) {
  return async (messageId: number, modelIds: string[]) => {
    const token = getToken();
    const headers = buildChatRequestHeaders({ token, guestId: getGuestId() });
    const sourceMessage = messages.find((message) => message.serverMessageId === messageId);
    const sourcePosition = messages.findIndex((message) => message.serverMessageId === messageId);
    const sourceUserMessage = sourcePosition >= 0
      ? sourceMessage?.role === "user"
        ? sourceMessage
        : [...messages.slice(0, sourcePosition)].reverse().find((message) => message.role === "user")
      : undefined;
    const sourceMessageFileIds = (sourceUserMessage?.files || [])
      .map((file) => {
        const maybeFile = file as typeof file & { publicId?: string; public_id?: string; id?: string };
        return maybeFile.publicId || maybeFile.public_id || maybeFile.id;
      })
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const sourceIndex = sourceMessage?.model ? modelIds.indexOf(sourceMessage.model) : -1;

    const forkPlaceholderGroupId = -Math.max(1, messageId);
    const placeholderCreatedAt = now();
    const placeholderIds = modelIds.map((modelId, index) => index === sourceIndex ? undefined : `fork-${messageId}-${index}-${fallbackId()}`);
    const placeholderMessages: Message[] = modelIds
      .map((modelId, index) => ({ modelId, index, id: placeholderIds[index] }))
      .filter((item): item is { modelId: string; index: number; id: string } => !!item.id)
      .map(({ modelId, index, id }) => ({
        id,
        role: "assistant" as const,
        content: "",
        model: modelId,
        createdAt: placeholderCreatedAt + index + 1,
        generationStartedAt: now(),
        groupId: forkPlaceholderGroupId,
        groupIndex: index,
        groupModels: modelIds,
        activityStatus: createGeneratingStatus(translate),
      }));

    if (sourceMessage && placeholderMessages.length > 0) {
      setMessages((prev) => {
        const sourcePosition = prev.findIndex((message) => message.serverMessageId === messageId);
        if (sourcePosition < 0) return prev;
        const next = [...prev];
        next[sourcePosition] = {
          ...next[sourcePosition],
          groupId: forkPlaceholderGroupId,
          groupIndex: sourceIndex >= 0 ? sourceIndex : 0,
          groupModels: modelIds,
        };
        return next;
      });
    }

    try {
      const useStreamingFork = !!streamResponse && placeholderMessages.length > 0;
      const data = await runForkChatRequest({
        apiBaseUrl,
        messageId,
        modelIds,
        headers,
        initOnly: useStreamingFork,
      });

      setIsCompare(true);
      const resolvedModels = resolveForkedModels(data, modelIds);
      setCompareModels(resolvedModels);

      const convId = resolveForkConversationId(data, currentConversation);
      const groupId = typeof data.group_id === "number" ? data.group_id : undefined;
      const userMessageId = typeof data.user_message_id === "number" ? data.user_message_id : undefined;

      if (useStreamingFork && convId && groupId && userMessageId && streamResponse) {
        const contextEnd = sourceMessage?.role === "user" ? sourcePosition + 1 : sourcePosition;
        const contextMessages = contextEnd >= 0 ? messages.slice(0, contextEnd) : messages;
        const controllers: AbortController[] = placeholderMessages.map(() => new AbortController());
        if (compareAbortControllersRef) compareAbortControllersRef.current = controllers;

        setMessages((prev) => prev.map((message) => {
          if (message.serverMessageId === messageId) {
            return {
              ...message,
              groupId,
              groupIndex: sourceIndex >= 0 ? sourceIndex : 0,
              groupModels: resolvedModels,
            };
          }
          return message;
        }));

        await Promise.all(placeholderMessages.map(async (assistantMsg, idx) => {
          const controller = controllers[idx];
          const initResponse = await fetch(`${apiBaseUrl}/api/chat/init`, {
            method: "POST",
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              ...buildCompareChatRequestBody({
                model: assistantMsg.model || "",
                messages: toModelMessages(contextMessages),
                conversationId: convId,
                notebookId,
                notebookFileIds,
                messageFileIds: sourceMessageFileIds,
                reasoningEffort: reasoning.effort,
                search,
                templateId,
                templatePrefix,
                skipSaveUserMessage: true,
                groupId,
                userMessageId,
                groupIndex: assistantMsg.groupIndex ?? idx,
                groupModels: resolvedModels,
                fallbackGroupModels: resolvedModels,
                skillKey,
              }),
              stream: true,
              init_only: true,
            }),
          });
          if (!initResponse.ok) throw new Error("Fork init request failed");
          const init = await initResponse.json();
          const serverMessageId = Number(init.assistant_message_id || init.assistant_message?.id || 0) || undefined;
          const generationTaskId = Number(init.task_id || init.assistant_message?.generation_task_id || 0) || undefined;
          const serverBoundAssistant = {
            ...assistantMsg,
            id: generationTaskId ? `assistant-task:${generationTaskId}` : String(serverMessageId || assistantMsg.id),
            serverMessageId: serverMessageId || assistantMsg.serverMessageId,
            generationTaskId: generationTaskId || assistantMsg.generationTaskId,
            serverGenerationStatus: init.assistant_message?.server_generation_status || init.assistant_message?.generation_status || "running",
            activityStatus: createBusyGeneratingStatus(translate),
          } as Message;
          assistantMsg.id = serverBoundAssistant.id;
          assistantMsg.serverMessageId = serverBoundAssistant.serverMessageId;
          assistantMsg.generationTaskId = serverBoundAssistant.generationTaskId;
          assistantMsg.serverGenerationStatus = serverBoundAssistant.serverGenerationStatus;
          initializeAssistantRealtimeBatch([serverBoundAssistant], serverBoundAssistant.createdAt || now());
          setMessages((prev) => {
            const existingIndex = prev.findIndex((message) =>
              message.id === serverBoundAssistant.id ||
              (serverBoundAssistant.serverMessageId && message.serverMessageId === serverBoundAssistant.serverMessageId) ||
              (serverBoundAssistant.generationTaskId && message.generationTaskId === serverBoundAssistant.generationTaskId)
            );
            if (existingIndex >= 0) return patchMessageById(prev, prev[existingIndex].id, serverBoundAssistant);
            const sourcePosition = prev.findIndex((message) => message.serverMessageId === messageId);
            if (sourcePosition < 0) return [...prev, serverBoundAssistant];
            const next = [...prev];
            next.splice(sourcePosition + 1 + idx, 0, serverBoundAssistant);
            return next;
          });
          const response = await fetch(`${apiBaseUrl}/api/tasks/${generationTaskId}/stream?after=0`, {
            headers,
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Fork task stream request failed");
          const result = await streamResponse(response, assistantMsg, controller, convId);
          if (result?.recoverable) {
            setMessages((prev) => patchMessageById(prev, assistantMsg.id, (m) => ({
              ...m,
              serverMessageId: result.serverMessageId || m.serverMessageId,
              generationTaskId: result.generationTaskId || m.generationTaskId,
              activityStatus: createBusyGeneratingStatus(translate),
            })));
            if (result.serverMessageId && startBackgroundPolling) {
              startBackgroundPolling(convId, assistantMsg.id, result.serverMessageId);
            }
          }
        }));

        if (compareAbortControllersRef) compareAbortControllersRef.current = [];
        if (abortReasonRef) abortReasonRef.current = null;
        return data;
      }

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
    } catch (error) {
      if (placeholderMessages.length > 0) {
        const failedAssistantIds = new Set(placeholderMessages.map((message) => message.id));
        setMessages((prev) => prev.map((message) => {
          if (!failedAssistantIds.has(message.id)) return message;
          return {
            ...message,
            completedAt: now(),
            activityStatus: {
              kind: "generating" as const,
              status: "failed" as const,
              label: translate("chat.status.failed"),
            },
          };
        }));
      }
      throw error;
    }
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
      options.messages,
      options.currentConversation,
      options.setIsCompare,
      options.setCompareModels,
      options.setMessages,
      options.setLoadedPersistedMessages,
      options.setGroupViews,
      options.streamResponse,
      options.compareAbortControllersRef,
      options.abortReasonRef,
      options.startBackgroundPolling,
      options.reasoning,
      options.search,
      options.templateId,
      options.templatePrefix,
      options.skillKey,
      options.notebookId,
      options.notebookFileIds,
      options.getToken,
      options.getGuestId,
      options.fallbackId,
      options.now,
      options.translate,
      options.runForkChatRequest,
      options.fetchForkConversationRefresh,
      options.logError,
    ]
  );

  return { stopGeneration, forkChat };
}
