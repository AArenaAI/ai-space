export type ChatStreamGroupContext = {
  groupId?: number;
  userMessageId?: number;
  groupModels: string[];
};

export type ChatStreamRunResult = {
  groupContext?: ChatStreamGroupContext;
  serverMessageId?: number;
  generationTaskId?: number;
  lastSequence: number;
  content: string;
  useBackground: boolean;
  sawDone: boolean;
  recoverable?: boolean;
};

export type BuildChatStreamRunResultOptions = {
  groupContext?: ChatStreamGroupContext;
  serverMessageId?: number;
  generationTaskId?: number;
  lastSequence?: number;
  content?: string;
  fallbackContent?: string;
  useBackground?: boolean;
  sawDone?: boolean;
  recoverable?: boolean;
};

export function buildChatStreamRunResult({
  groupContext,
  serverMessageId,
  generationTaskId,
  lastSequence = 0,
  content,
  fallbackContent = "",
  useBackground = false,
  sawDone = false,
  recoverable,
}: BuildChatStreamRunResultOptions): ChatStreamRunResult {
  return {
    groupContext,
    serverMessageId,
    generationTaskId,
    lastSequence,
    content: content ?? fallbackContent,
    useBackground,
    sawDone,
    recoverable,
  };
}

export type ShouldRecoverStreamOptions = {
  sawDone: boolean;
  abortReason?: "user" | "navigation" | null;
  serverMessageId?: number;
  generationTaskId?: number;
};

export type ShouldReconcileAfterDoneOptions = ShouldRecoverStreamOptions & {
  useBackground?: boolean;
};

export function shouldRecoverStream({ sawDone, abortReason, serverMessageId, generationTaskId }: ShouldRecoverStreamOptions): boolean {
  // If we already saw [DONE], no recovery needed.
  // If the user explicitly aborted, no recovery.
  // Otherwise, if we have a serverMessageId or generationTaskId, try to recover
  // the missing content (e.g. stream was cut before [DONE]).
  return !sawDone && abortReason !== "user" && (!!serverMessageId || !!generationTaskId);
}

export type ShouldCompleteUnrecoverablePartialOptions = ShouldRecoverStreamOptions & {
  hasContent: boolean;
};

/**
 * Fallback for proxy-cut streams that cannot be recovered through task/message ids.
 * If a stream ends before [DONE] and there is a recovery id, prefer recovery so we
 * can fetch missing tail content. Only mark completed immediately when there is
 * already visible content but no recovery channel; otherwise the UI can spin forever.
 */
export function shouldCompleteUnrecoverablePartial({
  sawDone,
  abortReason,
  hasContent,
  serverMessageId,
  generationTaskId,
}: ShouldCompleteUnrecoverablePartialOptions): boolean {
  return !sawDone
    && abortReason !== "user"
    && abortReason !== "navigation"
    && hasContent
    && !serverMessageId
    && !generationTaskId;
}

export function shouldReconcileAfterDone({ sawDone, abortReason, serverMessageId, generationTaskId, useBackground }: ShouldReconcileAfterDoneOptions): boolean {
  return Boolean(useBackground && sawDone && abortReason !== "navigation" && abortReason !== "user" && (!!serverMessageId || !!generationTaskId));
}

export type ShouldMarkCompletedOptions = {
  sawDone: boolean;
  hasFinalContent: boolean;
  abortReason?: "user" | "navigation" | null;
};

export function shouldMarkCompleted({ sawDone, hasFinalContent, abortReason }: ShouldMarkCompletedOptions): boolean {
  return sawDone && hasFinalContent && abortReason !== "navigation" && abortReason !== "user";
}
