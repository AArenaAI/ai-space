import type { ChatActivityStatus } from "./chatCompletionFinalizer";
import type { NormalizedChatTaskInfo } from "./chatTaskInfo";

export type ChatStreamGroupMetaState = {
  groupId?: number;
  groupIndex?: number;
  groupModels?: string[];
  userMessageId?: number;
};

export type ChatStreamGenerationMetaState = ChatStreamGroupMetaState & {
  serverMessageId?: number;
  generationTaskId?: number;
  useBackground: boolean;
};

export type ChatStreamRealtimePatch = ChatStreamGroupMetaState & {
  content?: string;
  serverMessageId?: number;
  generationTaskId?: number;
  backgroundTaskId?: string;
  useBackground?: boolean;
  isComplexTask?: boolean;
  lastSequence?: number;
  completedAt?: number;
  activityStatus?: ChatActivityStatus;
  searchStatus?: "searching" | "completed" | "failed";
  searchSources?: any[];
  searchSourcesCount?: number;
  errorCode?: string;
  retryable?: boolean;
  requestId?: string;
};

export type MergeStreamGroupMetaOptions = {
  existing: ChatStreamGroupMetaState;
  incoming: ChatStreamGroupMetaState;
};

export function mergeStreamGroupMeta({ existing, incoming }: MergeStreamGroupMetaOptions): ChatStreamGroupMetaState {
  return {
    groupId: incoming.groupId || existing.groupId,
    groupIndex: incoming.groupIndex ?? existing.groupIndex,
    userMessageId: incoming.userMessageId || existing.userMessageId,
    groupModels: incoming.groupModels?.length ? incoming.groupModels : existing.groupModels,
  };
}

export type BuildChatDonePatchOptions = {
  accumulated: string;
  streamContent?: string;
  realtimeContent?: string;
  now?: number;
  busyStatus: ChatActivityStatus;
};

export type BuildChatDonePatchResult = {
  hasContent: boolean;
  patch: ChatStreamRealtimePatch;
};

export function buildChatDonePatch({
  accumulated,
  streamContent,
  realtimeContent,
  now = Date.now(),
  busyStatus,
}: BuildChatDonePatchOptions): BuildChatDonePatchResult {
  const hasContent = (accumulated || streamContent || realtimeContent || "").trim().length > 0;
  return {
    hasContent,
    patch: hasContent
      ? { completedAt: now, activityStatus: undefined, searchStatus: undefined }
      : { completedAt: undefined, activityStatus: busyStatus },
  };
}

export type BuildChatGenerationTaskPatchOptions = {
  taskInfo: NormalizedChatTaskInfo;
  existingMeta: ChatStreamGroupMetaState;
  lastSequence: number;
  activityStatus: ChatActivityStatus;
};

export type BuildChatGenerationTaskPatchResult = {
  meta: ChatStreamGenerationMetaState;
  patch: ChatStreamRealtimePatch;
  shouldMarkBackgroundPollingStarted: boolean;
  shouldRegisterBackgroundTask: boolean;
};

export function buildChatGenerationTaskPatch({
  taskInfo,
  existingMeta,
  lastSequence,
  activityStatus,
}: BuildChatGenerationTaskPatchOptions): BuildChatGenerationTaskPatchResult {
  const meta = mergeStreamGroupMeta({
    existing: existingMeta,
    incoming: {
      groupId: taskInfo.groupId,
      groupIndex: taskInfo.groupIndex,
      userMessageId: taskInfo.userMessageId,
      groupModels: taskInfo.groupModels,
    },
  });
  const nextMeta: ChatStreamGenerationMetaState = {
    ...meta,
    serverMessageId: taskInfo.serverMessageId,
    generationTaskId: taskInfo.generationTaskId,
    useBackground: taskInfo.useBackground,
  };
  return {
    meta: nextMeta,
    patch: {
      serverMessageId: taskInfo.serverMessageId,
      groupId: meta.groupId,
      groupIndex: meta.groupIndex,
      groupModels: meta.groupModels,
      userMessageId: meta.userMessageId,
      generationTaskId: taskInfo.generationTaskId,
      useBackground: taskInfo.useBackground,
      isComplexTask: taskInfo.isComplexTask,
      lastSequence,
      activityStatus,
    },
    shouldMarkBackgroundPollingStarted: !!taskInfo.generationTaskId,
    shouldRegisterBackgroundTask: !!taskInfo.serverMessageId && (taskInfo.useBackground || taskInfo.isComplexTask),
  };
}

export type BuildChatBackgroundTaskPatchOptions = {
  taskInfo: NormalizedChatTaskInfo;
  existingMeta: ChatStreamGroupMetaState;
  activityStatus: ChatActivityStatus;
};

export type BuildChatBackgroundTaskPatchResult = {
  meta: ChatStreamGenerationMetaState;
  patch: ChatStreamRealtimePatch;
  shouldRegisterBackgroundTask: boolean;
};

export function buildChatBackgroundTaskPatch({
  taskInfo,
  existingMeta,
  activityStatus,
}: BuildChatBackgroundTaskPatchOptions): BuildChatBackgroundTaskPatchResult {
  const meta = mergeStreamGroupMeta({
    existing: existingMeta,
    incoming: {
      groupId: taskInfo.groupId,
      groupIndex: taskInfo.groupIndex,
      userMessageId: taskInfo.userMessageId,
      groupModels: taskInfo.groupModels,
    },
  });
  const nextMeta: ChatStreamGenerationMetaState = {
    ...meta,
    serverMessageId: taskInfo.serverMessageId,
    useBackground: true,
  };
  return {
    meta: nextMeta,
    patch: {
      serverMessageId: taskInfo.serverMessageId,
      groupId: meta.groupId,
      groupIndex: meta.groupIndex,
      groupModels: meta.groupModels,
      userMessageId: meta.userMessageId,
      backgroundTaskId: taskInfo.backgroundTaskId,
      useBackground: true,
      isComplexTask: true,
      activityStatus,
    },
    shouldRegisterBackgroundTask: !!taskInfo.serverMessageId,
  };
}

export function buildChatActivityPatch({
  meta,
  activityStatus,
}: {
  meta: any;
  activityStatus: ChatActivityStatus;
}): ChatStreamRealtimePatch {
  const patch: ChatStreamRealtimePatch = { activityStatus };
  if (meta?.kind === "web_search") {
    patch.searchStatus = meta.status;
  }
  return patch;
}

export function buildChatSearchPatch({
  meta,
  activityStatus,
}: {
  meta: any;
  activityStatus: ChatActivityStatus;
}): ChatStreamRealtimePatch {
  return {
    searchStatus: meta?.status,
    searchSources: meta?.sources || [],
    searchSourcesCount: typeof meta?.sources_count === "number" ? meta.sources_count : undefined,
    activityStatus,
  };
}

export function buildChatDeltaAccumulatedState({
  accumulated,
  legacyDelta,
}: {
  accumulated: string;
  legacyDelta: string;
}): { accumulated: string; hasLegacyDelta: boolean } {
  if (!legacyDelta) return { accumulated, hasLegacyDelta: false };
  return { accumulated: accumulated + legacyDelta, hasLegacyDelta: true };
}
