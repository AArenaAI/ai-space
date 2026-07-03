import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { getGuestId as defaultGetGuestId } from "@/lib/guestId";
import { realtimeAppend as defaultRealtimeAppend, realtimeGet as defaultRealtimeGet, realtimeUpdate as defaultRealtimeUpdate, realtimeMarkCompleted as defaultRealtimeMarkCompleted } from "@/lib/streaming";
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
import { getConversationSnapshot, patchConversationSnapshot } from "@/lib/chatConversationCache";
import { readAuthState } from "@/lib/auth/state";

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

function patchSnapshotTaskMessage(convId: number | undefined, localMessageId: string, patch: Partial<Message>) {
  if (!convId) return;
  const snapshot = getConversationSnapshot(convId);
  if (!snapshot) return;
  patchConversationSnapshot(convId, {
    messages: snapshot.messages.map((message) =>
      message.id === localMessageId || String(message.serverMessageId || "") === String(patch.serverMessageId || "")
        ? { ...message, ...patch }
        : message
    ),
    updatedAt: Date.now(),
  });
}

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
  appliedTaskSequencesRef?: MutableRefObject<Record<string, Set<number>>>;
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
  realtimeMarkCompleted?: typeof defaultRealtimeMarkCompleted;
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
  appliedTaskSequencesRef = { current: {} },
  setMessages,
  setIsLoading,
  startBackgroundPolling,
  translate,
  getToken = () => readAuthState().token,
  getGuestId = defaultGetGuestId,
  createAbortController = () => new AbortController(),
  createTaskStreamEventHandler = defaultCreateTaskStreamEventHandler,
  runTaskEventStream = defaultRunTaskEventStream,
  realtimeAppend = defaultRealtimeAppend,
  realtimeGet = defaultRealtimeGet,
  realtimeUpdate = defaultRealtimeUpdate,
  realtimeMarkCompleted = defaultRealtimeMarkCompleted,
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
    const existingStreamEntry = Object.entries(activeTaskStreamsRef.current).find(([id, state]) =>
      id !== localMessageId && Boolean(
        (generationTaskId && state.generationTaskId === generationTaskId) ||
        (serverMessageId && state.serverMessageId === serverMessageId)
      )
    );
    if (existingStreamEntry) {
      const [existingLocalMessageId] = existingStreamEntry;
      taskStreamsRef.current[existingLocalMessageId]?.abort();
      delete taskStreamsRef.current[existingLocalMessageId];
      delete activeTaskStreamsRef.current[existingLocalMessageId];
    }
    activeTaskStreamsRef.current[localMessageId] = { convId, serverMessageId, generationTaskId, lastSequence: after || 0, content: initialContent || "" };
    setIsLoading(true);

    const sequenceKey = `${generationTaskId || serverMessageId || localMessageId}`;
    if (!appliedTaskSequencesRef.current[sequenceKey]) {
      appliedTaskSequencesRef.current[sequenceKey] = new Set<number>();
    }

    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      headers["X-Guest-ID"] = getGuestId();
    }

    const controller = createAbortController();
    taskStreamsRef.current[localMessageId] = controller;
    if (initialContent && !realtimeGet(localMessageId)?.content) {
      realtimeUpdate(localMessageId, {
        content: initialContent,
        serverMessageId,
        generationTaskId,
        lastSequence: after || 0,
      });
    }

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
        shouldApplySequence: (sequence: number) => {
          const applied = appliedTaskSequencesRef.current[sequenceKey] || (appliedTaskSequencesRef.current[sequenceKey] = new Set<number>());
          if (applied.has(sequence)) return false;
          applied.add(sequence);
          return true;
        },
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
        if (controller.signal.aborted) {
          delete taskStreamsRef.current[localMessageId];
          return;
        }
        const accumulated = taskEventHandler.getAccumulated();
        const latestSequence = taskEventHandler.getLatestSequence();
        const finalData = realtimeGet(localMessageId);
        if (shouldSyncTaskStreamFinalMessage({ hasFinalData: Boolean(finalData), accumulated })) {
          if (serverMessageId) {
            setMessages((prev) => patchMessageById(prev, localMessageId, (m) => ({
              serverMessageId,
              generationTaskId,
              lastSequence: Math.max(m.lastSequence || 0, latestSequence),
            })));
          } else {
            setMessages((prev) => patchMessageById(prev, localMessageId, (m) =>
              applyFinalRealtimeDataToMessage(m, {
                finalContent: accumulated,
                finalData,
                latestSequence,
                forceContentFallback: true,
              })
            ));
          }
          patchSnapshotTaskMessage(convId, localMessageId, {
            ...(serverMessageId ? {} : { content: accumulated }),
            serverMessageId,
            lastSequence: latestSequence,
            generationTaskId,
          });
        }
        if (!serverMessageId) {
          realtimeMarkCompleted(localMessageId);
          const completedRealtimeData = realtimeGet(localMessageId);
          if (completedRealtimeData?.statusTimeline?.length) {
            setMessages((prev) => patchMessageById(prev, localMessageId, (m) =>
              applyFinalRealtimeDataToMessage(m, {
                finalContent: accumulated,
                finalData: completedRealtimeData,
                latestSequence,
                forceContentFallback: true,
              })
            ));
          }
        }
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
  const appliedTaskSequencesRef = useRef<Record<string, Set<number>>>({});

  const startTaskEventStream = useCallback(
    createStartTaskEventStreamAction({
      apiBaseUrl,
      taskStreamsRef,
      activeTaskStreamsRef,
      appliedTaskSequencesRef,
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
