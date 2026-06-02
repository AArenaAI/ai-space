import { applyChatStreamDelta, type ChatStreamAppend } from "./chatDeltaApplier";
import { type ChatCompletionPatch } from "./chatCompletionFinalizer";
import { type ReasoningStreamState } from "./chatStreamDelta";
import { processChatStreamEvent } from "./chatStreamEventProcessor";
import {
  buildDeltaAccumulatedIntent,
  buildStreamErrorIntent,
  buildStreamSearchIntent,
  buildTextAppendIntent,
} from "./chatStreamActionHandler";
import {
  buildActiveTaskStreamState,
  buildGenerationTaskEventPatches,
  buildTaskActivityPatch,
  buildTaskDeltaState,
  type ActiveTaskStreamState,
} from "./chatTaskEventDecision";
import { normalizeGenerationTaskInfo } from "./chatTaskInfo";
import { buildTaskStreamDoneDecision } from "./chatTaskStreamFinalizer";
import {
  createActivityStatusFromMeta,
  createFinalizingStatus,
  createGeneratingStatus,
  createWebSearchDoneStatus,
} from "./chatActivityStatus";

type Translate = (key: string) => string;

type RealtimeDataLike = {
  content?: string;
  requestId?: string;
};

export type TaskStreamEventHandlerCallbacks = {
  getActiveState: () => ActiveTaskStreamState | undefined;
  setActiveState: (state: ActiveTaskStreamState) => void;
  deleteActiveState: () => void;
  streamAppend: ChatStreamAppend;
  streamGet: () => string | undefined;
  realtimeGet: () => RealtimeDataLike | undefined;
  realtimeUpdate: (patch: ChatCompletionPatch & Record<string, any>) => void;
  startBackgroundPolling: (serverMessageId?: number) => void;
};

export type CreateTaskStreamEventHandlerOptions = {
  convId?: number;
  localMessageId: string;
  serverMessageId?: number;
  generationTaskId?: number;
  after?: number;
  initialContent?: string;
  t: Translate;
  callbacks: TaskStreamEventHandlerCallbacks;
};

export type TaskStreamEventHandler = {
  processEvent: (eventText: string) => void;
  getAccumulated: () => string;
  getLatestSequence: () => number;
  hasSeenDone: () => boolean;
};

export function createTaskStreamEventHandler({
  convId,
  localMessageId,
  serverMessageId,
  generationTaskId,
  after = 0,
  initialContent = "",
  t,
  callbacks,
}: CreateTaskStreamEventHandlerOptions): TaskStreamEventHandler {
  let accumulated = initialContent || "";
  const lastThinkOpen = accumulated.lastIndexOf("<think>");
  const lastThinkClose = accumulated.lastIndexOf("</think>");
  const reasoningState: ReasoningStreamState = {
    inReasoningBlock: lastThinkOpen !== -1 && lastThinkOpen > lastThinkClose,
  };
  let sawDone = false;
  let latestSequence = after || 0;
  const seenSequences = new Set<number>();

  const refreshActiveSequence = () => {
    callbacks.setActiveState(buildActiveTaskStreamState({
      existing: callbacks.getActiveState(),
      convId,
      serverMessageId,
      generationTaskId,
      lastSequence: latestSequence,
      content: accumulated,
    }));
  };

  const processEvent = (eventText: string) => {
    const action = processChatStreamEvent({ eventText, previousSequence: latestSequence });
    if (action.type === "empty") {
      if (action.sequence !== undefined && action.sequence > latestSequence) {
        latestSequence = action.sequence;
        refreshActiveSequence();
      }
      return;
    }
    if (action.sequence !== undefined) {
      if (action.hasExplicitSequence) {
        if (action.sequence <= after || seenSequences.has(action.sequence)) return;
        seenSequences.add(action.sequence);
      }
      if (action.sequence > latestSequence) {
        latestSequence = action.sequence;
        refreshActiveSequence();
      }
    }
    if (action.type === "done") {
      if (reasoningState.inReasoningBlock) {
        accumulated += "</think>";
        callbacks.streamAppend(localMessageId, { reasoning: false });
        reasoningState.inReasoningBlock = false;
      }
      if (reasoningState.pendingAnswerContent) {
        const answerDelta = reasoningState.pendingAnswerContent;
        reasoningState.pendingAnswerContent = "";
        accumulated += answerDelta;
        callbacks.streamAppend(localMessageId, { answerDelta, reasoning: false });
      }
      callbacks.deleteActiveState();
      sawDone = true;
      const doneDecision = buildTaskStreamDoneDecision({
        accumulated,
        streamContent: callbacks.streamGet(),
        realtimeContent: callbacks.realtimeGet()?.content,
        serverMessageId,
        createFinalizingStatus: (hasFinalContent) => createFinalizingStatus(t, hasFinalContent),
      });
      callbacks.realtimeUpdate({
        ...doneDecision.patch,
        errorCode: undefined,
        retryable: undefined,
      });
      if (doneDecision.shouldStartBackgroundPolling) {
        callbacks.startBackgroundPolling(serverMessageId);
      }
      return;
    }
    if (action.type === "text") {
      const intent = buildTextAppendIntent({ accumulated, data: action.data });
      accumulated = intent.accumulated;
      callbacks.streamAppend(localMessageId, { contentDelta: intent.data, reasoning: false });
      return;
    }
    if (action.type !== "payload") return;

    const { payload } = action;
    switch (payload.type) {
      case "generation_task": {
        const taskInfo = normalizeGenerationTaskInfo(payload.task, { generationTaskId, serverMessageId });
        const patches = buildGenerationTaskEventPatches({
          taskInfo,
          convId,
          lastSequence: latestSequence,
          content: accumulated,
          existingActiveState: callbacks.getActiveState(),
          activityStatus: createGeneratingStatus(t),
        });
        callbacks.setActiveState(patches.activeState);
        callbacks.realtimeUpdate(patches.realtimePatch);
        return;
      }
      case "error": {
        const intent = buildStreamErrorIntent({
          payload,
          accumulated,
          fallbackRequestId: callbacks.realtimeGet()?.requestId,
        });
        accumulated = intent.accumulated;
        callbacks.realtimeUpdate(intent.patch);
        return;
      }
      case "activity": {
        const meta = payload.meta;
        callbacks.realtimeUpdate(buildTaskActivityPatch({
          meta,
          activityStatus: createActivityStatusFromMeta(t, meta),
        }));
        return;
      }
      case "search": {
        callbacks.realtimeUpdate(buildStreamSearchIntent({
          meta: payload.meta,
          activityStatus: createWebSearchDoneStatus(t),
        }).patch);
        return;
      }
      case "delta": {
        const { legacyDelta, hasContentDelta } = applyChatStreamDelta({
          messageId: localMessageId,
          rawDelta: payload.rawDelta,
          reasoningState,
          append: callbacks.streamAppend,
        });
        if (hasContentDelta) {
          callbacks.realtimeUpdate({
            activityStatus: createGeneratingStatus(t),
            errorCode: undefined,
            retryable: undefined,
          });
        }
        const deltaState = buildTaskDeltaState({
          legacyDelta,
          accumulated,
          existingActiveState: callbacks.getActiveState(),
          convId,
          serverMessageId,
          generationTaskId,
          lastSequence: latestSequence,
        });
        accumulated = buildDeltaAccumulatedIntent({ accumulated, legacyDelta }).accumulated;
        if (deltaState.activeState) {
          callbacks.setActiveState(deltaState.activeState);
        }
        return;
      }
      default:
        return;
    }
  };

  return {
    processEvent,
    getAccumulated: () => accumulated,
    getLatestSequence: () => latestSequence,
    hasSeenDone: () => sawDone,
  };
}
