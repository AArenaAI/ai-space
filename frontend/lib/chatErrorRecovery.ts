export type ChatAbortReason = "user" | "navigation" | string | null | undefined;

export function isBackgroundGenerationModel(model?: string): boolean {
  return !!model && (model === "gpt-5.5-pro" || model.startsWith("gpt-5.5-pro-"));
}

export function hasRecoverableStreamState({
  serverMessageId,
  generationTaskId,
  hasTaskStream,
  hasBackgroundPoller,
}: {
  serverMessageId?: number;
  generationTaskId?: number;
  hasTaskStream?: boolean;
  hasBackgroundPoller?: boolean;
}): boolean {
  return !!serverMessageId || !!generationTaskId || !!hasTaskStream || !!hasBackgroundPoller;
}

export function shouldRecoverCompareRun({
  serverMessageId,
  generationTaskId,
  hasTaskStream,
  hasBackgroundPoller,
  model,
  conversationId,
}: {
  serverMessageId?: number;
  generationTaskId?: number;
  hasTaskStream?: boolean;
  hasBackgroundPoller?: boolean;
  model?: string;
  conversationId?: number | null;
}): boolean {
  if (hasRecoverableStreamState({ serverMessageId, generationTaskId, hasTaskStream, hasBackgroundPoller })) {
    return true;
  }
  return isBackgroundGenerationModel(model) && !!conversationId;
}

export function shouldIgnoreStreamAbort({
  isAbort,
  abortReason,
}: {
  isAbort: boolean;
  abortReason: ChatAbortReason;
}): boolean {
  return isAbort && (abortReason === "navigation" || abortReason === "user");
}

export function shouldResumeTaskStreamAfterError({
  isAbort,
  abortReason,
  serverMessageId,
  generationTaskId,
}: {
  isAbort: boolean;
  abortReason: ChatAbortReason;
  serverMessageId?: number;
  generationTaskId?: number;
}): boolean {
  if (isAbort && abortReason === "user") return false;
  return !!serverMessageId || !!generationTaskId;
}

export function resolveRecoveryIds({
  streamServerMessageId,
  realtimeServerMessageId,
  streamGenerationTaskId,
  realtimeGenerationTaskId,
}: {
  streamServerMessageId?: number;
  realtimeServerMessageId?: number;
  streamGenerationTaskId?: number;
  realtimeGenerationTaskId?: number;
}): { serverMessageId?: number; generationTaskId?: number } {
  return {
    serverMessageId: streamServerMessageId || realtimeServerMessageId,
    generationTaskId: streamGenerationTaskId || realtimeGenerationTaskId,
  };
}
