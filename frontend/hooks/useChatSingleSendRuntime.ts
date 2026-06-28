import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { v4 as uuidv4 } from "uuid";
import { getGuestId } from "@/lib/guestId";
import {
  applySingleSendMessagePlan,
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
  getToken = () => localStorage.getItem("token"),
  dispatchWindowEvent = (event) => window.dispatchEvent(event),
}: UseChatSingleSendRuntimeOptions) {
  const inFlightSendKeysRef = useRef<Set<string>>(new Set());
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
    ) => {
      if (!shouldStartSingleSend({ content, isRegenerate, attachments })) return;

      lastReasoningRef.current = reasoning;
      lastSearchRef.current = search;

      const token = getToken();

      let convId = currentConversation;
      if (token && !convId && !isRegenerate) {
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
          return;
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
      if (!messagePlan) return;

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
      if (inFlightSendKeysRef.current.has(sendDedupKey)) return;
      inFlightSendKeysRef.current.add(sendDedupKey);

      const contextMessages = messagePlan.contextMessages;
      const assistantMsg = messagePlan.assistantMessage;
      initializeAssistantRealtime(assistantMsg.id, assistantMsg.createdAt || now());
      if (pendingLocalAssistantsRef && convId) {
        pendingLocalAssistantsRef.current[assistantMsg.id] = {
          convId,
          message: {
            ...assistantMsg,
            activityStatus: createBusyGeneratingStatus(translate),
            generationStartedAt: assistantMsg.createdAt || now(),
          } as Message,
        };
      }
      setMessages((prev) => applySingleSendMessagePlan(prev, messagePlan));

      setIsLoading(true);
      const controller = new AbortController();
      abortReasonRef.current = null;
      abortControllerRef.current = controller;

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
          fallbackId: () => assistantMsg.id,
        });
        convId = initResult.conversation_id || convId;
        const serverAssistant = {
          ...assistantMsg,
          ...initResult.mappedAssistantMessage,
          id: assistantMsg.id,
          createdAt: initResult.mappedAssistantMessage.createdAt || assistantMsg.createdAt,
          search,
          searchStatus: search ? "searching" : initResult.mappedAssistantMessage.searchStatus,
          activityStatus: createBusyGeneratingStatus(translate),
          generationStartedAt: assistantMsg.createdAt || now(),
        } as Message;
        setMessages((prev) => patchMessageById(prev.map((message) => {
          if (initResult.user_message_id && message.id === messagePlan.userMessage?.id) {
            return { ...message, id: String(initResult.user_message_id), serverMessageId: initResult.user_message_id } as Message;
          }
          return message;
        }), assistantMsg.id, serverAssistant));
        if (pendingLocalAssistantsRef && convId) {
          pendingLocalAssistantsRef.current[assistantMsg.id] = { convId, message: serverAssistant };
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
          setMessages((prev) => patchMessageById(prev, assistantMsg.id, decision.patch));
        }
      } finally {
        inFlightSendKeysRef.current.delete(sendDedupKey);
        const finalAbortReason = abortReasonRef.current;
        if (pendingLocalAssistantsRef && finalAbortReason !== "navigation") {
          delete pendingLocalAssistantsRef.current[assistantMsg.id];
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
    ]
  );

  return { sendMessage };
}
