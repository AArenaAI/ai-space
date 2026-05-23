export type ChatActivityStatus = {
  kind: "generating" | "reasoning" | "web_search" | "file_search" | "tool_call";
  status: "running" | "searching" | "completed";
  label: string;
};

export const BUSY_GENERATING_LABEL = "任务繁忙，正在生成中";
export const GENERATING_LABEL = "正在生成内容";
export const FINALIZING_LABEL = "正在校准最终内容";
export const REASONING_LABEL = "深度推理中，片刻即达极致答案";
export const WEB_SEARCH_DONE_LABEL = "网页搜索完成";

export function createGeneratingStatus(label = GENERATING_LABEL): ChatActivityStatus {
  return { kind: "generating", status: "running", label };
}

export function createBusyGeneratingStatus(): ChatActivityStatus {
  return createGeneratingStatus(BUSY_GENERATING_LABEL);
}

export function createFinalizingStatus(hasContent: boolean): ChatActivityStatus {
  return createGeneratingStatus(hasContent ? FINALIZING_LABEL : BUSY_GENERATING_LABEL);
}

export function createReasoningStatus(): ChatActivityStatus {
  return { kind: "reasoning", status: "running", label: REASONING_LABEL };
}

export function createWebSearchDoneStatus(): ChatActivityStatus {
  return { kind: "web_search", status: "completed", label: WEB_SEARCH_DONE_LABEL };
}

export function createActivityStatusFromMeta(meta: Record<string, unknown>): ChatActivityStatus {
  return {
    kind: typeof meta.kind === "string" ? (meta.kind as ChatActivityStatus["kind"]) : "generating",
    status: typeof meta.status === "string" ? (meta.status as ChatActivityStatus["status"]) : "running",
    label: typeof meta.label === "string" && meta.label ? meta.label : GENERATING_LABEL,
  };
}
