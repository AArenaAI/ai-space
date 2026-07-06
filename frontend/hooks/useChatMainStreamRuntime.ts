import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { registerBackgroundTask as defaultRegisterBackgroundTask } from "@/lib/taskNotifications";
import {
  realtimeAppend as defaultRealtimeAppend,
  realtimeUpdate as defaultRealtimeUpdate,
  realtimeGet as defaultRealtimeGet,
  realtimeMarkCompleted as defaultRealtimeMarkCompleted,
} from "@/lib/streaming";
import type { RealtimeData } from "@/lib/streaming";
import { createMainStreamEventHandler as defaultCreateMainStreamEventHandler } from "@/lib/chatMainStreamEventHandler";
import { runChatStreamLifecycle as defaultRunChatStreamLifecycle } from "@/lib/chatStreamLifecycle";
import {
  buildFinalStreamRunResult,
  decideFinalStreamReconciliation,
} from "@/lib/chatFinalReconciliationCoordinator";
import { buildCompletedPatch } from "@/lib/chatCompletionFinalizer";
import {
  applyFinalRealtimeDataToMessage,
  patchMessageById,
} from "@/lib/chatMessageStatePatch";
import type { ChatStreamGroupContext, ChatStreamRunResult } from "@/lib/chatStreamRunResult";
import type { ChatModel, Message } from "@/lib/chatTypes";
import { chatRuntimeStore, chatStreamOwnerRegistry as defaultChatStreamOwnerRegistry } from "@/lib/chatRuntime";
import type { ChatStreamOwner } from "@/lib/chatStreamOwnerRegistry";

type AbortReason = "user" | "navigation" | null;
type CompareGroupContext = ChatStreamGroupContext;
type StreamRunResult = ChatStreamRunResult;
type StartTaskEventStream = (
  convId: number | undefined,
  localMessageId: string,
  serverMessageId?: number,
  after?: number,
  initialContent?: string,
  generationTaskId?: number
) => void;
type StartBackgroundPolling = (
  convId: number | undefined,
  localMessageId: string,
  serverMessageId?: number
) => void;
type MainStreamHandler = ReturnType<typeof defaultCreateMainStreamEventHandler>;

function syncMainStreamToRuntime({
  conversationId,
  assistantId,
  serverMessageId,
  generationTaskId,
  messages,
  active,
}: {
  conversationId: number | undefined;
  assistantId: string;
  serverMessageId?: number;
  generationTaskId?: number;
  messages?: Message[];
  active: boolean;
}) {
  if (!conversationId) return;
  const current = chatRuntimeStore.getConversation(conversationId);
  const activeStreams = { ...current.activeStreams };
  if (active) {
    activeStreams[assistantId] = { convId: conversationId, serverMessageId, generationTaskId, main: true };
  } else {
    delete activeStreams[assistantId];
  }
  const generationTasks = { ...current.generationTasks };
  if (generationTaskId && active) {
    generationTasks[String(generationTaskId)] = { convId: conversationId, serverMessageId, generationTaskId, localMessageId: assistantId };
  } else if (generationTaskId) {
    delete generationTasks[String(generationTaskId)];
  }
  chatRuntimeStore.patchConversation(conversationId, {
    ...(messages ? { messages } : {}),
    activeStreams,
    generationTasks,
    updatedAt: Date.now(),
  });
}

type CreateMainStreamResponseDeps = {
  selectedModelName: string;
  conversationTitle: string;
  getCurrentConversation: () => number | undefined;
  abortReasonRef: MutableRefObject<AbortReason>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  startTaskEventStream: StartTaskEventStream;
  startBackgroundPolling: StartBackgroundPolling;
  translate: (key: string) => string;
  createMainStreamEventHandler?: typeof defaultCreateMainStreamEventHandler;
  runChatStreamLifecycle?: typeof defaultRunChatStreamLifecycle;
  realtimeAppend?: typeof defaultRealtimeAppend;
  realtimeGet?: typeof defaultRealtimeGet;
  realtimeUpdate?: typeof defaultRealtimeUpdate;
  realtimeMarkCompleted?: typeof defaultRealtimeMarkCompleted;
  registerBackgroundTask?: typeof defaultRegisterBackgroundTask;
  streamOwnerRegistry?: typeof defaultChatStreamOwnerRegistry;
  now?: () => number;
};

export function createStreamResponseAction({
  selectedModelName,
  conversationTitle,
  getCurrentConversation,
  abortReasonRef,
  setMessages,
  startTaskEventStream,
  startBackgroundPolling,
  translate,
  createMainStreamEventHandler = defaultCreateMainStreamEventHandler,
  runChatStreamLifecycle = defaultRunChatStreamLifecycle,
  realtimeAppend = defaultRealtimeAppend,
  realtimeGet = defaultRealtimeGet,
  realtimeUpdate = defaultRealtimeUpdate,
  realtimeMarkCompleted = defaultRealtimeMarkCompleted,
  registerBackgroundTask = defaultRegisterBackgroundTask,
  streamOwnerRegistry = defaultChatStreamOwnerRegistry,
  now = Date.now,
}: CreateMainStreamResponseDeps) {
  return async (
    response: Response,
    assistantMsg: Message,
    controller: AbortController,
    convId?: number,
    onGroupContext?: (context: CompareGroupContext) => void
  ): Promise<StreamRunResult | undefined> => {
    const mainStreamHandler: MainStreamHandler = createMainStreamEventHandler({
      assistantMessageId: assistantMsg.id,
      assistantModelName: assistantMsg.model,
      selectedModelName,
      conversationId: convId,
      conversationTitle,
      initialGroupMeta: {
        groupId: assistantMsg.groupId,
        groupIndex: assistantMsg.groupIndex,
        groupModels: assistantMsg.groupModels,
        userMessageId: assistantMsg.userMessageId,
      },
      t: translate,
      callbacks: {
        streamAppend: realtimeAppend,
        streamGet: () => realtimeGet(assistantMsg.id)?.content || "",
        realtimeGet: () => realtimeGet(assistantMsg.id),
        realtimeUpdate: (patch: Partial<RealtimeData>) => realtimeUpdate(assistantMsg.id, patch),
        registerBackgroundTask,
        onGroupContext,
      },
    });

    const buildStreamRunResult = (contentOverride?: string): StreamRunResult => {
      const state = mainStreamHandler.getState();
      return buildFinalStreamRunResult({
        state,
        finalContent: contentOverride || realtimeGet(assistantMsg.id)?.content || "",
      });
    };

    const resolvedConversationId = convId || getCurrentConversation();
    const streamOwner: ChatStreamOwner = {
      conversationId: resolvedConversationId || 0,
      serverMessageId: assistantMsg.serverMessageId,
      streamId: assistantMsg.id,
      groupId: assistantMsg.groupId,
      groupIndex: assistantMsg.groupIndex,
      groupModels: assistantMsg.groupModels,
      column: assistantMsg.groupIndex === 1 ? "right" : assistantMsg.groupIndex === 0 ? "left" : undefined,
    };
    streamOwnerRegistry.register(streamOwner);
    syncMainStreamToRuntime({
      conversationId: resolvedConversationId,
      assistantId: assistantMsg.id,
      serverMessageId: assistantMsg.serverMessageId,
      generationTaskId: assistantMsg.generationTaskId,
      active: true,
    });

    try {
      const lifecycleResult = await runChatStreamLifecycle({
        response,
        signal: controller.signal,
        getAbortReason: () => abortReasonRef.current,
        getRecoveryIds: () => ({
          serverMessageId: mainStreamHandler.getState().serverMessageId,
          generationTaskId: mainStreamHandler.getState().generationTaskId,
        }),
        onEvent: mainStreamHandler.processEvent,
      });
      if (lifecycleResult.action === "ignored") {
        return;
      }
      if (lifecycleResult.action === "resume") {
        mainStreamHandler.setRecoverable(true);
        const state = mainStreamHandler.getState();
        startTaskEventStream(convId || getCurrentConversation(), assistantMsg.id, state.serverMessageId, state.lastSequence, state.accumulated, state.generationTaskId);
        return;
      }
    } finally {
      const abortReason = abortReasonRef.current;
      if (!streamOwnerRegistry.canFinalize(streamOwner)) {
        return;
      }
      streamOwnerRegistry.finalize(streamOwner);

      mainStreamHandler.closeOpenReasoning();
      const state = mainStreamHandler.getState();

      const streamContent = realtimeGet(assistantMsg.id)?.content || "";
      const finalData = realtimeGet(assistantMsg.id);
      const finalAction = decideFinalStreamReconciliation({
        state,
        abortReason,
        streamContent,
        hasRealtimeData: Boolean(finalData),
      });

      if (finalAction.shouldSyncFinalData) {
        setMessages((prev) => {
          const next = patchMessageById(prev, assistantMsg.id, (m) =>
            applyFinalRealtimeDataToMessage(m, { finalContent: finalAction.finalContent, finalData })
          );
          syncMainStreamToRuntime({ conversationId: resolvedConversationId, assistantId: assistantMsg.id, serverMessageId: state.serverMessageId, generationTaskId: state.generationTaskId, messages: next, active: true });
          return next;
        });
      }

      if (finalAction.type === "recover") {
        mainStreamHandler.setRecoverable(true);
        syncMainStreamToRuntime({ conversationId: resolvedConversationId, assistantId: assistantMsg.id, serverMessageId: finalAction.serverMessageId, generationTaskId: finalAction.generationTaskId, active: false });
        startTaskEventStream(
          convId || getCurrentConversation(),
          assistantMsg.id,
          finalAction.serverMessageId,
          finalAction.lastSequence,
          finalAction.finalContent,
          finalAction.generationTaskId
        );
        if (finalAction.shouldStartBackgroundPolling && finalAction.serverMessageId) {
          startBackgroundPolling(convId || getCurrentConversation(), assistantMsg.id, finalAction.serverMessageId);
        }
        return finalAction.result;
      }

      if (finalAction.type === "reconcile_after_done") {
        mainStreamHandler.setRecoverable(true);
        realtimeMarkCompleted(assistantMsg.id, now());
        const completedRealtimeData = realtimeGet(assistantMsg.id);
        if (completedRealtimeData?.statusTimeline?.length) {
          setMessages((prev) => {
            const next = patchMessageById(prev, assistantMsg.id, (m) =>
              applyFinalRealtimeDataToMessage(m, { finalContent: finalAction.finalContent, finalData: completedRealtimeData })
            );
            syncMainStreamToRuntime({ conversationId: resolvedConversationId, assistantId: assistantMsg.id, serverMessageId: finalAction.serverMessageId, generationTaskId: state.generationTaskId, messages: next, active: false });
            return next;
          });
        } else {
          syncMainStreamToRuntime({ conversationId: resolvedConversationId, assistantId: assistantMsg.id, serverMessageId: finalAction.serverMessageId, generationTaskId: state.generationTaskId, active: false });
        }
        if (finalAction.shouldStartBackgroundPolling && finalAction.serverMessageId) {
          startBackgroundPolling(convId || getCurrentConversation(), assistantMsg.id, finalAction.serverMessageId);
        }
        return finalAction.result;
      }

      if (finalAction.shouldClearStores) {
        realtimeMarkCompleted(assistantMsg.id, now());
        const completedRealtimeData = realtimeGet(assistantMsg.id);
        if (completedRealtimeData?.statusTimeline?.length) {
          setMessages((prev) => {
            const next = patchMessageById(prev, assistantMsg.id, (m) =>
              applyFinalRealtimeDataToMessage(m, { finalContent: finalAction.finalContent, finalData: completedRealtimeData })
            );
            syncMainStreamToRuntime({ conversationId: resolvedConversationId, assistantId: assistantMsg.id, serverMessageId: state.serverMessageId, generationTaskId: state.generationTaskId, messages: next, active: false });
            return next;
          });
        } else {
          syncMainStreamToRuntime({ conversationId: resolvedConversationId, assistantId: assistantMsg.id, serverMessageId: state.serverMessageId, generationTaskId: state.generationTaskId, active: false });
        }
      }

      if (finalAction.shouldMarkCompleted) {
        setMessages((prev) => {
          const next = patchMessageById(prev, assistantMsg.id, buildCompletedPatch(now()));
          syncMainStreamToRuntime({ conversationId: resolvedConversationId, assistantId: assistantMsg.id, serverMessageId: state.serverMessageId, generationTaskId: state.generationTaskId, messages: next, active: false });
          return next;
        });
      }
    }

    return buildStreamRunResult();
  };
}

export type UseChatMainStreamRuntimeOptions = {
  selectedModel: ChatModel;
  conversationTitle: string;
  currentConversation: number | undefined;
  abortReasonRef: MutableRefObject<AbortReason>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  startTaskEventStream: StartTaskEventStream;
  startBackgroundPolling: StartBackgroundPolling;
  translate: (key: string) => string;
};

export function useChatMainStreamRuntime({
  selectedModel,
  conversationTitle,
  currentConversation,
  abortReasonRef,
  setMessages,
  startTaskEventStream,
  startBackgroundPolling,
  translate,
}: UseChatMainStreamRuntimeOptions) {
  const streamResponse = useCallback(
    createStreamResponseAction({
      selectedModelName: selectedModel.name,
      conversationTitle,
      getCurrentConversation: () => currentConversation,
      abortReasonRef,
      setMessages,
      startTaskEventStream,
      startBackgroundPolling,
      translate,
    }),
    [
      selectedModel.name,
      conversationTitle,
      currentConversation,
      abortReasonRef,
      setMessages,
      startTaskEventStream,
      startBackgroundPolling,
      translate,
    ]
  );

  return { streamResponse };
}
