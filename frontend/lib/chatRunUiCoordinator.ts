import { buildDisplayErrorPatch, buildRecoverableBusyPatch, buildStoppedPatch } from "./chatCompletionFinalizer";
import { isBackgroundGenerationModel, resolveRecoveryIds, shouldRecoverCompareRun } from "./chatErrorRecovery";
import { ChatStreamRunResult } from "./chatStreamRunResult";

export type AbortReason = "user" | "navigation" | null;

export type ChatRunUiPatch = Record<string, any>;

export type SingleSendErrorDecision =
  | { type: "none" }
  | { type: "stopped"; patch: ChatRunUiPatch }
  | { type: "recoverable_busy"; patch: ChatRunUiPatch }
  | { type: "display_error"; patch: ChatRunUiPatch };

export function decideSingleSendError(input: {
  error: any;
  abortReason: AbortReason;
  modelId: string;
  conversationId?: number;
  busyActivityStatus: any;
}): SingleSendErrorDecision {
  if (input.error?.name === "AbortError") {
    if (input.abortReason === "user") {
      return { type: "stopped", patch: buildStoppedPatch() };
    }
    return { type: "none" };
  }

  if (isBackgroundGenerationModel(input.modelId) && input.conversationId) {
    return {
      type: "recoverable_busy",
      patch: buildRecoverableBusyPatch({ activityStatus: input.busyActivityStatus }),
    };
  }

  return {
    type: "display_error",
    patch: buildDisplayErrorPatch({
      errorCode: input.error?.errorCode,
      message: input.error?.errorCode === "guest_limit_exceeded"
        ? "匿名用户每日次数用完，请登录后继续"
        : input.error?.errorCode === "not_activated"
        ? "账号未激活：请使用邀请码激活或提交内测申请。"
        : input.error?.message,
    }),
  };
}

export function buildRecoverableResultPatch(input: {
  serverMessageId?: number;
  generationTaskId?: number;
  existingServerMessageId?: number;
  existingGenerationTaskId?: number;
  busyActivityStatus: any;
}): ChatRunUiPatch {
  return buildRecoverableBusyPatch({
    serverMessageId: input.serverMessageId || input.existingServerMessageId,
    generationTaskId: input.generationTaskId || input.existingGenerationTaskId,
    activityStatus: input.busyActivityStatus,
  });
}

export function buildUserAbortStoppedPatch(now?: number): ChatRunUiPatch {
  return buildStoppedPatch(now);
}

export type RunFinallyDecision = {
  shouldUpdateLoading: boolean;
  isLoading?: boolean;
  shouldClearMainController: boolean;
  shouldClearAbortReason: boolean;
  shouldClearCompareControllers: boolean;
  shouldDispatchConversationUpdated: boolean;
  conversationId?: number;
};

export function decideSingleSendFinally(input: {
  abortReason: AbortReason;
  hasActiveTaskStream: boolean;
  conversationId?: number;
}): RunFinallyDecision {
  if (input.abortReason === "navigation") {
    return {
      shouldUpdateLoading: false,
      shouldClearMainController: false,
      shouldClearAbortReason: false,
      shouldClearCompareControllers: false,
      shouldDispatchConversationUpdated: false,
      conversationId: input.conversationId,
    };
  }

  return {
    shouldUpdateLoading: !input.hasActiveTaskStream,
    isLoading: false,
    shouldClearMainController: !input.hasActiveTaskStream,
    shouldClearAbortReason: !input.hasActiveTaskStream,
    shouldClearCompareControllers: false,
    shouldDispatchConversationUpdated: Boolean(input.conversationId),
    conversationId: input.conversationId,
  };
}

export type CompareRunErrorDecision =
  | {
      type: "recoverable_busy";
      patch: ChatRunUiPatch;
      shouldStartBackgroundPolling: boolean;
      serverMessageId?: number;
    }
  | { type: "display_error"; patch: ChatRunUiPatch };

export function decideCompareRunError(input: {
  assistantModel: string;
  error: any;
  streamResult?: ChatStreamRunResult;
  realtime?: { serverMessageId?: number; generationTaskId?: number } | null;
  hasTaskStream: boolean;
  hasBackgroundPoller: boolean;
  conversationId?: number;
  existingServerMessageId?: number;
  existingGenerationTaskId?: number;
  busyActivityStatus: any;
  now: number;
}): CompareRunErrorDecision {
  const { serverMessageId, generationTaskId } = resolveRecoveryIds({
    streamServerMessageId: input.streamResult?.serverMessageId,
    realtimeServerMessageId: input.realtime?.serverMessageId,
    streamGenerationTaskId: input.streamResult?.generationTaskId,
    realtimeGenerationTaskId: input.realtime?.generationTaskId,
  });

  if (shouldRecoverCompareRun({
    serverMessageId,
    generationTaskId,
    hasTaskStream: input.hasTaskStream,
    hasBackgroundPoller: input.hasBackgroundPoller,
    model: input.assistantModel,
    conversationId: input.conversationId,
  })) {
    return {
      type: "recoverable_busy",
      patch: buildRecoverableBusyPatch({
        serverMessageId: serverMessageId || input.existingServerMessageId,
        generationTaskId: generationTaskId || input.existingGenerationTaskId,
        activityStatus: input.busyActivityStatus,
      }),
      shouldStartBackgroundPolling: Boolean(serverMessageId),
      serverMessageId,
    };
  }

  return {
    type: "display_error",
    patch: buildDisplayErrorPatch({
      errorCode: input.error?.errorCode,
      message: input.error?.message,
      now: input.now,
    }),
  };
}

export function decideCompareRunFinally(input: {
  abortReason: AbortReason;
  hasActiveTaskStream: boolean;
  hasActivePoller: boolean;
  conversationId?: number;
}): RunFinallyDecision {
  if (input.abortReason === "navigation") {
    return {
      shouldUpdateLoading: false,
      shouldClearMainController: false,
      shouldClearAbortReason: false,
      shouldClearCompareControllers: false,
      shouldDispatchConversationUpdated: false,
      conversationId: input.conversationId,
    };
  }

  return {
    shouldUpdateLoading: true,
    isLoading: input.hasActiveTaskStream || input.hasActivePoller,
    shouldClearMainController: true,
    shouldClearAbortReason: true,
    shouldClearCompareControllers: true,
    shouldDispatchConversationUpdated: Boolean(input.conversationId),
    conversationId: input.conversationId,
  };
}

export function buildConversationUpdatedEventDetail(conversationId: number, nowIso: string) {
  return { id: conversationId, updated_at: nowIso };
}
