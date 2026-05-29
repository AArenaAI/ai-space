import { applyChatStreamDelta, type ChatStreamAppend } from "./chatDeltaApplier";
import type { ChatCompletionPatch } from "./chatCompletionFinalizer";
import type { ReasoningStreamState } from "./chatStreamDelta";
import { processChatStreamEvent } from "./chatStreamEventProcessor";
import {
  buildDeltaAccumulatedIntent,
  buildStreamErrorIntent,
  buildStreamSearchIntent,
  buildTextAppendIntent,
} from "./chatStreamActionHandler";
import {
  buildChatActivityPatch,
  buildChatBackgroundTaskPatch,
  buildChatDonePatch,
  buildChatGenerationTaskPatch,
  type ChatStreamGroupMetaState,
} from "./chatStreamEventDecision";
import { normalizeBackgroundTaskInfo, normalizeGenerationTaskInfo } from "./chatTaskInfo";
import { buildChatBackgroundTaskRegistration, type ChatBackgroundTaskRegistration } from "./chatBackgroundTaskRegistration";
import type { ChatStreamGroupContext } from "./chatStreamRunResult";
import {
  createActivityStatusFromMeta,
  createBusyGeneratingStatus,
  createGeneratingStatus,
  createWebSearchDoneStatus,
} from "./chatActivityStatus";

export type MainStreamGroupContext = ChatStreamGroupContext;

type Translate = (key: string) => string;

type RealtimeDataLike = {
  content?: string;
  requestId?: string;
};

export type MainStreamEventHandlerCallbacks = {
  streamAppend: ChatStreamAppend;
  streamGet: () => string | undefined;
  realtimeGet: () => RealtimeDataLike | undefined;
  realtimeUpdate: (patch: ChatCompletionPatch & Record<string, any>) => void;
  registerBackgroundTask: (task: ChatBackgroundTaskRegistration) => void;
  onGroupContext?: (context: MainStreamGroupContext) => void;
};

export type CreateMainStreamEventHandlerOptions = {
  assistantMessageId: string;
  assistantModelName?: string;
  selectedModelName?: string;
  conversationId?: number;
  conversationTitle?: string;
  initialGroupMeta?: ChatStreamGroupMetaState;
  t: Translate;
  callbacks: MainStreamEventHandlerCallbacks;
};

export type MainStreamRunState = {
  accumulated: string;
  serverMessageId?: number;
  generationTaskId?: number;
  lastSequence: number;
  groupContext?: MainStreamGroupContext;
  useBackground: boolean;
  sawDone: boolean;
  recoverable: boolean;
};

export type MainStreamEventHandler = {
  processEvent: (eventText: string) => void;
  getState: () => MainStreamRunState;
  setRecoverable: (recoverable: boolean) => void;
  closeOpenReasoning: () => void;
};

export function createMainStreamEventHandler({
  assistantMessageId,
  assistantModelName,
  selectedModelName,
  conversationId,
  conversationTitle,
  initialGroupMeta = {},
  t,
  callbacks,
}: CreateMainStreamEventHandlerOptions): MainStreamEventHandler {
  let accumulated = "";
  const reasoningState: ReasoningStreamState = { inReasoningBlock: false };
  let backgroundPollingStarted = false;
  let latestServerMessageId: number | undefined;
  let latestGroupId: number | undefined = initialGroupMeta.groupId;
  let latestGroupIndex: number | undefined = initialGroupMeta.groupIndex;
  let latestGroupModels: string[] | undefined = initialGroupMeta.groupModels;
  let latestUserMessageId: number | undefined = initialGroupMeta.userMessageId;
  let groupContextNotified = false;
  let latestGenerationTaskId: number | undefined;
  let latestUseBackground = false;
  let sawDone = false;
  let recoverable = false;
  let latestSequence = 0;

  const currentGroupContext = (): MainStreamGroupContext | undefined =>
    latestGroupId || latestUserMessageId
      ? {
          groupId: latestGroupId,
          userMessageId: latestUserMessageId,
          groupModels: latestGroupModels || [],
        }
      : undefined;

  const notifyGroupContext = () => {
    const context = currentGroupContext();
    if (groupContextNotified || !context?.groupId || !context.userMessageId) return;
    groupContextNotified = true;
    callbacks.onGroupContext?.(context);
  };

  const closeOpenReasoning = () => {
    if (!reasoningState.inReasoningBlock) return;
    accumulated += "</think>";
    callbacks.streamAppend(assistantMessageId, { reasoning: false });
    reasoningState.inReasoningBlock = false;
  };

  const applyGenerationMeta = (meta: {
    serverMessageId?: number;
    groupId?: number;
    groupIndex?: number;
    userMessageId?: number;
    groupModels?: string[];
    generationTaskId?: number;
    useBackground: boolean;
  }) => {
    latestUseBackground = meta.useBackground;
    latestServerMessageId = meta.serverMessageId;
    latestGroupId = meta.groupId;
    latestGroupIndex = meta.groupIndex;
    latestUserMessageId = meta.userMessageId;
    latestGroupModels = meta.groupModels;
    latestGenerationTaskId = meta.generationTaskId;
  };

  const registerBackgroundTaskIfNeeded = (shouldRegister: boolean) => {
    if (!shouldRegister || !latestServerMessageId) return;
    callbacks.registerBackgroundTask(buildChatBackgroundTaskRegistration({
      serverMessageId: latestServerMessageId,
      conversationId,
      conversationTitle,
      modelName: assistantModelName || selectedModelName,
    }));
  };

  const processEvent = (eventText: string) => {
    const action = processChatStreamEvent({ eventText, previousSequence: latestSequence });
    if (action.sequence !== undefined) latestSequence = action.sequence;
    if (action.type === "empty") return;
    if (action.type === "done") {
      closeOpenReasoning();
      sawDone = true;
      const { patch } = buildChatDonePatch({
        accumulated,
        streamContent: callbacks.streamGet(),
        realtimeContent: callbacks.realtimeGet()?.content,
        busyStatus: createBusyGeneratingStatus(t),
      });
      callbacks.realtimeUpdate(patch);
      return;
    }
    if (action.type === "text") {
      const intent = buildTextAppendIntent({ accumulated, data: action.data });
      accumulated = intent.accumulated;
      callbacks.streamAppend(assistantMessageId, intent.data);
      return;
    }
    if (action.type !== "payload") return;

    const { payload } = action;
    switch (payload.type) {
      case "chat_meta": {
        callbacks.realtimeUpdate({ requestId: payload.requestId });
        return;
      }
      case "generation_task": {
        const taskInfo = normalizeGenerationTaskInfo(payload.task);
        const taskDecision = buildChatGenerationTaskPatch({
          taskInfo,
          existingMeta: currentGroupContext() || {},
          lastSequence: latestSequence,
          activityStatus: createGeneratingStatus(t),
        });
        applyGenerationMeta(taskDecision.meta);
        callbacks.realtimeUpdate(taskDecision.patch);
        notifyGroupContext();
        if (taskDecision.shouldMarkBackgroundPollingStarted) {
          backgroundPollingStarted = true;
        }
        registerBackgroundTaskIfNeeded(taskDecision.shouldRegisterBackgroundTask);
        return;
      }
      case "background_task": {
        const taskInfo = normalizeBackgroundTaskInfo(payload.task);
        const taskDecision = buildChatBackgroundTaskPatch({
          taskInfo,
          existingMeta: currentGroupContext() || {},
          activityStatus: createBusyGeneratingStatus(t),
        });
        latestServerMessageId = taskDecision.meta.serverMessageId;
        latestGroupId = taskDecision.meta.groupId;
        latestGroupIndex = taskDecision.meta.groupIndex;
        latestUserMessageId = taskDecision.meta.userMessageId;
        latestGroupModels = taskDecision.meta.groupModels;
        latestUseBackground = taskDecision.meta.useBackground;
        callbacks.realtimeUpdate(taskDecision.patch);
        notifyGroupContext();
        backgroundPollingStarted = true;
        registerBackgroundTaskIfNeeded(taskDecision.shouldRegisterBackgroundTask);
        return;
      }
      case "error": {
        const intent = buildStreamErrorIntent({
          payload,
          accumulated,
          fallbackRequestId: callbacks.realtimeGet()?.requestId,
          includeContentInPatch: true,
        });
        accumulated = intent.accumulated;
        callbacks.realtimeUpdate(intent.patch);
        return;
      }
      case "activity": {
        const meta = payload.meta;
        callbacks.realtimeUpdate(buildChatActivityPatch({
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
          messageId: assistantMessageId,
          rawDelta: payload.rawDelta,
          reasoningState,
          append: callbacks.streamAppend,
        });
        if (hasContentDelta) {
          callbacks.realtimeUpdate({ activityStatus: createGeneratingStatus(t) });
        }
        accumulated = buildDeltaAccumulatedIntent({ accumulated, legacyDelta }).accumulated;
        return;
      }
      default:
        return;
    }
  };

  return {
    processEvent,
    getState: () => ({
      accumulated,
      serverMessageId: latestServerMessageId,
      generationTaskId: latestGenerationTaskId,
      lastSequence: latestSequence,
      groupContext: currentGroupContext(),
      useBackground: latestUseBackground,
      sawDone,
      recoverable,
    }),
    setRecoverable: (value) => {
      recoverable = value;
    },
    closeOpenReasoning,
  };
}
