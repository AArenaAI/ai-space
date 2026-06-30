import type { ChatActivityStatus, SearchSource } from "./chatTypes";
import type { RealtimeData, RuntimePhase } from "./streaming";
import { formatElapsedTime } from "./chatGenerationPhase";

export type ChatStatusStepKind =
  | "waiting_provider"
  | "web_search"
  | "file_search"
  | "tool_call"
  | "reasoning"
  | "streaming_answer"
  | "finalizing";

export type ChatStatusStepStatus = "running" | "completed" | "failed" | "stopped";

export type ChatStatusTimelineStep = {
  id: string;
  kind: ChatStatusStepKind;
  status: ChatStatusStepStatus;
  startedAt: number;
  endedAt?: number;
  count?: number;
  label?: string;
};

type TimelineSource = Partial<Pick<RealtimeData,
  | "phase"
  | "generationStartedAt"
  | "activityStatus"
  | "searchStatus"
  | "searchSources"
  | "searchSourcesCount"
  | "completedAt"
>>;

type TimelinePatch = Partial<TimelineSource>;

function normalizePhaseToKind(phase?: RuntimePhase): ChatStatusStepKind | undefined {
  if (phase === "waiting_provider" || phase === "starting") return "waiting_provider";
  if (phase === "searching") return "web_search";
  if (phase === "reasoning" || phase === "thinking") return "reasoning";
  if (phase === "streaming_answer" || phase === "generating") return "streaming_answer";
  if (phase === "finalizing") return "finalizing";
  if (phase === "retrieving_files") return "file_search";
  return undefined;
}

function normalizeActivityKind(kind?: string): ChatStatusStepKind | undefined {
  if (kind === "web_search") return "web_search";
  if (kind === "file_search") return "file_search";
  if (kind === "tool_call") return "tool_call";
  if (kind === "reasoning") return "reasoning";
  if (kind === "generating") return "streaming_answer";
  return undefined;
}

function normalizeActivityStatus(status?: string): ChatStatusStepStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "stopped") return "stopped";
  return "running";
}

function sourceCountFrom(data: TimelineSource): number | undefined {
  if (typeof data.searchSourcesCount === "number") return data.searchSourcesCount;
  const sources = data.searchSources as SearchSource[] | undefined;
  return sources?.length || undefined;
}

function eventId(kind: ChatStatusStepKind, status: ChatStatusStepStatus) {
  return `${kind}:${status}`;
}

function upsertStep(
  timeline: ChatStatusTimelineStep[],
  nextStep: Omit<ChatStatusTimelineStep, "id">,
): ChatStatusTimelineStep[] {
  const id = eventId(nextStep.kind, nextStep.status);
  const existingSame = timeline.find((step) => step.id === id);
  if (existingSame) {
    return timeline.map((step) => step.id === id
      ? {
          ...step,
          ...nextStep,
          id,
          startedAt: step.startedAt,
          endedAt: nextStep.endedAt ?? step.endedAt,
        }
      : step);
  }

  const runningSameKind = timeline.find((step) => step.kind === nextStep.kind && step.status === "running");
  const normalizedNextStep = nextStep.status === "running" || !runningSameKind
    ? nextStep
    : {
        ...nextStep,
        startedAt: runningSameKind.startedAt,
        endedAt: nextStep.endedAt ?? nextStep.startedAt,
      };

  const closedTimeline = timeline.map((step) => {
    if (step.kind !== normalizedNextStep.kind || step.status !== "running" || normalizedNextStep.status === "running") return step;
    return { ...step, endedAt: step.endedAt ?? normalizedNextStep.endedAt ?? normalizedNextStep.startedAt };
  });

  return [...closedTimeline, { ...normalizedNextStep, id }];
}

const STEP_KIND_ORDER: Record<ChatStatusStepKind, number> = {
  waiting_provider: 0,
  web_search: 1,
  file_search: 2,
  tool_call: 3,
  reasoning: 4,
  streaming_answer: 5,
  finalizing: 6,
};

const STEP_STATUS_ORDER: Record<ChatStatusStepStatus, number> = {
  running: 0,
  completed: 1,
  failed: 2,
  stopped: 3,
};

function mergeTimelineStepStatus(current: ChatStatusStepStatus, next: ChatStatusStepStatus): ChatStatusStepStatus {
  if (current === "running" || next === "running") return "running";
  if (current === "failed" || next === "failed") return "failed";
  if (current === "stopped" || next === "stopped") return "stopped";
  return "completed";
}

export function getOrderedTimelineSteps(steps: ChatStatusTimelineStep[] | undefined): ChatStatusTimelineStep[] {
  if (!steps?.length) return [];
  const terminalKinds = new Set(
    steps
      .filter((step) => step.status !== "running")
      .map((step) => step.kind)
  );
  const byKind = new Map<ChatStatusStepKind, ChatStatusTimelineStep>();
  steps
    .filter((step) => !(step.status === "running" && terminalKinds.has(step.kind)))
    .forEach((step) => {
      const existing = byKind.get(step.kind);
      if (!existing) {
        byKind.set(step.kind, { ...step });
        return;
      }
      byKind.set(step.kind, {
        ...existing,
        id: eventId(step.kind, mergeTimelineStepStatus(existing.status, step.status)),
        status: mergeTimelineStepStatus(existing.status, step.status),
        startedAt: Math.min(existing.startedAt || step.startedAt, step.startedAt || existing.startedAt),
        endedAt: (existing.endedAt || existing.startedAt || 0) + Math.max(0, (step.endedAt || step.startedAt || 0) - (step.startedAt || 0)),
        count: Math.max(existing.count || 0, step.count || 0) || existing.count || step.count,
        label: step.label || existing.label,
      });
    });
  return Array.from(byKind.values()).sort((a, b) => {
    const kindDiff = STEP_KIND_ORDER[a.kind] - STEP_KIND_ORDER[b.kind];
    if (kindDiff !== 0) return kindDiff;
    const statusDiff = STEP_STATUS_ORDER[a.status] - STEP_STATUS_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;
    return (a.startedAt || 0) - (b.startedAt || 0);
  });
}

function deriveTimelineSteps(prev: TimelineSource, next: TimelineSource, patch: TimelinePatch, ts: number): Omit<ChatStatusTimelineStep, "id">[] {
  const generationStartedAt = next.generationStartedAt || prev.generationStartedAt || ts;
  const steps: Omit<ChatStatusTimelineStep, "id">[] = [];

  if (patch.searchStatus === "completed" || (patch.searchSources !== undefined && sourceCountFrom(next))) {
    steps.push({
      kind: "web_search",
      status: "completed",
      startedAt: ts,
      endedAt: ts,
      count: sourceCountFrom(next),
    });
  } else if (patch.searchStatus === "failed") {
    steps.push({ kind: "web_search", status: "failed", startedAt: ts, endedAt: ts, count: sourceCountFrom(next) });
  } else if (patch.searchStatus === "searching") {
    steps.push({ kind: "web_search", status: "running", startedAt: ts, count: sourceCountFrom(next) });
  }

  const activity = patch.activityStatus as ChatActivityStatus | undefined;
  const activityKind = normalizeActivityKind(activity?.kind);
  if (activityKind) {
    steps.push({
      kind: activityKind,
      status: normalizeActivityStatus(activity?.status),
      startedAt: ts,
      endedAt: activity?.status === "completed" || activity?.status === "failed" ? ts : undefined,
      label: activity?.label,
      count: activityKind === "web_search" ? sourceCountFrom(next) : undefined,
    });
  }

  const phaseKind = normalizePhaseToKind(patch.phase);
  if (phaseKind && !steps.some((step) => step.kind === phaseKind && step.status === "running")) {
    steps.push({ kind: phaseKind, status: "running", startedAt: phaseKind === "waiting_provider" ? generationStartedAt : ts });
  }

  return steps;
}

export function updateStatusTimeline(
  previousTimeline: ChatStatusTimelineStep[] | undefined,
  prev: TimelineSource,
  next: TimelineSource,
  patch: TimelinePatch,
  ts: number,
): ChatStatusTimelineStep[] | undefined {
  let timeline = previousTimeline ? previousTimeline.map((step) => ({ ...step })) : [];
  const steps = deriveTimelineSteps(prev, next, patch, ts);
  for (const step of steps) {
    timeline = upsertStep(timeline, step);
  }
  if (patch.completedAt || patch.phase === "completed" || patch.phase === "failed" || patch.phase === "stopped") {
    timeline = timeline.map((step) => step.status === "running" ? { ...step, endedAt: step.endedAt ?? ts } : step);
  }
  return timeline.length ? timeline : previousTimeline;
}

function shortStatusLabel(t: (key: string, params?: Record<string, string>) => string, key: string, fallback: string) {
  const value = t(key);
  return value === key ? fallback : value;
}

export function getTimelineStepLabel(
  t: (key: string, params?: Record<string, string>) => string,
  step: ChatStatusTimelineStep,
  generationStartedAt?: number,
): string {
  if (step.status === "completed") {
    if (step.kind === "waiting_provider") return shortStatusLabel(t, "chat.status.short.responded", "Responded");
    if (step.kind === "web_search") {
      return `${shortStatusLabel(t, "chat.status.short.searchDone", "Search done")}${step.count ? ` · ${step.count}${shortStatusLabel(t, "chat.status.short.sources", " sources")}` : ""}`;
    }
    if (step.kind === "file_search") return shortStatusLabel(t, "chat.status.short.filesDone", "Files done");
    if (step.kind === "tool_call") return shortStatusLabel(t, "chat.status.short.toolDone", "Tool done");
    if (step.kind === "reasoning") return shortStatusLabel(t, "chat.status.short.reasoned", "Reasoned");
    if (step.kind === "streaming_answer") return shortStatusLabel(t, "chat.status.short.generated", "Generated");
    if (step.kind === "finalizing") return shortStatusLabel(t, "chat.status.short.finalized", "Finalized");
  }
  if (step.kind === "web_search" && step.status === "failed") return shortStatusLabel(t, "chat.status.short.searchFailed", "Search failed");
  if (step.status === "failed") return step.label || shortStatusLabel(t, "chat.status.short.failed", "Failed");
  if (step.status === "stopped") return shortStatusLabel(t, "chat.status.short.stopped", "Stopped");

  const label = {
    waiting_provider: shortStatusLabel(t, "chat.status.short.waiting", "Waiting"),
    web_search: shortStatusLabel(t, "chat.status.short.searching", "Searching"),
    file_search: shortStatusLabel(t, "chat.status.short.files", "Files"),
    tool_call: step.label || shortStatusLabel(t, "chat.status.short.tool", "Tool"),
    reasoning: shortStatusLabel(t, "chat.status.short.reasoning", "Reasoning"),
    streaming_answer: shortStatusLabel(t, "chat.status.short.generating", "Generating"),
    finalizing: shortStatusLabel(t, "chat.status.short.finalizing", "Finalizing"),
  }[step.kind];
  if (step.status !== "running") return label;
  const base = generationStartedAt || step.startedAt;
  return `${label} · ${formatElapsedTime(Math.max(0, step.startedAt - base), t)}`;
}

export function getCompletedStatusLabel(
  t: (key: string, params?: Record<string, string>) => string,
  generationStartedAt?: number,
  completedAt?: number,
): string {
  if (generationStartedAt && completedAt) {
    return t("chat.status.completedWithElapsed", { elapsed: formatElapsedTime(completedAt - generationStartedAt, t) });
  }
  return t("chat.status.completed");
}

export function buildFallbackCompletedTimeline({
  generationStartedAt,
  completedAt,
  searchSourcesCount,
  hasReasoning,
  hasAnswer,
}: {
  generationStartedAt?: number;
  completedAt?: number;
  searchSourcesCount?: number;
  hasReasoning?: boolean;
  hasAnswer?: boolean;
}): ChatStatusTimelineStep[] {
  const start = generationStartedAt || completedAt || Date.now();
  const end = completedAt || start;
  const steps: ChatStatusTimelineStep[] = [{
    id: "waiting_provider:running",
    kind: "waiting_provider",
    status: "running",
    startedAt: start,
    endedAt: end,
  }];

  if (searchSourcesCount && searchSourcesCount > 0) {
    steps.push({
      id: "web_search:completed",
      kind: "web_search",
      status: "completed",
      startedAt: start,
      endedAt: end,
      count: searchSourcesCount,
    });
  }

  if (hasReasoning) {
    steps.push({
      id: "reasoning:running",
      kind: "reasoning",
      status: "running",
      startedAt: start,
      endedAt: end,
    });
  }

  if (hasAnswer !== false) {
    steps.push({
      id: "streaming_answer:running",
      kind: "streaming_answer",
      status: "running",
      startedAt: start,
      endedAt: end,
    });
  }

  return steps;
}
