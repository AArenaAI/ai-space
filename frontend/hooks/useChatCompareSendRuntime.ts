import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { v4 as uuidv4 } from "uuid";
import { getGuestId } from "@/lib/guestId";
import { realtimeGet } from "@/lib/streaming";
import { runCompareModels } from "@/lib/chatCompareRunCoordinator";
import {
  buildConversationUpdatedEventDetail,
  buildRecoverableResultPatch,
  buildUserAbortStoppedPatch,
  decideCompareRunError,
  decideCompareRunFinally,
} from "@/lib/chatRunUiCoordinator";
import {
  applyCompareGroupContextToMessages,
  patchMessageById,
} from "@/lib/chatMessageStatePatch";
import { buildChatRequestHeaders } from "@/lib/chatRequestBuilder";
import { initCompareRun } from "@/lib/chatCompareInitCoordinator";
import { toModelMessages } from "@/lib/chatHistoryTransform";
import {
  buildMessageFiles,
  createCompareAssistantMessages,
  createUserChatMessage,
} from "@/lib/chatMessageFactory";
import { initializeAssistantRealtimeBatch } from "@/lib/chatInitialRealtime";
import {
  selectCompareModelIds,
  shouldStartCompare,
} from "@/lib/chatCompareCoordinator";
import { createBusyGeneratingStatus } from "@/lib/chatActivityStatus";
import type { ChatStreamGroupContext, ChatStreamRunResult } from "@/lib/chatStreamRunResult";
import type { ChatModel, Message } from "@/lib/chatTypes";
import type { CreateConversationAction } from "@/hooks/useChatConversationCreateRuntime";
import { readAuthState } from "@/lib/auth/state";
import { apiFetch } from "@/lib/api/client";
import { chatRuntimeStore } from "@/lib/chatRuntime";

type AbortReason = "user" | "navigation" | null;
type SendReasoning = { enabled: boolean; effort?: string };
type SendAttachment = { filename: string; content: string; type?: string; public_id?: string };
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

function syncCompareMessagesToRuntime(conversationId: number | undefined, messages: Message[], compareModels?: string[]) {
  if (!conversationId) return;
  chatRuntimeStore.patchConversation(conversationId, {
    messages,
    ...(compareModels ? { compareModels } : {}),
    updatedAt: Date.now(),
  });
}

export async function persistCompareConversationState({
  apiBaseUrl,
  conversationId,
  token,
  compareModelIds,
}: {
  apiBaseUrl: string;
  conversationId?: number;
  token?: string | null;
  compareModelIds: string[];
}) {
  if (!conversationId || !token || compareModelIds.length < 2) return;
  const isBrowserSameOriginApi = typeof window !== "undefined"
    && (!apiBaseUrl || apiBaseUrl.replace(/\/+$/, "") === window.location.origin);
  const requestInit: RequestInit = {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ compare: true, compare_models: JSON.stringify(compareModelIds) }),
  };
  if (isBrowserSameOriginApi) {
    await apiFetch(`/conversations/${conversationId}`, requestInit).catch(() => undefined);
  } else {
    await fetch(`${apiBaseUrl}/api/conversations/${conversationId}`, { ...requestInit, credentials: "include" }).catch(() => undefined);
  }
}

export type UseChatCompareSendRuntimeOptions = {
  apiBaseUrl: string;
  messages: Message[];
  models: ChatModel[];
  currentConversation: number | undefined;
  notebookId?: number;
  notebookFileIds?: number[];
  effectiveSkillKey: string | undefined;
  createConversation: CreateConversationAction;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsCompare: Dispatch<SetStateAction<boolean>>;
  setCompareModels: Dispatch<SetStateAction<string[]>>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  compareAbortControllersRef: MutableRefObject<AbortController[]>;
  abortReasonRef: MutableRefObject<AbortReason>;
  taskStreamsRef: MutableRefObject<Record<string, AbortController>>;
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
  dispatchWindowEvent?: (event: Event) => void;
};

export function useChatCompareSendRuntime({
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
  now = Date.now,
  createId = uuidv4,
  getToken = () => readAuthState().token,
  getWorkspaceId = () => localStorage.getItem("current-workspace"),
  dispatchWindowEvent = (event) => window.dispatchEvent(event),
}: UseChatCompareSendRuntimeOptions) {
  const retryCompareColumn = useCallback(
    async (assistant: Message, userMessage: Message) => {
      if (!assistant.groupId || !userMessage.serverMessageId || typeof assistant.groupIndex !== "number" || !assistant.model) {
        throw new Error("当前列缺少对比重试所需的 group 信息");
      }
      const token = getToken();
      const convId = currentConversation;
      if (!convId) throw new Error("当前会话不存在，无法重试本列");
      const groupModels = assistant.groupModels && assistant.groupModels.length > 0 ? assistant.groupModels : [];
      const compareModelIds = groupModels.length > 0 ? groupModels : selectCompareModelIds([assistant.model], models);
      const retryAssistant = createCompareAssistantMessages({
        modelIds: [assistant.model],
        ids: [createId()],
        createdAt: now(),
        search: lastSearchRef.current,
      })[0] as Message;
      const preparedAssistant = {
        ...retryAssistant,
        groupId: assistant.groupId,
        groupIndex: assistant.groupIndex,
        groupModels: compareModelIds,
        userMessageId: userMessage.serverMessageId,
        activityStatus: createBusyGeneratingStatus(translate),
        generationStartedAt: now(),
      } as Message;
      setMessages((prev) => {
        const next = [...prev, preparedAssistant];
        syncCompareMessagesToRuntime(convId, next, compareModelIds);
        return next;
      });
      setIsLoading(true);
      setIsCompare(true);
      setCompareModels(compareModelIds);
      const controller = new AbortController();
      compareAbortControllersRef.current = [controller];
      abortControllerRef.current = null;
      abortReasonRef.current = null;
      const headers = buildChatRequestHeaders({ token, guestId: getGuestId() });
      const groupContext = { groupId: assistant.groupId, userMessageId: userMessage.serverMessageId, groupModels: compareModelIds };
      const handleCompareRecoverableResult = (assistantMsg: Message, streamResult: ChatStreamRunResult) => {
        const serverBoundAssistant = {
          ...assistantMsg,
          serverMessageId: streamResult.serverMessageId || assistantMsg.serverMessageId,
          generationTaskId: streamResult.generationTaskId || assistantMsg.generationTaskId,
          activityStatus: createBusyGeneratingStatus(translate),
          serverGenerationStatus: assistantMsg.serverGenerationStatus || "running",
        } as Message;
        initializeAssistantRealtimeBatch([serverBoundAssistant], serverBoundAssistant.createdAt || now());
        setMessages((prev) => {
          const existingIndex = prev.findIndex((message) =>
            message.id === serverBoundAssistant.id ||
            (serverBoundAssistant.serverMessageId && message.serverMessageId === serverBoundAssistant.serverMessageId) ||
            (serverBoundAssistant.generationTaskId && message.generationTaskId === serverBoundAssistant.generationTaskId)
          );
          const next = existingIndex === -1
            ? [...prev, serverBoundAssistant]
            : patchMessageById(prev, prev[existingIndex].id, (m) => ({
              ...m,
              ...serverBoundAssistant,
              ...buildRecoverableResultPatch({
                serverMessageId: streamResult.serverMessageId,
                generationTaskId: streamResult.generationTaskId,
                existingServerMessageId: m.serverMessageId,
                existingGenerationTaskId: m.generationTaskId,
                busyActivityStatus: createBusyGeneratingStatus(translate),
              }),
            }));
          syncCompareMessagesToRuntime(convId, next, compareModelIds);
          return next;
        });
      };
      const handleCompareRunError = (assistantMsg: Message, error: any, streamResult?: ChatStreamRunResult) => {
        const realtime = realtimeGet(assistantMsg.id);
        const decision = decideCompareRunError({
          assistantModel: assistantMsg.model || "",
          error,
          streamResult,
          realtime,
          hasTaskStream: !!taskStreamsRef.current[assistantMsg.id],
          hasBackgroundPoller: !!backgroundPollersRef.current[assistantMsg.id],
          conversationId: convId,
          existingServerMessageId: assistantMsg.serverMessageId,
          existingGenerationTaskId: assistantMsg.generationTaskId,
          busyActivityStatus: createBusyGeneratingStatus(translate),
          now: now(),
        });
        setMessages((prev) => {
          const next = patchMessageById(prev, assistantMsg.id, decision.patch);
          syncCompareMessagesToRuntime(convId, next, compareModelIds);
          return next;
        });
        if (decision.type === "recoverable_busy" && decision.shouldStartBackgroundPolling && decision.serverMessageId) {
          startBackgroundPolling(convId, assistantMsg.id, decision.serverMessageId);
        }
      };
      try {
        await runCompareModels({
          apiBaseUrl,
          headers,
          controllers: [controller],
          assistantMessages: [preparedAssistant],
          compareModelIds,
          modelMessages: toModelMessages(messages),
          conversationId: convId,
          notebookId,
          notebookFileIds,
          reasoning: lastReasoningRef.current,
          search: lastSearchRef.current,
          templateId: 0,
          skillKey: effectiveSkillKey,
          explicitGroupContext: groupContext,
          callbacks: {
            streamResponse,
            onGroupContextResolved: () => {},
            onRecoverableResult: handleCompareRecoverableResult,
            onAbortUser: (assistantMsg) => setMessages((prev) => {
              const next = patchMessageById(prev, assistantMsg.id, buildUserAbortStoppedPatch(now()));
              syncCompareMessagesToRuntime(convId, next, compareModelIds);
              return next;
            }),
            onRunError: handleCompareRunError,
            getAbortReason: () => abortReasonRef.current,
          },
        });
      } finally {
        const decision = decideCompareRunFinally({
          abortReason: abortReasonRef.current,
          hasActiveTaskStream: Object.keys(taskStreamsRef.current).length > 0,
          hasActivePoller: Object.keys(backgroundPollersRef.current).length > 0,
          conversationId: convId,
        });
        if (decision.shouldUpdateLoading) setIsLoading(Boolean(decision.isLoading));
        if (decision.shouldClearCompareControllers) compareAbortControllersRef.current = [];
        if (decision.shouldClearMainController) abortControllerRef.current = null;
        if (decision.shouldClearAbortReason) abortReasonRef.current = null;
      }
    },
    [apiBaseUrl, messages, models, currentConversation, streamResponse, effectiveSkillKey, createId, now, getToken, setIsCompare, setCompareModels, setMessages, setIsLoading, startBackgroundPolling, translate]
  );

  const sendCompareMessages = useCallback(
    async (
      content: string,
      modelIds: string[],
      reasoning: SendReasoning = { enabled: false },
      search: boolean = false,
      templateId: number = 0,
      attachments?: SendAttachment[],
      file_ids?: string[],
      templatePrefix?: string
    ) => {
      if (!content.trim() && (!attachments || attachments.length === 0)) return;

      const compareModelIds = selectCompareModelIds(modelIds, models);
      if (!shouldStartCompare(compareModelIds)) return;

      lastReasoningRef.current = reasoning;
      lastSearchRef.current = search;

      const token = getToken();

      let convId = currentConversation;
      if (token && !convId) {
        const title = content.trim().slice(0, 20) + (content.trim().length > 20 ? "..." : "");
        convId = await createConversation(title, compareModelIds[0], effectiveSkillKey);
      }
      await persistCompareConversationState({ apiBaseUrl, conversationId: convId, token, compareModelIds });

      const finalContent = content.trim();
      const userFiles = buildMessageFiles(attachments, { defaultType: "file" });
      const init = await initCompareRun({
        apiBaseUrl,
        token,
        guestId: getGuestId(),
        conversationId: convId,
        workspaceId: getWorkspaceId(),
        content: finalContent,
        model: compareModelIds[0],
        compareModelIds,
        skillKey: effectiveSkillKey,
      });
      convId = init.conversation_id || convId;
      const groupContext = {
        groupId: init.group.id,
        userMessageId: init.user_message.id,
        groupModels: init.compare_models.length ? init.compare_models : compareModelIds,
      };
      const userMsg = {
        ...createUserChatMessage({
          id: String(init.user_message.id),
          content: finalContent,
          createdAt: now(),
          files: userFiles,
        }),
        serverMessageId: init.user_message.id,
        userMessageId: init.user_message.id,
      } as Message;
      const assistantMsgs = createCompareAssistantMessages({
        modelIds: compareModelIds,
        ids: compareModelIds.map(() => createId()),
        createdAt: now(),
        search: lastSearchRef.current,
      }).map((message, index) => ({
        ...message,
        groupId: groupContext.groupId,
        groupIndex: index,
        groupModels: groupContext.groupModels,
        userMessageId: groupContext.userMessageId,
      })) as Message[];
      const contextMessages = [...messages, userMsg];

      if (convId && !notebookId) {
        dispatchWindowEvent(new CustomEvent("conversation-updated", {
          detail: buildConversationUpdatedEventDetail(convId, new Date(now()).toISOString(), {
            title: finalContent.slice(0, 20) + (finalContent.length > 20 ? "..." : ""),
            model: compareModelIds[0],
            source: "local-send",
          }),
        }));
      }

      setIsCompare(true);
      setCompareModels(compareModelIds);
      setMessages((prev) => {
        const next = [...prev, userMsg];
        syncCompareMessagesToRuntime(convId, next, compareModelIds);
        return next;
      });
      setIsLoading(true);

      const controllers = assistantMsgs.map(() => new AbortController());
      compareAbortControllersRef.current = controllers;
      abortControllerRef.current = null;
      abortReasonRef.current = null;

      const headers = buildChatRequestHeaders({ token, guestId: getGuestId() });

      const handleCompareGroupContextResolved = (context: ChatStreamGroupContext) => {
        setMessages((prev) => {
          const next = applyCompareGroupContextToMessages(prev, {
            userMessageId: userMsg.id,
            assistantIds: assistantMsgs.map((assistant) => assistant.id),
            context,
          });
          syncCompareMessagesToRuntime(convId, next, compareModelIds);
          return next;
        });
      };

      const handleCompareRecoverableResult = (assistantMsg: Message, streamResult: ChatStreamRunResult) => {
        const serverBoundAssistant = {
          ...assistantMsg,
          serverMessageId: streamResult.serverMessageId || assistantMsg.serverMessageId,
          generationTaskId: streamResult.generationTaskId || assistantMsg.generationTaskId,
          activityStatus: createBusyGeneratingStatus(translate),
          serverGenerationStatus: assistantMsg.serverGenerationStatus || "running",
        } as Message;
        initializeAssistantRealtimeBatch([serverBoundAssistant], serverBoundAssistant.createdAt || userMsg.createdAt || now());
        setMessages((prev) => {
          const existingIndex = prev.findIndex((message) =>
            message.id === serverBoundAssistant.id ||
            (serverBoundAssistant.serverMessageId && message.serverMessageId === serverBoundAssistant.serverMessageId) ||
            (serverBoundAssistant.generationTaskId && message.generationTaskId === serverBoundAssistant.generationTaskId)
          );
          const next = existingIndex === -1
            ? [...prev, serverBoundAssistant]
            : patchMessageById(prev, prev[existingIndex].id, (m) => ({
              ...m,
              ...serverBoundAssistant,
              ...buildRecoverableResultPatch({
                serverMessageId: streamResult.serverMessageId,
                generationTaskId: streamResult.generationTaskId,
                existingServerMessageId: m.serverMessageId,
                existingGenerationTaskId: m.generationTaskId,
                busyActivityStatus: createBusyGeneratingStatus(translate),
              }),
            }));
          syncCompareMessagesToRuntime(convId, next, compareModelIds);
          return next;
        });
      };

      const handleCompareRunError = (assistantMsg: Message, error: any, streamResult?: ChatStreamRunResult) => {
        const realtime = realtimeGet(assistantMsg.id);
        const decision = decideCompareRunError({
          assistantModel: assistantMsg.model || "",
          error,
          streamResult,
          realtime,
          hasTaskStream: !!taskStreamsRef.current[assistantMsg.id],
          hasBackgroundPoller: !!backgroundPollersRef.current[assistantMsg.id],
          conversationId: convId,
          existingServerMessageId: assistantMsg.serverMessageId,
          existingGenerationTaskId: assistantMsg.generationTaskId,
          busyActivityStatus: createBusyGeneratingStatus(translate),
          now: now(),
        });

        setMessages((prev) => {
          const next = patchMessageById(prev, assistantMsg.id, decision.patch);
          syncCompareMessagesToRuntime(convId, next, compareModelIds);
          return next;
        });
        if (decision.type === "recoverable_busy" && decision.shouldStartBackgroundPolling && decision.serverMessageId) {
          startBackgroundPolling(convId, assistantMsg.id, decision.serverMessageId);
        }
      };

      try {
        await runCompareModels({
          apiBaseUrl,
          headers,
          controllers,
          assistantMessages: assistantMsgs,
          compareModelIds,
          modelMessages: toModelMessages(contextMessages),
          conversationId: convId,
          notebookId,
          notebookFileIds,
          reasoning,
          search,
          templateId,
          templatePrefix,
          skillKey: effectiveSkillKey,
          messageFileIds: file_ids,
          explicitGroupContext: groupContext,
          callbacks: {
            streamResponse,
            onGroupContextResolved: handleCompareGroupContextResolved,
            onRecoverableResult: handleCompareRecoverableResult,
            onAbortUser: (assistantMsg) => {
              setMessages((prev) => {
                const next = patchMessageById(prev, assistantMsg.id, buildUserAbortStoppedPatch(now()));
                syncCompareMessagesToRuntime(convId, next, compareModelIds);
                return next;
              });
            },
            onRunError: handleCompareRunError,
            getAbortReason: () => abortReasonRef.current,
          },
        });
      } finally {
        const decision = decideCompareRunFinally({
          abortReason: abortReasonRef.current,
          hasActiveTaskStream: Object.keys(taskStreamsRef.current).length > 0,
          hasActivePoller: Object.keys(backgroundPollersRef.current).length > 0,
          conversationId: convId,
        });
        if (decision.shouldUpdateLoading) setIsLoading(Boolean(decision.isLoading));
        if (decision.shouldClearCompareControllers) compareAbortControllersRef.current = [];
        if (decision.shouldClearMainController) abortControllerRef.current = null;
        if (decision.shouldClearAbortReason) abortReasonRef.current = null;
        if (decision.shouldDispatchConversationUpdated && decision.conversationId && !notebookId) {
          dispatchWindowEvent(new CustomEvent("conversation-updated", {
            detail: buildConversationUpdatedEventDetail(decision.conversationId, new Date(now()).toISOString()),
          }));
        }
      }
    },
    [
      apiBaseUrl,
      messages,
      models,
      currentConversation,
      createConversation,
      streamResponse,
      effectiveSkillKey,
      createId,
      now,
      getToken,
      getWorkspaceId,
      setIsCompare,
      setCompareModels,
      setMessages,
      setIsLoading,
      startBackgroundPolling,
      dispatchWindowEvent,
      translate,
    ]
  );

  return { sendCompareMessages, retryCompareColumn };
}
