import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { getGuestId as defaultGetGuestId } from "@/lib/guestId";
import { emitTaskFinished as defaultEmitTaskFinished } from "@/lib/taskNotifications";
import { realtimeGet as defaultRealtimeGet } from "@/lib/streaming";
import { getNotificationConversationTitle } from "@/lib/chatBackgroundTaskRegistration";
import {
  buildBackgroundPollingMessagePatch,
  shouldKeepBackgroundLoading,
} from "@/lib/chatBackgroundPolling";
import {
  startBackgroundPollingRunner,
} from "@/lib/chatBackgroundPollingRunner";
import { patchMessageById } from "@/lib/chatMessageStatePatch";
import { createBusyGeneratingStatus } from "@/lib/chatActivityStatus";
import type { ChatModel, Message } from "@/lib/chatTypes";

type TaskStreamsRef = MutableRefObject<Record<string, AbortController>>;
type BackgroundPollersRef = MutableRefObject<Record<string, number>>;

type RealtimeSnapshot = { content?: string; generationStartedAt?: number; statusTimeline?: Message["statusTimeline"] } | undefined;

type StartBackgroundPollingRunner = typeof startBackgroundPollingRunner;

type EmitTaskFinished = typeof defaultEmitTaskFinished;

export type CreateStopBackgroundPollerActionInput = {
  backgroundPollersRef: BackgroundPollersRef;
  clearIntervalImpl?: (timer: number) => void;
};

export type CreateStartBackgroundPollingActionInput = {
  apiBaseUrl: string;
  backgroundPollersRef: BackgroundPollersRef;
  taskStreamsRef: TaskStreamsRef;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  getConversationTitle: () => string;
  getSelectedModel: () => ChatModel;
  stopBackgroundPoller: (localMessageId: string) => void;
  stopTaskStream: (localMessageId: string) => void;
  getToken?: () => string | null;
  getGuestId?: () => string;
  realtimeGet?: (messageId: string) => RealtimeSnapshot;
  emitTaskFinished?: EmitTaskFinished;
  runner?: StartBackgroundPollingRunner;
  now?: () => number;
  translate?: (key: string) => string;
};

export function createStopBackgroundPollerAction(input: CreateStopBackgroundPollerActionInput) {
  const clearIntervalImpl = input.clearIntervalImpl ?? ((timer: number) => window.clearInterval(timer));
  return (localMessageId: string) => {
    const timer = input.backgroundPollersRef.current[localMessageId];
    if (timer) {
      clearIntervalImpl(timer);
      delete input.backgroundPollersRef.current[localMessageId];
    }
  };
}

export function createStartBackgroundPollingAction(input: CreateStartBackgroundPollingActionInput) {
  const getToken = input.getToken ?? (() => localStorage.getItem("token"));
  const getGuestId = input.getGuestId ?? defaultGetGuestId;
  const realtimeGet = input.realtimeGet ?? defaultRealtimeGet;
  const emitTaskFinished = input.emitTaskFinished ?? defaultEmitTaskFinished;
  const runner = input.runner ?? startBackgroundPollingRunner;
  const now = input.now ?? Date.now;
  const translate = input.translate ?? ((key: string) => key);

  return (convId: number | undefined, localMessageId: string, serverMessageId?: number) => {
    if (!convId || !serverMessageId || input.backgroundPollersRef.current[localMessageId]) return;

    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      headers["X-Guest-ID"] = getGuestId();
    }

    const pollingRunner = runner({
      apiBaseUrl: input.apiBaseUrl,
      conversationId: convId,
      serverMessageId,
      headers,
      callbacks: {
        onPollState: (pollState) => {
          const streamActive = !!input.taskStreamsRef.current[localMessageId];
          const realtime = realtimeGet(localMessageId);
          const liveContent = realtime?.content || "";
          const currentTime = now();
          input.setMessages((prev) => prev.map((message) => {
            const matchesLocalId = message.id === localMessageId;
            const matchesServerId = Boolean(serverMessageId && message.serverMessageId === serverMessageId);
            if (!matchesLocalId && !matchesServerId) return message;
            return {
              ...message,
              ...buildBackgroundPollingMessagePatch({
                existingContent: message.content,
                polledContent: pollState.content,
                liveContent,
                generationStartedAt: realtime?.generationStartedAt ?? message.generationStartedAt,
                statusTimeline: realtime?.statusTimeline ?? message.statusTimeline,
                streamActive,
                serverMessageId,
                isFinished: pollState.isFinished,
                status: pollState.status,
                now: currentTime,
                createBusyStatus: () => createBusyGeneratingStatus(translate),
              }),
            };
          }));
        },
        onFinished: (pollState) => {
          input.stopBackgroundPoller(localMessageId);
          input.stopTaskStream(localMessageId);
          const selectedModel = input.getSelectedModel();
          const notificationTitle = getNotificationConversationTitle(
            input.getConversationTitle(),
            selectedModel.name || selectedModel.id
          );
          emitTaskFinished({
            key: `chat:${serverMessageId}`,
            type: "chat",
            title: pollState.isCompleted ? "长对话任务已完成" : "长对话任务未完成",
            description: notificationTitle,
            href: `/chat?id=${convId}`,
            ok: pollState.isCompleted,
            conversationTitle: notificationTitle,
          });
          const hasOtherTaskStream = Object.keys(input.taskStreamsRef.current).some((id) => id !== localMessageId);
          const hasOtherPoller = Object.keys(input.backgroundPollersRef.current).some((id) => id !== localMessageId);
          input.setIsLoading(hasOtherTaskStream || hasOtherPoller);
        },
        onKeepLoading: () => {
          input.setIsLoading(true);
        },
        shouldKeepLoading: shouldKeepBackgroundLoading,
        isStreamActive: () => !!input.taskStreamsRef.current[localMessageId],
      },
    });
    input.backgroundPollersRef.current[localMessageId] = pollingRunner.timer;
  };
}

export type UseChatBackgroundPollingRuntimeInput = {
  apiBaseUrl: string;
  taskStreamsRef: TaskStreamsRef;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  conversationTitle: string;
  selectedModel: ChatModel;
  stopTaskStream: (localMessageId: string) => void;
  translate: (key: string) => string;
};

export function useChatBackgroundPollingRuntime(input: UseChatBackgroundPollingRuntimeInput) {
  const backgroundPollersRef = useRef<Record<string, number>>({});

  const stopBackgroundPoller = useCallback(
    createStopBackgroundPollerAction({ backgroundPollersRef }),
    []
  );

  const startBackgroundPolling = useCallback(
    createStartBackgroundPollingAction({
      apiBaseUrl: input.apiBaseUrl,
      backgroundPollersRef,
      taskStreamsRef: input.taskStreamsRef,
      setMessages: input.setMessages,
      setIsLoading: input.setIsLoading,
      getConversationTitle: () => input.conversationTitle,
      getSelectedModel: () => input.selectedModel,
      stopBackgroundPoller,
      stopTaskStream: input.stopTaskStream,
      translate: input.translate,
    }),
    [
      input.apiBaseUrl,
      input.taskStreamsRef,
      input.setMessages,
      input.setIsLoading,
      input.conversationTitle,
      input.selectedModel,
      input.stopTaskStream,
      input.translate,
      stopBackgroundPoller,
    ]
  );

  const stopAllBackgroundPollers = useCallback(() => {
    Object.values(backgroundPollersRef.current).forEach((timer) => window.clearInterval(timer));
    backgroundPollersRef.current = {};
  }, []);

  return {
    backgroundPollersRef,
    stopBackgroundPoller,
    startBackgroundPolling,
    stopAllBackgroundPollers,
  };
}
