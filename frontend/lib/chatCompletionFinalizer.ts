export type ChatActivityStatus = {
  kind: "generating" | "reasoning" | "web_search" | "file_search" | "tool_call";
  status: "running" | "searching" | "completed" | "failed";
  label: string;
};

export type ChatCompletionPatch = {
  content?: string;
  serverMessageId?: number;
  generationTaskId?: number;
  activityStatus?: ChatActivityStatus;
  searchStatus?: "searching" | "completed" | "failed";
  searchSources?: any[];
  completedAt?: number;
  errorCode?: string;
  retryable?: boolean;
  requestId?: string;
  stopped?: boolean;
};

export type BuildFinalizingPatchOptions = {
  createFinalizingStatus: (hasContent: boolean) => ChatActivityStatus;
  hasContent: boolean;
};

export function buildFinalizingPatch({ createFinalizingStatus, hasContent }: BuildFinalizingPatchOptions): ChatCompletionPatch {
  return {
    completedAt: undefined,
    activityStatus: createFinalizingStatus(hasContent),
  };
}

export type BuildStreamErrorPatchOptions = {
  errorCode: string;
  retryable: boolean;
  requestId?: string;
};

export function buildStreamErrorPatch({ errorCode, retryable, requestId }: BuildStreamErrorPatchOptions): ChatCompletionPatch {
  return {
    errorCode,
    retryable,
    requestId,
    activityStatus: undefined,
    searchStatus: undefined,
    searchSources: undefined,
  };
}

export function buildStoppedPatch(now?: number): ChatCompletionPatch {
  return {
    stopped: true,
    completedAt: now,
    activityStatus: undefined,
  };
}

export type BuildRecoverableBusyPatchOptions = {
  serverMessageId?: number;
  generationTaskId?: number;
  activityStatus: ChatActivityStatus;
};

export function buildRecoverableBusyPatch({
  serverMessageId,
  generationTaskId,
  activityStatus,
}: BuildRecoverableBusyPatchOptions): ChatCompletionPatch {
  return {
    serverMessageId,
    generationTaskId,
    activityStatus,
    completedAt: undefined,
  };
}

export function buildCompletedPatch(now: number): ChatCompletionPatch {
  return {
    completedAt: now,
    activityStatus: undefined,
  };
}

export type ChatDisplayErrorCode = "file_not_ready" | "guest_limit_exceeded" | string | undefined;

export type BuildDisplayErrorPatchOptions = {
  errorCode?: ChatDisplayErrorCode;
  message?: string;
  guestLimitMessage?: string;
  now?: number;
};

export function buildDisplayErrorMessage({ errorCode, message, guestLimitMessage }: BuildDisplayErrorPatchOptions): string {
  if (errorCode === "file_not_ready") {
    return "⏳ 文件解析中，请稍后再问";
  }
  if (errorCode === "guest_limit_exceeded") {
    return `⚠️ ${guestLimitMessage || message || "匿名用户每日额度已用完，请登录后继续"}`;
  }
  return `❌ ${message || "请求失败"}`;
}

export function buildDisplayErrorPatch(options: BuildDisplayErrorPatchOptions): ChatCompletionPatch {
  return {
    content: buildDisplayErrorMessage(options),
    completedAt: options.now,
    activityStatus: undefined,
  };
}
