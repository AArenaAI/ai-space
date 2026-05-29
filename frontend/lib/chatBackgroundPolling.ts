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

export type BuildBackgroundPollingMessagePatchOptions = {
  existingContent: string;
  polledContent: string;
  liveContent?: string;
  streamActive: boolean;
  serverMessageId?: number;
  isFinished: boolean;
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
  now,
  createBusyStatus,
}: BuildBackgroundPollingMessagePatchOptions): ChatCompletionPatch {
  const content = streamActive ? (liveContent || existingContent) : (polledContent || existingContent);
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
