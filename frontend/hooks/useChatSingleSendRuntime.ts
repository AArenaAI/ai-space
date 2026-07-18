import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { v4 as uuidv4 } from "uuid";
import { getGuestId } from "@/lib/guestId";
import {
  buildNewConversationTitle,
  prepareSingleSendMessages,
  runSingleChatInit,
  shouldStartSingleSend,
} from "@/lib/chatSingleSendCoordinator";
import {
  buildConversationUpdatedEventDetail,
  decideSingleSendError,
  decideSingleSendFinally,
} from "@/lib/chatRunUiCoordinator";
import {
  appendCreateConversationFailureMessage,
  buildCreateConversationFailureMessage,
} from "@/lib/chatLocalActionCoordinator";
import { patchMessageById } from "@/lib/chatMessageStatePatch";
import { buildChatRequestHeaders } from "@/lib/chatRequestBuilder";
import { toModelMessages } from "@/lib/chatHistoryTransform";
import { initializeAssistantRealtime } from "@/lib/chatInitialRealtime";
import { createBusyGeneratingStatus } from "@/lib/chatActivityStatus";
import type { ChatStreamGroupContext, ChatStreamRunResult } from "@/lib/chatStreamRunResult";
import type { ChatModel, Message } from "@/lib/chatTypes";
import type { CreateConversationAction } from "@/hooks/useChatConversationCreateRuntime";
import { readAuthState } from "@/lib/auth/state";
import { chatRuntimeStore } from "@/lib/chatRuntime";
import { bindServerMessage, sameChatMessage } from "@/lib/chatMessageIdentity";

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
export type SingleSendAcceptResult = { accepted: boolean; notice?: string; completion?: Promise<void> };

function syncSingleSendMessagesToRuntime(conversationId: number | undefined, messages: Message[], pendingOptimisticMessages: Message[] = []) {
  if (!conversationId) return;
  chatRuntimeStore.patchConversation(conversationId, {
    messages,
    pendingOptimisticMessages,
    updatedAt: Date.now(),
  });
}

function buildPendingLocalAssistantMessages(pendingLocalAssistantsRef: MutableRefObject<Record<string, { convId?: number; message: Message }>> | undefined, conversationId: number | undefined) {
  if (!pendingLocalAssistantsRef || !conversationId) return [];
  return Object.values(pendingLocalAssistantsRef.current)
    .filter((entry) => entry.convId === conversationId)
    .map((entry) => entry.message);
}

export type UseChatSingleSendRuntimeOptions = {
  apiBaseUrl: string;
  messages: Message[];
  selectedModel: ChatModel;
  currentConversation: number | undefined;
  notebookId?: number;
  notebookFileIds?: number[];
  effectiveSkillKey: string | undefined;
  createConversation: CreateConversationAction;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  abortReasonRef: MutableRefObject<AbortReason>;
  taskStreamsRef: MutableRefObject<Record<string, AbortController>>;
  pendingLocalAssistantsRef?: MutableRefObject<Record<string, { convId?: number; message: Message }>>;
  lastReasoningRef: MutableRefObject<SendReasoning>;
  lastSearchRef: MutableRefObject<boolean>;
  streamResponse: StreamResponse;
  translate: (key: string) => string;
  now?: () => number;
  createId?: () => string;
  getToken?: () => string | null;
  dispatchWindowEvent?: (event: Event) => void;
};

export function useChatSingleSendRuntime({
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
  now = Date.now,
  createId = uuidv4,
  getToken = () => readAuthState().token,
  dispatchWindowEvent = (event) => window.dispatchEvent(event),
}: UseChatSingleSendRuntimeOptions) {
  const inFlightSendKeysRef = useRef<Set<string>>(new Set());
  const applyServerFirstPreInitMessages = useCallback((previous: Message[], plan: ReturnType<typeof prepareSingleSendMessages<Message>>): Message[] => {
    if (!plan) return previous;
    if (plan.mode === "regenerate") {
      const lastUserIndex = plan.lastUserIndex ?? -1;
      return [...previous.filter((message, index) => index <= lastUserIndex || message.role !== "assistant"), plan.assistantMessage];
    }
    if (plan.mode === "skip-user") return [...previous, plan.assistantMessage];
    return [...previous, plan.userMessage!, plan.assistantMessage];
  }, []);

  const sendMessage = useCallback(
    async (
      content: string,
      reasoning: SendReasoning = { enabled: false },
      isRegenerate: boolean = false,
      search: boolean = false,
      templateId: number = 0,
      skipUserMsg: boolean = false,
      attachments?: SendAttachment[],
      file_ids?: string[],
      templatePrefix?: string
    ): Promise<SingleSendAcceptResult> => {
      if (!shouldStartSingleSend({ content, isRegenerate, attachments })) return { accepted: false, notice: "没有可发送的内容。" };

      lastReasoningRef.current = reasoning;
      lastSearchRef.current = search;

      const token = getToken();

      let convId = currentConversation;
      if (!convId && !isRegenerate) {
        const title = buildNewConversationTitle(content);
        convId = await createConversation(title, selectedModel.id, effectiveSkillKey);
        if (!convId) {
          const failureMessage = buildCreateConversationFailureMessage({
            id: createId(),
            modelId: selectedModel.id,
            createdAt: now(),
          }) as Message;
          setMessages((prev) => appendCreateConversationFailureMessage(prev, failureMessage));
          setIsLoading(false);
          return { accepted: false, notice: "创建对话失败，当前消息尚未发送，已为你保留输入内容。" };
        }
      }

      const messagePlan = prepareSingleSendMessages<Message>({
        content,
        messages,
        modelId: selectedModel.id,
        isRegenerate,
        skipUserMessage: skipUserMsg,
        attachments,
        search: lastSearchRef.current,
        createId,
        now,
      });
      if (!messagePlan) return { accepted: false, notice: "没有可发送的内容。" };

      const sendDedupKey = JSON.stringify({
        convId: convId || "new",
        modelId: selectedModel.id,
        content: content.trim(),
        isRegenerate,
        skipUserMsg,
        search,
        templateId,
        fileIds: file_ids || [],
      });
      if (inFlightSendKeysRef.current.has(sendDedupKey)) return { accepted: false, notice: "这条消息正在发送中。" };
      inFlightSendKeysRef.current.add(sendDedupKey);

      const contextMessages = messagePlan.contextMessages;
      const localAssistantMsg = messagePlan.assistantMessage;
      let lastRuntimeMessages: Message[] = [];
      setMessages((prev) => {
        const next = applyServerFirstPreInitMessages(prev, messagePlan);
        lastRuntimeMessages = next;
        syncSingleSendMessagesToRuntime(convId, next);
        return next;
      });
      if (convId && !notebookId) {
        dispatchWindowEvent(new CustomEvent("conversation-updated", {
          detail: buildConversationUpdatedEventDetail(convId, new Date(now()).toISOString(), {
            title: content.trim().slice(0, 20) + (content.trim().length > 20 ? "..." : ""),
            model: selectedModel.id,
            source: "local-send",
          }),
        }));
      }

      setIsLoading(true);
      const controller = new AbortController();
      abortReasonRef.current = null;
      abortControllerRef.current = controller;
      // local_committed → submitting：在真正发起 init 前切换发送状态
      if (messagePlan.userMessage && messagePlan.userMessage.sendStatus === "local_committed") {
        setMessages((prev) => {
          const next = prev.map((message) =>
            sameChatMessage(message, messagePlan.userMessage!)
              ? { ...message, sendStatus: "submitting" as const }
              : message
          );
          lastRuntimeMessages = next;
          syncSingleSendMessagesToRuntime(convId, next);
          return next;
        });
      }
      let activeAssistantId = localAssistantMsg.id;
      let hasInsertedServerAssistant = false;
      if (pendingLocalAssistantsRef && convId) {
        pendingLocalAssistantsRef.current[localAssistantMsg.id] = { convId, message: localAssistantMsg };
        syncSingleSendMessagesToRuntime(convId, lastRuntimeMessages, buildPendingLocalAssistantMessages(pendingLocalAssistantsRef, convId));
      }

      const completion = (async () => {
      try {
        const headers = buildChatRequestHeaders({ token, guestId: getGuestId() });
        const initResult = await runSingleChatInit<Message>({
          apiBaseUrl,
          headers,
          controller,
          modelId: selectedModel.id,
          modelMessages: toModelMessages(contextMessages),
          conversationId: convId,
          notebookId,
          notebookFileIds,
          reasoning,
          search,
          templateId,
          skipSaveUserMessage: skipUserMsg,
          skillKey: effectiveSkillKey,
          messageFileIds: file_ids,
          fallbackId: () => localAssistantMsg.id,
          clientMessageId: messagePlan.userMessage?.clientMessageId,
          localRunId: messagePlan.userMessage?.localRunId,
          sendStatus: messagePlan.userMessage?.sendStatus,
        });
        convId = initResult.conversation_id || convId;
        const serverAssistant = bindServerMessage(localAssistantMsg, {
          ...initResult.mappedAssistantMessage,
          serverMessageId: initResult.assistant_message_id || initResult.mappedAssistantMessage.serverMessageId,
          generationTaskId: initResult.task_id || initResult.mappedAssistantMessage.generationTaskId,
          createdAt: initResult.mappedAssistantMessage.createdAt || localAssistantMsg.createdAt,
          search,
          searchStatus: search ? "searching" : initResult.mappedAssistantMessage.searchStatus,
          activityStatus: createBusyGeneratingStatus(translate),
          generationStartedAt: initResult.mappedAssistantMessage.createdAt || localAssistantMsg.createdAt || now(),
          generationStatus: "pending",
        }) as Message;
        activeAssistantId = serverAssistant.id;
        initializeAssistantRealtime(serverAssistant.id, serverAssistant.generationStartedAt || serverAssistant.createdAt || now());
        setMessages((prev) => {
          let assistantPatched = false;
          const patched = prev.map((message) => {
            if (initResult.user_message_id && messagePlan.userMessage && sameChatMessage(message, messagePlan.userMessage)) {
              return { ...message, serverMessageId: initResult.user_message_id, sendStatus: "server_bound" } as Message;
            }
            if (sameChatMessage(message, localAssistantMsg)) {
              assistantPatched = true;
              return bindServerMessage(message as Message, serverAssistant) as Message;
            }
            if (serverAssistant.serverMessageId && message.role === "assistant" && message.serverMessageId === serverAssistant.serverMessageId) {
              assistantPatched = true;
              return bindServerMessage(localAssistantMsg, { ...message, ...serverAssistant }) as Message;
            }
            return message;
          });
          const next = assistantPatched ? patched : [...patched, serverAssistant];
          lastRuntimeMessages = next;
          syncSingleSendMessagesToRuntime(convId, next, [serverAssistant]);
          return next;
        });
        hasInsertedServerAssistant = true;
        if (pendingLocalAssistantsRef && convId) {
          pendingLocalAssistantsRef.current[serverAssistant.id] = { convId, message: serverAssistant };
          syncSingleSendMessagesToRuntime(convId, lastRuntimeMessages, buildPendingLocalAssistantMessages(pendingLocalAssistantsRef, convId));
        }
        const streamRes = await fetch(`${apiBaseUrl}/api/tasks/${initResult.task_id}/stream?after=0`, {
          headers,
          signal: controller.signal,
        });
        if (!streamRes.ok) {
          const errorBody = await streamRes.json().catch(() => ({}));
          const errorCode = errorBody.error || errorBody.code || "unknown";
          const errorMsg = errorBody.message || "连接生成任务失败";
          throw Object.assign(new Error(errorMsg), { errorCode, status: streamRes.status });
        }
        await streamResponse(streamRes, serverAssistant, controller, convId);
      } catch (error: any) {
        const decision = decideSingleSendError({
          error,
          abortReason: abortReasonRef.current,
          modelId: selectedModel.id,
          conversationId: convId,
          busyActivityStatus: createBusyGeneratingStatus(translate),
        });
        if (decision.type !== "none") {
          setMessages((prev) => {
            const userSendStatus = !hasInsertedServerAssistant
              ? decision.type === "stopped" ? "cancelled" : "failed"
              : undefined;
            const withUserState = userSendStatus && messagePlan.userMessage
              ? prev.map((message) => sameChatMessage(message, messagePlan.userMessage!)
                ? {
                    ...message,
                    sendStatus: userSendStatus,
                    errorCode: decision.type === "display_error" ? decision.patch.errorCode : message.errorCode,
                  } as Message
                : message)
              : prev;
            const stopped = decision.type === "stopped";
            const next = withUserState.some((message) => message?.id === activeAssistantId)
              ? patchMessageById(withUserState, activeAssistantId, {
                  ...decision.patch,
                  stopped,
                  generationStatus: stopped ? "cancelled" : "failed",
                })
              : hasInsertedServerAssistant
                ? withUserState
                : [...withUserState, { ...localAssistantMsg, ...decision.patch, stopped, generationStatus: stopped ? "cancelled" : "failed" } as Message];
            syncSingleSendMessagesToRuntime(convId, next, buildPendingLocalAssistantMessages(pendingLocalAssistantsRef, convId));
            return next;
          });
        }
      } finally {
        inFlightSendKeysRef.current.delete(sendDedupKey);
        const finalAbortReason = abortReasonRef.current;
        if (pendingLocalAssistantsRef && finalAbortReason !== "navigation") {
          delete pendingLocalAssistantsRef.current[activeAssistantId];
          if (convId) {
            chatRuntimeStore.patchConversation(convId, {
              pendingOptimisticMessages: buildPendingLocalAssistantMessages(pendingLocalAssistantsRef, convId),
              updatedAt: Date.now(),
            });
          }
        }
        const decision = decideSingleSendFinally({
          abortReason: finalAbortReason,
          hasActiveTaskStream: Object.keys(taskStreamsRef.current).length > 0,
          conversationId: convId,
        });
        if (decision.shouldUpdateLoading) setIsLoading(Boolean(decision.isLoading));
        if (decision.shouldClearMainController) abortControllerRef.current = null;
        if (decision.shouldClearAbortReason) abortReasonRef.current = null;
        if (decision.shouldDispatchConversationUpdated && decision.conversationId && !notebookId) {
          dispatchWindowEvent(new CustomEvent("conversation-updated", {
            detail: buildConversationUpdatedEventDetail(decision.conversationId, new Date(now()).toISOString()),
          }));
        }
      }
      })();
      return { accepted: true, completion };
    },
    [
      apiBaseUrl,
      messages,
      selectedModel,
      currentConversation,
      notebookId,
      notebookFileIds,
      createConversation,
      streamResponse,
      effectiveSkillKey,
      createId,
      now,
      getToken,
      setMessages,
      setIsLoading,
      dispatchWindowEvent,
      translate,
      applyServerFirstPreInitMessages,
    ]
  );

  return { sendMessage };
}
