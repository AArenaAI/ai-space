import type { ChatActivityStatus, Message } from "./chatTypes";
import type { RealtimeData } from "./streaming";
import { getActivityLabel } from "./chatActivityStatus";
import { deriveUserGenerationPhase, getGenerationPhaseWithElapsedLabel, type UserGenerationPhase } from "./chatGenerationPhase";
import { buildFallbackCompletedTimeline, getCompletedStatusLabel, type ChatStatusTimelineStep } from "./chatStatusTimeline";

export type MessageDisplayStatus = {
  key: string;
  kind: "generating" | "thinking" | "web_search" | "file_search" | "tool_call" | "finalizing" | "completed" | "stopped" | "error";
  phase: "running" | "completed" | "failed" | "stopped";
  label: string;
  active: boolean;
  tone: "blue" | "amber" | "green" | "red" | "neutral" | "purple";
  count?: number;
  retryable?: boolean;
  requestId?: string;
  generationPhase?: UserGenerationPhase;
  statusTimeline?: ChatStatusTimelineStep[];
  generationStartedAt?: number;
  completedAt?: number;
};

type RealtimeActivityStatus = { kind: string; status: string; label: string };

type StatusInput = {
  message: Message;
  realtime?: RealtimeData;
  isStreaming: boolean;
  t?: (key: string, params?: Record<string, string>) => string;
};

const fallbackT = (key: string) => key;

function phaseToDisplayKind(phase: UserGenerationPhase): MessageDisplayStatus["kind"] {
  if (phase === "searching") return "web_search";
  if (phase === "reasoning") return "thinking";
  if (phase === "finalizing") return "finalizing";
  return "generating";
}

function phaseToTone(phase: UserGenerationPhase): MessageDisplayStatus["tone"] {
  if (phase === "searching") return "blue";
  if (phase === "reasoning") return "purple";
  return "amber";
}

function coerceActivityStatus(activity?: ChatActivityStatus | RealtimeActivityStatus): ChatActivityStatus | undefined {
  if (!activity) return undefined;
  const kind = activity.kind === "reasoning" || activity.kind === "web_search" || activity.kind === "file_search" || activity.kind === "tool_call" || activity.kind === "generating"
    ? activity.kind
    : "generating";
  const status = activity.status === "searching" || activity.status === "completed" || activity.status === "failed" || activity.status === "running"
    ? activity.status
    : "running";
  return { kind, status, label: activity.label };
}

function activityKindToDisplay(kind: ChatActivityStatus["kind"]): MessageDisplayStatus["kind"] {
  if (kind === "reasoning") return "thinking";
  return kind;
}

function activityTone(kind: ChatActivityStatus["kind"], status: ChatActivityStatus["status"]): MessageDisplayStatus["tone"] {
  if (status === "failed") return "red";
  if (status === "completed") return "green";
  if (kind === "web_search") return "blue";
  if (kind === "reasoning") return "purple";
  return "amber";
}

function statusPhase(status: ChatActivityStatus["status"]): MessageDisplayStatus["phase"] {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "running";
}

export function deriveMessageStatuses({ message, realtime, isStreaming, t = fallbackT }: StatusInput): MessageDisplayStatus[] {
  const errorCode = realtime?.errorCode ?? message.errorCode;
  if (errorCode) {
    return [{
      key: `error:${errorCode}`,
      kind: "error",
      phase: "failed",
      label: errorCode,
      active: false,
      tone: "red",
      retryable: realtime?.retryable ?? message.retryable,
      requestId: realtime?.requestId ?? message.requestId,
    }];
  }

  if (realtime?.stopped || message.stopped) {
    return [{
      key: "stopped",
      kind: "stopped",
      phase: "stopped",
      label: t("chat.status.stopped"),
      active: false,
      tone: "neutral",
    }];
  }

  const activity = coerceActivityStatus(realtime?.activityStatus ?? message.activityStatus);
  const searchStatus = realtime?.searchStatus ?? message.searchStatus;
  const searchSources = realtime?.searchSources ?? message.searchSources;
  const searchSourcesCount = realtime?.searchSourcesCount ?? message.searchSourcesCount;
  const sourceCount = typeof searchSourcesCount === "number" ? searchSourcesCount : (searchSources?.length || 0);
  const completedAt = realtime?.completedAt ?? message.completedAt;
  const generationStartedAt = realtime?.generationStartedAt ?? message.generationStartedAt ?? message.createdAt;
  const statusTimeline = realtime?.statusTimeline ?? message.statusTimeline;
  const completedStatusTimeline = statusTimeline?.length ? statusTimeline : buildFallbackCompletedTimeline({
    generationStartedAt,
    completedAt,
    searchSourcesCount: sourceCount || undefined,
    hasReasoning: Boolean(realtime?.reasoningContent || message.reasoningContent),
    hasAnswer: Boolean((realtime?.answerContent || realtime?.content || message.content || "").trim()),
  });
  const statuses: MessageDisplayStatus[] = [];

  if (completedAt && !isStreaming) {
    return [{
      key: "completed",
      kind: "completed",
      phase: "completed",
      label: getCompletedStatusLabel(t, generationStartedAt, completedAt),
      active: false,
      tone: "green",
      count: sourceCount || undefined,
      statusTimeline: completedStatusTimeline,
      generationStartedAt,
      completedAt,
    }];
  }

  if (searchStatus === "failed") {
    return [{
      key: "web_search:failed",
      kind: "web_search",
      phase: "failed",
      label: t("chat.status.webSearch"),
      active: false,
      tone: "red",
      count: sourceCount || undefined,
    }];
  }

  const generationPhase = deriveUserGenerationPhase(realtime ?? message, isStreaming);

  if (generationPhase) {
    const startedAt = realtime?.generationStartedAt || realtime?.updatedAt || message.createdAt || Date.now();
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    statuses.push({
      key: `phase:${generationPhase}`,
      kind: phaseToDisplayKind(generationPhase),
      phase: "running",
      label: getGenerationPhaseWithElapsedLabel(t, generationPhase, elapsedMs),
      active: true,
      tone: phaseToTone(generationPhase),
      count: sourceCount || undefined,
      generationPhase,
    });
    return statuses;
  }

  if (searchStatus === "searching") {
    statuses.push({
      key: "web_search:running",
      kind: "web_search",
      phase: "running",
      label: t("chat.status.webSearch"),
      active: true,
      tone: "blue",
      count: sourceCount || undefined,
    });
  } else if (searchStatus === "completed" || sourceCount > 0) {
    statuses.push({
      key: "web_search:completed",
      kind: "web_search",
      phase: "completed",
      label: `${t("chat.status.webSearchDone")}${sourceCount > 0 ? ` · ${t("chat.status.cited")}${sourceCount}${t("chat.status.sources")}` : ""}`,
      active: false,
      tone: "green",
      count: sourceCount || undefined,
    });
  }

  if (activity) {
    const normalizedLabel = getActivityLabel(t, activity.kind, activity.status, activity.label);
    const isDuplicateSearch = activity.kind === "web_search" && statuses.some((status) => status.kind === "web_search");
    if (!isDuplicateSearch && activity.kind !== "reasoning") {
      statuses.push({
        key: `${activity.kind}:${activity.status}`,
        kind: activityKindToDisplay(activity.kind),
        phase: statusPhase(activity.status),
        label: normalizedLabel,
        active: activity.status !== "completed" && activity.status !== "failed",
        tone: activityTone(activity.kind, activity.status),
      });
    }
  }

  const phase = realtime?.phase;
  if (!statuses.length && phase) {
    if (phase === "failed") {
      statuses.push({ key: "phase:failed", kind: "error", phase: "failed", label: t("chat.status.generating"), active: false, tone: "red" });
    } else if (phase === "stopped") {
      statuses.push({ key: "phase:stopped", kind: "stopped", phase: "stopped", label: t("chat.status.stopped"), active: false, tone: "neutral" });
    } else if (phase === "searching") {
      statuses.push({ key: "phase:searching", kind: "web_search", phase: "running", label: t("chat.status.webSearch"), active: true, tone: "blue" });
    } else if (phase === "thinking") {
      statuses.push({ key: "phase:thinking", kind: "thinking", phase: "running", label: t("chat.reasoning.thinking"), active: true, tone: "purple" });
    } else if (phase === "finalizing") {
      statuses.push({ key: "phase:finalizing", kind: "finalizing", phase: "running", label: t("chat.status.finalizing"), active: true, tone: "amber" });
    } else if (phase === "generating" || phase === "starting" || phase === "retrieving_files") {
      statuses.push({ key: `phase:${phase}`, kind: phase === "retrieving_files" ? "file_search" : "generating", phase: "running", label: phase === "retrieving_files" ? t("chat.status.fileSearch") : t("chat.status.generating"), active: true, tone: "amber" });
    }
  }

  if (!statuses.length && isStreaming) {
    statuses.push({
      key: "generating:streaming",
      kind: "generating",
      phase: "running",
      label: t("chat.status.generating"),
      active: true,
      tone: "amber",
    });
  }

  if (!statuses.length && message.completedAt && !isStreaming) {
    return [];
  }

  return statuses;
}
