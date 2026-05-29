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

export function shouldRecoverStream({ sawDone, abortReason, serverMessageId, generationTaskId }: ShouldRecoverStreamOptions): boolean {
  return !sawDone && abortReason !== "navigation" && abortReason !== "user" && (!!serverMessageId || !!generationTaskId);
}

export function shouldReconcileAfterDone({ sawDone, abortReason, serverMessageId, generationTaskId }: ShouldRecoverStreamOptions): boolean {
  return sawDone && abortReason !== "navigation" && abortReason !== "user" && (!!serverMessageId || !!generationTaskId);
}

export type ShouldMarkCompletedOptions = {
  sawDone: boolean;
  hasFinalContent: boolean;
  abortReason?: "user" | "navigation" | null;
};

export function shouldMarkCompleted({ sawDone, hasFinalContent, abortReason }: ShouldMarkCompletedOptions): boolean {
  return sawDone && hasFinalContent && abortReason !== "navigation" && abortReason !== "user";
}
