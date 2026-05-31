import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { getGuestId as defaultGetGuestId } from "@/lib/guestId";
import { realtimeAppend as defaultRealtimeAppend, realtimeGet as defaultRealtimeGet, realtimeUpdate as defaultRealtimeUpdate, realtimeClear as defaultRealtimeClear } from "@/lib/streaming";
import type { RealtimeData } from "@/lib/streaming";
import {
  shouldStartTaskStreamFallbackPolling,
  shouldSyncTaskStreamFinalMessage,
} from "@/lib/chatTaskStreamFinalizer";
import { createTaskStreamEventHandler as defaultCreateTaskStreamEventHandler } from "@/lib/chatTaskStreamEventHandler";
import {
  runTaskEventStream as defaultRunTaskEventStream,
  shouldFallbackToBackgroundPollingAfterTaskStreamError,
} from "@/lib/chatTaskStreamLifecycle";
import {
  applyFinalRealtimeDataToMessage,
  patchMessageById,
} from "@/lib/chatMessageStatePatch";
import type { Message } from "@/lib/chatTypes";

export type TaskStreamActiveState = {
  convId?: number;
  serverMessageId?: number;
  generationTaskId?: number;
  lastSequence?: number;
  content?: string;
};

type TaskStreamEventHandler = {
  processEvent: (eventText: string) => void;
  getAccumulated: () => string;
  getLatestSequence: () => number;
};

type CreateTaskStreamEventHandler = typeof defaultCreateTaskStreamEventHandler;
type RunTaskEventStream = typeof defaultRunTaskEventStream;

type StartBackgroundPolling = (
  convId: number | undefined,
  localMessageId: string,
  serverMessageId?: number
) => void;

type StartTaskEventStreamDeps = {
  apiBaseUrl: string;
  taskStreamsRef: MutableRefObject<Record<string, AbortController>>;
  activeTaskStreamsRef: MutableRefObject<Record<string, TaskStreamActiveState>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  startBackgroundPolling: StartBackgroundPolling;
  translate: (key: string) => string;
  getToken?: () => string | null;
  getGuestId?: () => string;
  createAbortController?: () => AbortController;
  createTaskStreamEventHandler?: CreateTaskStreamEventHandler;
  runTaskEventStream?: RunTaskEventStream;
  realtimeAppend?: typeof defaultRealtimeAppend;
  realtimeGet?: typeof defaultRealtimeGet;
  realtimeUpdate?: typeof defaultRealtimeUpdate;
  realtimeClear?: typeof defaultRealtimeClear;
};

type StopAllTaskStreamsDeps = {
  taskStreamsRef: MutableRefObject<Record<string, AbortController>>;
  activeTaskStreamsRef: MutableRefObject<Record<string, TaskStreamActiveState>>;
};

type StopTaskStreamDeps = {
  taskStreamsRef: MutableRefObject<Record<string, AbortController>>;
};

export function createStopTaskStreamAction({ taskStreamsRef }: StopTaskStreamDeps) {
  return (localMessageId: string) => {
    const controller = taskStreamsRef.current[localMessageId];
    if (controller) {
      controller.abort();
      delete taskStreamsRef.current[localMessageId];
    }
  };
}

export function useStopTaskStreamAction(taskStreamsRef: MutableRefObject<Record<string, AbortController>>) {
  return useCallback(
    createStopTaskStreamAction({ taskStreamsRef }),
    [taskStreamsRef]
  );
}

export function createStopAllTaskStreamsAction({
  taskStreamsRef,
  activeTaskStreamsRef,
}: StopAllTaskStreamsDeps) {
  return () => {
    Object.values(taskStreamsRef.current).forEach((controller) => controller.abort());
    taskStreamsRef.current = {};
    activeTaskStreamsRef.current = {};
  };
}

export function createStartTaskEventStreamAction({
  apiBaseUrl,
  taskStreamsRef,
  activeTaskStreamsRef,
  setMessages,
  setIsLoading,
  startBackgroundPolling,
  translate,
  getToken = () => localStorage.getItem("token"),
  getGuestId = defaultGetGuestId,
  createAbortController = () => new AbortController(),
  createTaskStreamEventHandler = defaultCreateTaskStreamEventHandler,
  runTaskEventStream = defaultRunTaskEventStream,
  realtimeAppend = defaultRealtimeAppend,
  realtimeGet = defaultRealtimeGet,
  realtimeUpdate = defaultRealtimeUpdate,
  realtimeClear = defaultRealtimeClear,
}: StartTaskEventStreamDeps) {
  return (
    convId: number | undefined,
    localMessageId: string,
    serverMessageId?: number,
    after: number = 0,
    initialContent: string = "",
    generationTaskId?: number
  ) => {
    if (!convId || (!serverMessageId && !generationTaskId) || taskStreamsRef.current[localMessageId]) return;
    activeTaskStreamsRef.current[localMessageId] = { convId, serverMessageId, generationTaskId, lastSequence: after || 0, content: initialContent || "" };
    setIsLoading(true);

    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      headers["X-Guest-ID"] = getGuestId();
    }

    const controller = createAbortController();
    taskStreamsRef.current[localMessageId] = controller;

    const taskEventHandler: TaskStreamEventHandler = createTaskStreamEventHandler({
      convId,
      localMessageId,
      serverMessageId,
      generationTaskId,
      after,
      initialContent,
      t: translate,
      callbacks: {
        getActiveState: () => activeTaskStreamsRef.current[localMessageId],
        setActiveState: (state: TaskStreamActiveState) => {
          activeTaskStreamsRef.current[localMessageId] = state;
        },
        deleteActiveState: () => {
          delete activeTaskStreamsRef.current[localMessageId];
        },
        streamAppend: realtimeAppend,
        streamGet: () => realtimeGet(localMessageId)?.content || "",
        realtimeGet: () => realtimeGet(localMessageId),
        realtimeUpdate: (patch: Partial<RealtimeData>) => realtimeUpdate(localMessageId, patch),
        startBackgroundPolling: (resolvedServerMessageId: number | undefined) => {
          if (resolvedServerMessageId) {
            startBackgroundPolling(convId, localMessageId, resolvedServerMessageId);
          }
        },
      },
    });

    (async () => {
      try {
        await runTaskEventStream({
          apiBaseUrl,
          serverMessageId,
          generationTaskId,
          after,
          headers,
          signal: controller.signal,
          onEvent: taskEventHandler.processEvent,
        });
      } catch {
        if (shouldFallbackToBackgroundPollingAfterTaskStreamError(controller.signal)) {
          startBackgroundPolling(convId, localMessageId, serverMessageId);
        }
      } finally {
        const accumulated = taskEventHandler.getAccumulated();
        const latestSequence = taskEventHandler.getLatestSequence();
        const finalData = realtimeGet(localMessageId);
        if (shouldSyncTaskStreamFinalMessage({ hasFinalData: Boolean(finalData), accumulated })) {
          setMessages((prev) => patchMessageById(prev, localMessageId, (m) =>
            applyFinalRealtimeDataToMessage(m, {
              finalContent: accumulated,
              finalData,
              latestSequence,
              forceContentFallback: true,
            })
          ));
        }
        realtimeClear(localMessageId);
        delete taskStreamsRef.current[localMessageId];
        if (shouldStartTaskStreamFallbackPolling({ serverMessageId })) {
          startBackgroundPolling(convId, localMessageId, serverMessageId);
        }
      }
    })();
  };
}

export type UseChatTaskStreamRuntimeOptions = {
  apiBaseUrl: string;
  taskStreamsRef: MutableRefObject<Record<string, AbortController>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  startBackgroundPolling: StartBackgroundPolling;
  translate: (key: string) => string;
};

export function useChatTaskStreamRuntime({
  apiBaseUrl,
  taskStreamsRef,
  setMessages,
  setIsLoading,
  startBackgroundPolling,
  translate,
}: UseChatTaskStreamRuntimeOptions) {
  const activeTaskStreamsRef = useRef<Record<string, TaskStreamActiveState>>({});

  const startTaskEventStream = useCallback(
    createStartTaskEventStreamAction({
      apiBaseUrl,
      taskStreamsRef,
      activeTaskStreamsRef,
      setMessages,
      setIsLoading,
      startBackgroundPolling,
      translate,
    }),
    [apiBaseUrl, taskStreamsRef, setMessages, setIsLoading, startBackgroundPolling, translate]
  );

  const stopTaskStream = useCallback(
    createStopTaskStreamAction({ taskStreamsRef }),
    [taskStreamsRef]
  );

  const stopAllTaskStreams = useCallback(
    createStopAllTaskStreamsAction({ taskStreamsRef, activeTaskStreamsRef }),
    [taskStreamsRef]
  );

  return {
    activeTaskStreamsRef,
    startTaskEventStream,
    stopTaskStream,
    stopAllTaskStreams,
  };
}
