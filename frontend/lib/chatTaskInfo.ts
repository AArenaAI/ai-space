export type ChatTaskInfoFallbacks = {
  generationTaskId?: number;
  serverMessageId?: number;
};

export type NormalizedChatTaskInfo = {
  serverMessageId?: number;
  groupId?: number;
  groupIndex?: number;
  userMessageId?: number;
  groupModels?: string[];
  generationTaskId?: number;
  backgroundTaskId?: string;
  useBackground: boolean;
  isComplexTask: boolean;
};

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value || 0);
  return parsed || undefined;
}

function toOptionalGroupIndex(value: unknown): number | undefined {
  if (value === 0 || value) {
    return Number(value);
  }
  return undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((m): m is string => typeof m === "string" && m.length > 0);
  return items.length ? items : undefined;
}

function isBackgroundLike(task: any): boolean {
  return task?.use_background === true || task?.background === true || task?.is_complex_task === true;
}

export function normalizeGenerationTaskInfo(task: any, fallbacks: ChatTaskInfoFallbacks = {}): NormalizedChatTaskInfo {
  return {
    serverMessageId: toOptionalNumber(task?.assistant_message_id || fallbacks.serverMessageId || 0),
    groupId: toOptionalNumber(task?.group_id),
    groupIndex: toOptionalGroupIndex(task?.group_index),
    userMessageId: toOptionalNumber(task?.user_message_id),
    groupModels: toStringArray(task?.group_models),
    generationTaskId: toOptionalNumber(task?.id || task?.task_id || fallbacks.generationTaskId || 0),
    useBackground: isBackgroundLike(task),
    isComplexTask: task?.is_complex_task === true,
  };
}

export function normalizeBackgroundTaskInfo(task: any): NormalizedChatTaskInfo {
  return {
    serverMessageId: toOptionalNumber(task?.assistant_message_id),
    groupId: toOptionalNumber(task?.group_id),
    groupIndex: toOptionalGroupIndex(task?.group_index),
    userMessageId: toOptionalNumber(task?.user_message_id),
    groupModels: toStringArray(task?.group_models),
    backgroundTaskId: task?.id || "",
    useBackground: true,
    isComplexTask: true,
  };
}
