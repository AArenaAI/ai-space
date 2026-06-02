import type { ChatActivityStatus, ChatCompletionPatch } from "./chatCompletionFinalizer";
import type { NormalizedChatTaskInfo } from "./chatTaskInfo";

export type ActiveTaskStreamState = {
  convId?: number;
  serverMessageId?: number;
  generationTaskId?: number;
  lastSequence?: number;
  content?: string;
};

export type BuildActiveTaskStreamStateOptions = {
  existing?: ActiveTaskStreamState;
  convId?: number;
  serverMessageId?: number;
  generationTaskId?: number;
  lastSequence: number;
  content: string;
};

export function buildActiveTaskStreamState({
  existing,
  convId,
  serverMessageId,
  generationTaskId,
  lastSequence,
  content,
}: BuildActiveTaskStreamStateOptions): ActiveTaskStreamState {
  return {
    ...(existing || {}),
    convId,
    serverMessageId,
    generationTaskId,
    lastSequence,
    content,
  };
}

export type BuildGenerationTaskEventPatchesOptions = {
  taskInfo: NormalizedChatTaskInfo;
  convId?: number;
  lastSequence: number;
  content: string;
  existingActiveState?: ActiveTaskStreamState;
  activityStatus: ChatActivityStatus;
};

export type GenerationTaskEventPatches = {
  activeState: ActiveTaskStreamState;
  realtimePatch: ChatCompletionPatch & {
    useBackground: boolean;
    isComplexTask: boolean;
    lastSequence: number;
    phase: "waiting_provider";
  };
};

export function buildGenerationTaskEventPatches({
  taskInfo,
  convId,
  lastSequence,
  content,
  existingActiveState,
  activityStatus,
}: BuildGenerationTaskEventPatchesOptions): GenerationTaskEventPatches {
  return {
    activeState: buildActiveTaskStreamState({
      existing: existingActiveState,
      convId,
      serverMessageId: taskInfo.serverMessageId,
      generationTaskId: taskInfo.generationTaskId,
      lastSequence,
      content,
    }),
    realtimePatch: {
      serverMessageId: taskInfo.serverMessageId,
      generationTaskId: taskInfo.generationTaskId,
      useBackground: taskInfo.useBackground,
      isComplexTask: taskInfo.isComplexTask,
      lastSequence,
      activityStatus,
      phase: "waiting_provider",
    },
  };
}

export type BuildTaskActivityPatchOptions = {
  meta: any;
  activityStatus: ChatActivityStatus;
};

export function buildTaskActivityPatch({ meta, activityStatus }: BuildTaskActivityPatchOptions): ChatCompletionPatch {
  const searchStatus = meta?.kind === "web_search"
    ? (meta.status === "running" ? "searching" : "completed")
    : undefined;
  return {
    activityStatus,
    searchStatus,
    phase: meta?.kind === "web_search"
      ? (meta.status === "running" || meta.status === "searching" ? "searching" : "waiting_provider")
      : meta?.kind === "reasoning"
        ? "reasoning"
        : meta?.kind === "generating"
          ? "streaming_answer"
          : undefined,
  };
}

export type BuildTaskSearchPatchOptions = {
  meta: any;
  activityStatus: ChatActivityStatus;
};

export function buildTaskSearchPatch({ meta, activityStatus }: BuildTaskSearchPatchOptions): ChatCompletionPatch & {
  searchSourcesCount?: number;
} {
  return {
    searchStatus: meta?.status,
    searchSources: meta?.sources || [],
    searchSourcesCount: typeof meta?.sources_count === "number" ? meta.sources_count : undefined,
    activityStatus,
    phase: meta?.status === "searching" ? "searching" : "waiting_provider",
  };
}

export type BuildTaskDeltaStateOptions = {
  legacyDelta: string;
  accumulated: string;
  existingActiveState?: ActiveTaskStreamState;
  convId?: number;
  serverMessageId?: number;
  generationTaskId?: number;
  lastSequence: number;
};

export type TaskDeltaStateResult = {
  accumulated: string;
  activeState?: ActiveTaskStreamState;
};

export function buildTaskDeltaState({
  legacyDelta,
  accumulated,
  existingActiveState,
  convId,
  serverMessageId,
  generationTaskId,
  lastSequence,
}: BuildTaskDeltaStateOptions): TaskDeltaStateResult {
  if (!legacyDelta) {
    return { accumulated };
  }
  const nextAccumulated = accumulated + legacyDelta;
  return {
    accumulated: nextAccumulated,
    activeState: buildActiveTaskStreamState({
      existing: existingActiveState,
      convId,
      serverMessageId,
      generationTaskId,
      lastSequence,
      content: nextAccumulated,
    }),
  };
}
