import type { ChatActivityStatus, ChatCompletionPatch } from "./chatCompletionFinalizer";

export type BackgroundTaskPollInput = {
  content?: string;
  status?: string;
  previousContent?: string;
  terminalStableCount?: number;
};

export type BackgroundTaskPollState = {
  content: string;
  status: string;
  hasContent: boolean;
  isCompleted: boolean;
  isHardStopped: boolean;
  isSoftTerminal: boolean;
  terminalStableCount: number;
  isFinished: boolean;
};

export function evaluateBackgroundTaskPoll({
  content = "",
  status = "",
  previousContent = "",
  terminalStableCount = 0,
}: BackgroundTaskPollInput): BackgroundTaskPollState {
  const hasContent = content.trim().length > 0;
  const isCompleted = status === "completed" && hasContent;
  const isHardStopped = status === "cancelled";
  const isSoftTerminal = status === "failed" || status === "incomplete";
  const nextTerminalStableCount = isSoftTerminal
    ? (content === previousContent ? terminalStableCount + 1 : 0)
    : 0;
  const isFinished = isCompleted || isHardStopped || (isSoftTerminal && nextTerminalStableCount >= 3);

  return {
    content,
    status,
    hasContent,
    isCompleted,
    isHardStopped,
    isSoftTerminal,
    terminalStableCount: nextTerminalStableCount,
    isFinished,
  };
}

export type ShouldApplyPolledContentOptions = {
  streamActive: boolean;
  liveContent?: string;
  dbContent?: string;
  taskStatus?: string;
};

export function shouldApplyPolledContent({
  streamActive,
  liveContent = "",
  dbContent = "",
  taskStatus,
}: ShouldApplyPolledContentOptions): boolean {
  if (streamActive) return false;
  if (!dbContent.trim()) return false;
  if (dbContent.length < liveContent.length) return false;
  return taskStatus === "completed";
}

export type SelectFinalAssistantContentOptions = {
  existingContent?: string;
  liveContent?: string;
  dbContent?: string;
  taskStatus?: string;
};

export function selectFinalAssistantContent({
  existingContent = "",
  liveContent = "",
  dbContent = "",
  taskStatus,
}: SelectFinalAssistantContentOptions): string {
  if (taskStatus === "completed" && dbContent.trim() && dbContent.length >= liveContent.length) return dbContent;
  if (liveContent.trim()) return liveContent;
  return existingContent;
}

export type BuildBackgroundPollingMessagePatchOptions = {
  existingContent: string;
  polledContent: string;
  liveContent?: string;
  streamActive: boolean;
  serverMessageId?: number;
  isFinished: boolean;
  status?: string;
  now: number;
  createBusyStatus: () => ChatActivityStatus;
};

export function buildBackgroundPollingMessagePatch({
  existingContent,
  polledContent,
  liveContent = "",
  streamActive,
  serverMessageId,
  isFinished,
  status,
  now,
  createBusyStatus,
}: BuildBackgroundPollingMessagePatchOptions): ChatCompletionPatch {
  const content = streamActive
    ? (liveContent || existingContent)
    : (shouldApplyPolledContent({ streamActive, liveContent, dbContent: polledContent, taskStatus: status || (isFinished ? "completed" : undefined) })
      ? polledContent
      : selectFinalAssistantContent({ existingContent, liveContent, dbContent: polledContent, taskStatus: status || (isFinished ? "completed" : undefined) }));
  return {
    content,
    serverMessageId,
    activityStatus: isFinished ? undefined : createBusyStatus(),
    completedAt: isFinished ? now : undefined,
  };
}

export function shouldKeepBackgroundLoading(state: Pick<BackgroundTaskPollState, "status" | "hasContent">): boolean {
  return state.status === "failed" || state.status === "cancelled" || state.status === "incomplete" || !state.hasContent;
}
