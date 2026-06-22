import {
  buildChatStreamRunResult,
  ChatStreamGroupContext,
  ChatStreamRunResult,
  shouldCompleteUnrecoverablePartial,
  shouldMarkCompleted,
  shouldRecoverStream,
  shouldReconcileAfterDone,
} from "./chatStreamRunResult";

export type ChatAbortReason = "user" | "navigation" | null | undefined;

export type ChatFinalReconciliationState = {
  groupContext?: ChatStreamGroupContext;
  serverMessageId?: number;
  generationTaskId?: number;
  lastSequence: number;
  accumulated: string;
  useBackground: boolean;
  sawDone: boolean;
  recoverable?: boolean;
};

export type ChatFinalReconciliationInput = {
  state: ChatFinalReconciliationState;
  abortReason?: ChatAbortReason;
  streamContent?: string;
  hasRealtimeData: boolean;
};

export type ChatFinalReconciliationAction =
  | {
      type: "recover";
      shouldSyncFinalData: boolean;
      finalContent: string;
      result: ChatStreamRunResult;
      serverMessageId?: number;
      generationTaskId?: number;
      lastSequence: number;
      shouldStartBackgroundPolling: boolean;
    }
  | {
      type: "reconcile_after_done";
      shouldSyncFinalData: boolean;
      finalContent: string;
      result: ChatStreamRunResult;
      serverMessageId?: number;
      shouldStartBackgroundPolling: boolean;
    }
  | {
      type: "complete_or_cleanup";
      shouldSyncFinalData: boolean;
      finalContent: string;
      result: ChatStreamRunResult;
      shouldClearStores: boolean;
      shouldMarkCompleted: boolean;
    };

export function resolveFinalStreamContent({
  streamContent,
  accumulated,
}: {
  streamContent?: string;
  accumulated: string;
}): string {
  return streamContent || accumulated;
}

export function shouldSyncFinalRealtimeData({
  finalContent,
  hasRealtimeData,
}: {
  finalContent: string;
  hasRealtimeData: boolean;
}): boolean {
  return Boolean(finalContent || hasRealtimeData);
}

export function buildFinalStreamRunResult({
  state,
  finalContent,
}: {
  state: ChatFinalReconciliationState;
  finalContent?: string;
}): ChatStreamRunResult {
  return buildChatStreamRunResult({
    groupContext: state.groupContext,
    serverMessageId: state.serverMessageId,
    generationTaskId: state.generationTaskId,
    lastSequence: state.lastSequence,
    content: finalContent,
    fallbackContent: state.accumulated,
    useBackground: state.useBackground,
    sawDone: state.sawDone,
    recoverable: state.recoverable,
  });
}

export function decideFinalStreamReconciliation({
  state,
  abortReason,
  streamContent,
  hasRealtimeData,
}: ChatFinalReconciliationInput): ChatFinalReconciliationAction {
  const finalContent = resolveFinalStreamContent({ streamContent, accumulated: state.accumulated });
  const shouldSyncFinalData = shouldSyncFinalRealtimeData({ finalContent, hasRealtimeData });
  const hasContent = finalContent.trim().length > 0;

  if (shouldRecoverStream({
    sawDone: state.sawDone,
    abortReason,
    serverMessageId: state.serverMessageId,
    generationTaskId: state.generationTaskId,
  })) {
    return {
      type: "recover",
      shouldSyncFinalData,
      finalContent,
      result: buildFinalStreamRunResult({ state, finalContent }),
      serverMessageId: state.serverMessageId,
      generationTaskId: state.generationTaskId,
      lastSequence: state.lastSequence,
      shouldStartBackgroundPolling: Boolean(state.useBackground && state.serverMessageId),
    };
  }

  if (shouldCompleteUnrecoverablePartial({
    sawDone: state.sawDone,
    abortReason,
    hasContent,
    serverMessageId: state.serverMessageId,
    generationTaskId: state.generationTaskId,
  })) {
    return {
      type: "complete_or_cleanup",
      shouldSyncFinalData,
      finalContent,
      result: buildFinalStreamRunResult({ state, finalContent }),
      shouldClearStores: true,
      shouldMarkCompleted: true,
    };
  }

  if (shouldReconcileAfterDone({
    sawDone: state.sawDone,
    abortReason,
    serverMessageId: state.serverMessageId,
    generationTaskId: state.generationTaskId,
    useBackground: state.useBackground,
  })) {
    return {
      type: "reconcile_after_done",
      shouldSyncFinalData,
      finalContent,
      result: buildFinalStreamRunResult({ state, finalContent }),
      serverMessageId: state.serverMessageId,
      shouldStartBackgroundPolling: Boolean(state.serverMessageId),
    };
  }

  const hasFinalContent = finalContent.trim().length > 0;
  return {
    type: "complete_or_cleanup",
    shouldSyncFinalData,
    finalContent,
    result: buildFinalStreamRunResult({ state, finalContent }),
    shouldClearStores: true,
    shouldMarkCompleted: shouldMarkCompleted({ sawDone: state.sawDone, hasFinalContent, abortReason }),
  };
}
