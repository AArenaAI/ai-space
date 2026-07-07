import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { v4 as uuidv4 } from "uuid";
import { apiFetch } from "@/lib/api/client";
import { readAuthState } from "@/lib/auth/state";
import { buildConversationUpdatedEventDetail } from "@/lib/chatRunUiCoordinator";
import { createBusyGeneratingStatus } from "@/lib/chatActivityStatus";
import { createAssistantChatMessage } from "@/lib/chatMessageFactory";
import { buildChatRequestHeaders } from "@/lib/chatRequestBuilder";
import { toModelMessages } from "@/lib/chatHistoryTransform";
import { runSingleChatInit } from "@/lib/chatSingleSendCoordinator";
import { initializeAssistantRealtime } from "@/lib/chatInitialRealtime";
import type { ChatModel, Message } from "@/lib/chatTypes";
import type { ChatStreamRunResult } from "@/lib/chatStreamRunResult";
import { chatRuntimeStore } from "@/lib/chatRuntime";
import { getGuestId } from "@/lib/guestId";

type StreamResponse = (
  response: Response,
  assistantMsg: Message,
  controller: AbortController,
  convId?: number,
) => Promise<ChatStreamRunResult | undefined>;

type EditUserMessageOptions = {
  apiBaseUrl: string;
  messages: Message[];
  selectedModel: ChatModel;
  currentConversation?: number;
  isCompare: boolean;
  isLoading: boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  abortReasonRef: MutableRefObject<"user" | "navigation" | null>;
  pendingLocalAssistantsRef?: MutableRefObject<Record<string, { convId?: number; message: Message }>>;
  streamResponse: StreamResponse;
  reasoning: { enabled: boolean; effort?: string };
  search: boolean;
  notebookId?: number;
  notebookFileIds?: number[];
  skillKey?: string;
  translate: (key: string) => string;
  now?: () => number;
  createId?: () => string;
  dispatchWindowEvent?: (event: Event) => void;
};

type EditResponse = {
  message?: { id: number; content: string };
  deleted_message_ids?: number[];
  updated_at?: string;
};

function syncEditedMessagesToRuntime(conversationId: number | undefined, messages: Message[], pendingOptimisticMessages: Message[] = []) {
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

export function useChatUserMessageEditRuntime({
  apiBaseUrl,
  messages,
  selectedModel,
  currentConversation,
  isCompare,
  isLoading,
  setMessages,
  setIsLoading,
  abortControllerRef,
  abortReasonRef,
  pendingLocalAssistantsRef,
  streamResponse,
  reasoning,
  search,
  notebookId,
  notebookFileIds,
  skillKey,
  translate,
  now = Date.now,
  createId = uuidv4,
  dispatchWindowEvent = (event) => window.dispatchEvent(event),
}: EditUserMessageOptions) {
  return useCallback(async (message: Message, nextContent: string) => {
    const content = nextContent.trim();
    if (!content) throw new Error("消息内容不能为空");
    if (isCompare) throw new Error("对比模式暂不支持编辑历史问题");
    if (isLoading) throw new Error("当前会话仍在生成中，请先停止后再编辑");
    if (!currentConversation || !message.serverMessageId || message.role !== "user") {
      throw new Error("当前消息暂不支持编辑");
    }

    const response = await apiFetch(`/conversations/${currentConversation}/messages/${message.serverMessageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content, truncate_after: true }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || body.error || "编辑消息失败");
    }
    const data = await response.json().catch(() => ({})) as EditResponse;

    const editedIndex = messages.findIndex((item) => item.id === message.id || item.serverMessageId === message.serverMessageId);
    if (editedIndex < 0) throw new Error("找不到要编辑的消息");

    const editedMessage: Message = {
      ...messages[editedIndex],
      content,
      id: String(data.message?.id || message.serverMessageId || messages[editedIndex].id),
      serverMessageId: data.message?.id || message.serverMessageId,
    };
    const truncatedMessages = [
      ...messages.slice(0, editedIndex),
      editedMessage,
    ];
    const localAssistant = createAssistantChatMessage({
      id: createId(),
      model: selectedModel.id,
      createdAt: now(),
      search,
    }) as Message;
    const optimisticMessages = [...truncatedMessages, localAssistant];
    setMessages(optimisticMessages);
    syncEditedMessagesToRuntime(currentConversation, optimisticMessages, [localAssistant]);
    dispatchWindowEvent(new CustomEvent("conversation-updated", {
      detail: buildConversationUpdatedEventDetail(currentConversation, new Date(now()).toISOString(), {
        title: content.slice(0, 20) + (content.length > 20 ? "..." : ""),
        model: selectedModel.id,
        source: "local-edit-user-message",
      }),
    }));

    setIsLoading(true);
    const controller = new AbortController();
    abortReasonRef.current = null;
    abortControllerRef.current = controller;
    let activeAssistantId = localAssistant.id;

    try {
      const token = readAuthState().token;
      const headers = buildChatRequestHeaders({ token, guestId: getGuestId() });
      const initResult = await runSingleChatInit<Message>({
        apiBaseUrl,
        headers,
        controller,
        modelId: selectedModel.id,
        modelMessages: toModelMessages(truncatedMessages),
        conversationId: currentConversation,
        notebookId,
        notebookFileIds,
        reasoning,
        search,
        templateId: 0,
        skipSaveUserMessage: true,
        userMessageId: editedMessage.serverMessageId,
        skillKey,
        messageFileIds: editedMessage.files?.map((file) => file.public_id).filter(Boolean),
        fallbackId: () => localAssistant.id,
      });
      const serverAssistantId = String(initResult.assistant_message_id || initResult.mappedAssistantMessage.id || localAssistant.id);
      const serverAssistant = {
        ...localAssistant,
        ...initResult.mappedAssistantMessage,
        id: serverAssistantId,
        serverMessageId: initResult.assistant_message_id || initResult.mappedAssistantMessage.serverMessageId,
        generationTaskId: initResult.task_id || initResult.mappedAssistantMessage.generationTaskId,
        createdAt: initResult.mappedAssistantMessage.createdAt || localAssistant.createdAt,
        search,
        activityStatus: createBusyGeneratingStatus(translate),
        generationStartedAt: initResult.mappedAssistantMessage.createdAt || localAssistant.createdAt || now(),
      } as Message;
      activeAssistantId = serverAssistant.id;
      initializeAssistantRealtime(serverAssistant.id, serverAssistant.generationStartedAt || serverAssistant.createdAt || now());
      const serverMessages = [...truncatedMessages, serverAssistant];
      setMessages(serverMessages);
      syncEditedMessagesToRuntime(currentConversation, serverMessages, [serverAssistant]);
      if (pendingLocalAssistantsRef) {
        pendingLocalAssistantsRef.current[serverAssistant.id] = { convId: currentConversation, message: serverAssistant };
        syncEditedMessagesToRuntime(currentConversation, serverMessages, buildPendingLocalAssistantMessages(pendingLocalAssistantsRef, currentConversation));
      }
      const streamRes = await fetch(`${apiBaseUrl}/api/tasks/${initResult.task_id}/stream?after=0`, {
        headers,
        signal: controller.signal,
      });
      if (!streamRes.ok) {
        const errorBody = await streamRes.json().catch(() => ({}));
        throw new Error(errorBody.message || errorBody.error || "连接生成任务失败");
      }
      await streamResponse(streamRes, serverAssistant, controller, currentConversation);
    } catch (error) {
      setMessages((prev) => prev.map((item) => item.id === activeAssistantId || item.id === localAssistant.id ? {
        ...item,
        errorCode: "edit_regenerate_failed",
        retryable: true,
        content: error instanceof Error ? error.message : "重新生成失败",
        completedAt: now(),
      } : item));
      throw error;
    } finally {
      if (pendingLocalAssistantsRef) {
        delete pendingLocalAssistantsRef.current[activeAssistantId];
      }
      setIsLoading(false);
      abortControllerRef.current = null;
      abortReasonRef.current = null;
      syncEditedMessagesToRuntime(currentConversation, chatRuntimeStore.getConversation(currentConversation).messages as Message[], buildPendingLocalAssistantMessages(pendingLocalAssistantsRef, currentConversation));
    }
  }, [abortControllerRef, abortReasonRef, apiBaseUrl, createId, currentConversation, dispatchWindowEvent, isCompare, isLoading, messages, notebookFileIds, notebookId, now, pendingLocalAssistantsRef, reasoning, search, selectedModel.id, setIsLoading, setMessages, skillKey, streamResponse, translate]);
}
