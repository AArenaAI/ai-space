export type ChatActivityStatus = {
  kind: "generating" | "reasoning" | "web_search" | "file_search" | "tool_call";
  status: "running" | "searching" | "completed" | "failed";
  label: string;
};

export function getActivityLabel(
  t: (key: string) => string,
  kind: ChatActivityStatus["kind"],
  status: ChatActivityStatus["status"],
  label?: string
): string {
  const BUSY = t("chat.status.busyGenerating");
  const FINALIZING = t("chat.status.finalizing");
  const PASSTHROUGH_LABELS = new Set([BUSY, FINALIZING]);

  if (status === "completed") {
    if (kind === "web_search") return t("chat.status.webSearchDone");
    if (kind === "file_search") return t("chat.status.fileSearchDone");
    if (kind === "tool_call") return t("chat.status.toolCallDone");
  }

  if (label && PASSTHROUGH_LABELS.has(label)) return label;

  if (kind === "web_search") return t("chat.status.webSearch");
  if (kind === "file_search") return t("chat.status.fileSearch");
  if (kind === "tool_call") return t("chat.status.toolCall");
  return t("chat.status.generating");
}

export function createGeneratingStatus(t: (key: string) => string): ChatActivityStatus {
  return { kind: "generating", status: "running", label: t("chat.status.generating") };
}

export function createBusyGeneratingStatus(t: (key: string) => string): ChatActivityStatus {
  return createGeneratingStatus(t);
}

export function createFinalizingStatus(t: (key: string) => string, hasContent: boolean): ChatActivityStatus {
  return { kind: "generating", status: "running", label: hasContent ? t("chat.status.finalizing") : t("chat.status.busyGenerating") };
}

export function createWebSearchDoneStatus(t: (key: string) => string): ChatActivityStatus {
  return { kind: "web_search", status: "completed", label: t("chat.status.webSearchDone") };
}

export function createActivityStatusFromMeta(t: (key: string) => string, meta: Record<string, unknown>): ChatActivityStatus {
  const kind = typeof meta.kind === "string" ? (meta.kind as ChatActivityStatus["kind"]) : "generating";
  const status = typeof meta.status === "string" ? (meta.status as ChatActivityStatus["status"]) : "running";
  const label = typeof meta.label === "string" ? meta.label : undefined;
  return {
    kind,
    status,
    label: getActivityLabel(t, kind, status, label),
  };
}
