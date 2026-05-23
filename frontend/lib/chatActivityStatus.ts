export type ChatActivityStatus = {
  kind: "generating" | "reasoning" | "web_search" | "file_search" | "tool_call";
  status: "running" | "searching" | "completed";
  label: string;
};

export const BUSY_GENERATING_LABEL = "任务繁忙，正在生成中";
export const GENERATING_LABEL = "正在生成内容";
export const FINALIZING_LABEL = "正在校准最终内容";
export const WEB_SEARCH_LABEL = "正在联网搜索";
export const FILE_SEARCH_LABEL = "正在搜索文件";
export const TOOL_CALL_LABEL = "正在调用工具";
export const WEB_SEARCH_DONE_LABEL = "已联网搜索";
export const FILE_SEARCH_DONE_LABEL = "已搜索文件";
export const TOOL_CALL_DONE_LABEL = "已调用工具";

const PASSTHROUGH_LABELS = new Set([
  BUSY_GENERATING_LABEL,
  FINALIZING_LABEL,
]);

export function getActivityLabel(kind: ChatActivityStatus["kind"], status: ChatActivityStatus["status"], label?: string): string {
  if (status === "completed") {
    if (kind === "web_search") return WEB_SEARCH_DONE_LABEL;
    if (kind === "file_search") return FILE_SEARCH_DONE_LABEL;
    if (kind === "tool_call") return TOOL_CALL_DONE_LABEL;
  }

  if (label && PASSTHROUGH_LABELS.has(label)) return label;

  if (kind === "web_search") return WEB_SEARCH_LABEL;
  if (kind === "file_search") return FILE_SEARCH_LABEL;
  if (kind === "tool_call") return TOOL_CALL_LABEL;
  return GENERATING_LABEL;
}

export function createGeneratingStatus(label = GENERATING_LABEL): ChatActivityStatus {
  return { kind: "generating", status: "running", label };
}

export function createBusyGeneratingStatus(): ChatActivityStatus {
  return createGeneratingStatus(BUSY_GENERATING_LABEL);
}

export function createFinalizingStatus(hasContent: boolean): ChatActivityStatus {
  return createGeneratingStatus(hasContent ? FINALIZING_LABEL : BUSY_GENERATING_LABEL);
}

export function createWebSearchDoneStatus(): ChatActivityStatus {
  return { kind: "web_search", status: "completed", label: WEB_SEARCH_DONE_LABEL };
}

export function createActivityStatusFromMeta(meta: Record<string, unknown>): ChatActivityStatus {
  const kind = typeof meta.kind === "string" ? (meta.kind as ChatActivityStatus["kind"]) : "generating";
  const status = typeof meta.status === "string" ? (meta.status as ChatActivityStatus["status"]) : "running";
  const label = typeof meta.label === "string" ? meta.label : undefined;
  return {
    kind,
    status,
    label: getActivityLabel(kind, status, label),
  };
}
