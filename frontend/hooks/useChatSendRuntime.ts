import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { v4 as uuidv4 } from "uuid";
import { getGuestId } from "@/lib/guestId";
import { realtimeGet } from "@/lib/streaming";
import { runCompareModels } from "@/lib/chatCompareRunCoordinator";
import {
  applySingleSendMessagePlan,
  buildNewConversationTitle,
  prepareSingleSendMessages,
  runSingleChatRequest,
  shouldStartSingleSend,
} from "@/lib/chatSingleSendCoordinator";
import {
  buildCreateConversationBody,
  buildCreatedConversationUrl,
  resolveCreatedConversationTitle,
  runCreateConversationRequest,
  shouldCreateConversation,
} from "@/lib/chatConversationCreateCoordinator";
import {
  buildConversationUpdatedEventDetail,
  buildRecoverableResultPatch,
  buildUserAbortStoppedPatch,
  decideCompareRunError,
  decideCompareRunFinally,
  decideSingleSendError,
  decideSingleSendFinally,
} from "@/lib/chatRunUiCoordinator";
import {
  appendCreateConversationFailureMessage,
  buildCreateConversationFailureMessage,
} from "@/lib/chatLocalActionCoordinator";
import {
  applyCompareGroupContextToMessages,
  patchMessageById,
} from "@/lib/chatMessageStatePatch";
import { buildChatRequestHeaders } from "@/lib/chatRequestBuilder";
import { toModelMessages } from "@/lib/chatHistoryTransform";
import {
  buildMessageFiles,
  createCompareAssistantMessages,
  createUserChatMessage,
} from "@/lib/chatMessageFactory";
import {
  selectCompareModelIds,
  shouldStartCompare,
} from "@/lib/chatCompareCoordinator";
import { createBusyGeneratingStatus } from "@/lib/chatActivityStatus";
import type { ChatStreamGroupContext, ChatStreamRunResult } from "@/lib/chatStreamRunResult";
import type { ChatModel, Message } from "@/lib/chatTypes";

type AbortReason = "user" | "navigation" | null;
type CompareGroupContext = ChatStreamGroupContext;
type StreamRunResult = ChatStreamRunResult;
type StreamResponse = (
  response: Response,
  assistantMsg: Message,
  controller: AbortController,
  convId?: number,
  onGroupContext?: (context: CompareGroupContext) => void
) => Promise<StreamRunResult | undefined>;
type StartBackgroundPolling = (
  convId: number | undefined,
  localMessageId: string,
  serverMessageId?: number
) => void;

type SendReasoning = { enabled: boolean; effort?: string };
type SendAttachment = { filename: string; content: string; type?: string; public_id?: string };

export type UseChatSendRuntimeOptions = {
  apiBaseUrl: string;
  messages: Message[];
  models: ChatModel[];
  selectedModel: ChatModel;
  currentConversation: number | undefined;
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
  backgroundPollersRef,
  lastReasoningRef,
  lastSearchRef,
  streamResponse,
  startBackgroundPolling,
  translate,
  now = Date.now,
  createId = uuidv4,
  getToken = () => localStorage.getItem("token"),
  getWorkspaceId = () => localStorage.getItem("current-workspace"),
  getCurrentHref = () => window.location.href,
  replaceHistory = (url) => window.history.replaceState({}, "", url),
  dispatchWindowEvent = (event) => window.dispatchEvent(event),
}: UseChatSendRuntimeOptions) {
  const createConversation = useCallback(
    async (title: string, model: string, sk?: string): Promise<number | undefined> => {
      const token = getToken();
      if (!shouldCreateConversation({ token })) return undefined;

      try {
        const body = buildCreateConversationBody({
          title,
          model,
          skillKey: sk,
          workspaceId: getWorkspaceId(),
        });
        const data = await runCreateConversationRequest({
          apiBaseUrl,
          token: token as string,
          body,
        });
        if (!data) return undefined;

        setCreatedConversation(data.id, resolveCreatedConversationTitle(data, title));
        replaceHistory(buildCreatedConversationUrl({
          currentHref: getCurrentHref(),
          conversationId: data.id,
          skillKey: sk,
        }));
        dispatchWindowEvent(new CustomEvent("conversation-created", { detail: data }));
        return data.id;
      } catch (err) {
        console.error("createConversation error:", err);
        return undefined;
      }
    },
    [apiBaseUrl, getCurrentHref, getToken, getWorkspaceId, replaceHistory, dispatchWindowEvent, setCreatedConversation]
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

      const finalContent = content.trim();
      const userFiles = buildMessageFiles(attachments, { defaultType: "file" });
      const userMsg = createUserChatMessage({
        id: createId(),
        content: finalContent,
        createdAt: now(),
        files: userFiles,
      }) as Message;
      const assistantMsgs = createCompareAssistantMessages({
        modelIds: compareModelIds,
        ids: compareModelIds.map(() => createId()),
        createdAt: now(),
        search: lastSearchRef.current,
      }) as Message[];
      const contextMessages = [...messages, userMsg];

      setIsCompare(true);
      setCompareModels(compareModelIds);
      setMessages((prev) => [...prev, userMsg, ...assistantMsgs]);
      setIsLoading(true);

      const controllers = assistantMsgs.map(() => new AbortController());
      compareAbortControllersRef.current = controllers;
      abortControllerRef.current = null;
      abortReasonRef.current = null;

      const headers = buildChatRequestHeaders({ token, guestId: getGuestId() });

      const handleCompareGroupContextResolved = (context: CompareGroupContext) => {
        setMessages((prev) => applyCompareGroupContextToMessages(prev, {
          userMessageId: userMsg.id,
          assistantIds: assistantMsgs.map((assistant) => assistant.id),
          context,
        }));
      };

      const handleCompareRecoverableResult = (assistantMsg: Message, streamResult: StreamRunResult) => {
        setMessages((prev) => patchMessageById(prev, assistantMsg.id, (m) => buildRecoverableResultPatch({
          serverMessageId: streamResult.serverMessageId,
          generationTaskId: streamResult.generationTaskId,
          existingServerMessageId: m.serverMessageId,
          existingGenerationTaskId: m.generationTaskId,
          busyActivityStatus: createBusyGeneratingStatus(translate),
        })));
      };

      const handleCompareRunError = (assistantMsg: Message, error: any, streamResult?: StreamRunResult) => {
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

        setMessages((prev) => patchMessageById(prev, assistantMsg.id, decision.patch));
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
          reasoning,
          search,
          templateId,
          templatePrefix,
          skillKey: effectiveSkillKey,
          messageFileIds: file_ids,
          callbacks: {
            streamResponse,
            onGroupContextResolved: handleCompareGroupContextResolved,
            onRecoverableResult: handleCompareRecoverableResult,
            onAbortUser: (assistantMsg) => {
              setMessages((prev) => patchMessageById(prev, assistantMsg.id, buildUserAbortStoppedPatch(now())));
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
        if (decision.shouldDispatchConversationUpdated && decision.conversationId) {
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
      setIsCompare,
      setCompareModels,
      setMessages,
      setIsLoading,
      startBackgroundPolling,
      dispatchWindowEvent,
      translate,
    ]
  );

  const sendMessage = useCallback(
    async (
      content: string,
      reasoning: SendReasoning = { enabled: false },
      isRegenerate: boolean = false,
      search: boolean = false,
      templateId: number = 0,
      skipUserMsg: boolean = false,
      attachments?: { filename: string; content: string; type: string; public_id?: string }[],
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

      const contextMessages = messagePlan.contextMessages;
      const assistantMsg = messagePlan.assistantMessage;
      setMessages((prev) => applySingleSendMessagePlan(prev, messagePlan));

      setIsLoading(true);
      const controller = new AbortController();
      abortReasonRef.current = null;
      abortControllerRef.current = controller;

      try {
        const headers = buildChatRequestHeaders({ token, guestId: getGuestId() });
        await runSingleChatRequest({
          apiBaseUrl,
          headers,
          controller,
          assistantMessage: assistantMsg,
          modelId: selectedModel.id,
          modelMessages: toModelMessages(contextMessages),
          conversationId: convId,
          reasoning,
          search,
          templateId,
          skipSaveUserMessage: skipUserMsg,
          skillKey: effectiveSkillKey,
          messageFileIds: file_ids,
          streamResponse,
        });
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
        const decision = decideSingleSendFinally({
          abortReason: abortReasonRef.current,
          hasActiveTaskStream: Object.keys(taskStreamsRef.current).length > 0,
          conversationId: convId,
        });
        if (decision.shouldUpdateLoading) setIsLoading(Boolean(decision.isLoading));
        if (decision.shouldClearMainController) abortControllerRef.current = null;
        if (decision.shouldClearAbortReason) abortReasonRef.current = null;
        if (decision.shouldDispatchConversationUpdated && decision.conversationId) {
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

  return {
    createConversation,
    sendCompareMessages,
    sendMessage,
  };
}
