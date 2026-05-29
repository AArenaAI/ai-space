import { buildFinalizingPatch, type ChatActivityStatus, type ChatCompletionPatch } from "./chatCompletionFinalizer";

export function hasTaskStreamFinalContent({
  accumulated,
  streamContent,
  realtimeContent,
}: {
  accumulated?: string;
  streamContent?: string;
  realtimeContent?: string;
}) {
  return (accumulated || streamContent || realtimeContent || "").trim().length > 0;
}

export type TaskStreamDoneDecision = {
  hasContent: boolean;
  patch: ChatCompletionPatch;
  shouldStartBackgroundPolling: boolean;
};

export function buildTaskStreamDoneDecision({
  accumulated,
  streamContent,
  realtimeContent,
  serverMessageId,
  createFinalizingStatus,
}: {
  accumulated?: string;
  streamContent?: string;
  realtimeContent?: string;
  serverMessageId?: number;
  createFinalizingStatus: (hasContent: boolean) => ChatActivityStatus;
}): TaskStreamDoneDecision {
  const hasContent = hasTaskStreamFinalContent({ accumulated, streamContent, realtimeContent });
  return {
    hasContent,
    patch: buildFinalizingPatch({ hasContent, createFinalizingStatus }),
    shouldStartBackgroundPolling: Boolean(hasContent && serverMessageId),
  };
}

export function shouldSyncTaskStreamFinalMessage({
  hasFinalData,
  accumulated,
}: {
  hasFinalData: boolean;
  accumulated?: string;
}) {
  return hasFinalData || Boolean(accumulated);
}

export function shouldStartTaskStreamFallbackPolling({
  serverMessageId,
}: {
  serverMessageId?: number;
}) {
  return Boolean(serverMessageId);
}
