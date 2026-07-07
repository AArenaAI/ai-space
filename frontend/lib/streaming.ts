import { updateStatusTimeline, type ChatStatusTimelineStep } from "./chatStatusTimeline";

export type RealtimeActivityStatus = { kind: string; status: string; label: string };

export type RuntimePhase =
  | "idle"
  | "starting"
  | "waiting_provider"
  | "thinking"
  | "reasoning"
  | "searching"
  | "retrieving_files"
  | "generating"
  | "streaming_answer"
  | "finalizing"
  | "completed"
  | "stopped"
  | "failed";

export type RealtimeData = {
  /**
   * Backward-compatible combined stream text. During reasoning streams this may
   * still contain <think>...</think> markers because existing renderers parse
   * those markers to show the thinking block.
   */
  content: string;
  /** Visible assistant answer without reasoning markers. New renderers should
   * prefer this field over reparsing content. */
  answerContent?: string;
  /** Reasoning / thinking text without <think> wrappers. */
  reasoningContent?: string;
  /** True while the latest delta is inside a reasoning block. */
  isReasoning?: boolean;
  /** Monotonic version for immutable snapshots and debugging. */
  version?: number;
  /** Last update timestamp in ms. Used by TTL cleanup. */
  updatedAt?: number;
  /** Store expiry timestamp in ms. Entries are removed after this time. */
  expiresAt?: number;
  /** Structured runtime phase for status derivation. Legacy callers may still use activity/search flags. */
  phase?: RuntimePhase;
  /** Stable start timestamp for the current generation lifecycle. Used for user-facing elapsed time. */
  generationStartedAt?: number;
  /** User-visible status process timeline for completed badge popover. */
  statusTimeline?: ChatStatusTimelineStep[];
  activityStatus?: RealtimeActivityStatus;
  searchStatus?: "searching" | "completed" | "failed";
  searchSources?: any[];
  searchSourcesCount?: number;
  serverMessageId?: number;
  groupId?: number;
  groupIndex?: number;
  groupModels?: string[];
  userMessageId?: number;
  generationTaskId?: number;
  backgroundTaskId?: string;
  useBackground?: boolean;
  isComplexTask?: boolean;
  lastSequence?: number;
  completedAt?: number;
  errorCode?: string;
  retryable?: boolean;
  requestId?: string;
  stopped?: boolean;
};

export type RealtimeAppendPatch =
  | string
  | {
      contentDelta?: string;
      answerDelta?: string;
      reasoningDelta?: string;
      /** Explicitly enter/leave reasoning mode for provider-specific events. */
      reasoning?: boolean;
      /** Replace rather than append the corresponding field. */
      replace?: boolean;
    };

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const COMPLETED_TTL_MS = 30 * 1000;
const FINALIZING_HOLD_TTL_MS = 5 * 1000;
const MAX_ENTRIES = 200;

const store = new Map<string, RealtimeData>();
const subs = new Map<string, Set<() => void>>();
const pending = new Set<string>();
let frame: ReturnType<typeof requestAnimationFrame> | null = null;
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
let versionCounter = 0;

function now() {
  return Date.now();
}

function ttlFor(data: Partial<RealtimeData>) {
  return data.completedAt || data.stopped || data.errorCode ? COMPLETED_TTL_MS : DEFAULT_TTL_MS;
}

function immutable<T extends RealtimeData>(data: T): T {
  // Shallow freeze catches accidental in-place mutation during development while
  // preserving runtime compatibility in production builds.
  if (process.env.NODE_ENV !== "production") {
    return Object.freeze(data);
  }
  return data;
}

function splitLegacyContent(content: string): Pick<RealtimeData, "answerContent" | "reasoningContent" | "isReasoning"> {
  let answer = "";
  let reasoning = "";
  let cursor = 0;
  let inReasoning = false;

  while (cursor < content.length) {
    const open = content.indexOf("<think>", cursor);
    const close = content.indexOf("</think>", cursor);

    if (!inReasoning && open === -1) {
      answer += content.slice(cursor);
      break;
    }

    if (!inReasoning && open !== -1) {
      answer += content.slice(cursor, open);
      cursor = open + "<think>".length;
      inReasoning = true;
      continue;
    }

    if (inReasoning && close === -1) {
      reasoning += content.slice(cursor);
      cursor = content.length;
      break;
    }

    if (inReasoning && close !== -1) {
      reasoning += content.slice(cursor, close);
      cursor = close + "</think>".length;
      inReasoning = false;
      continue;
    }
  }

  return { answerContent: answer, reasoningContent: reasoning, isReasoning: inReasoning };
}

function applyLegacyDelta(prev: RealtimeData, delta: string): Pick<RealtimeData, "content" | "answerContent" | "reasoningContent" | "isReasoning"> {
  // Existing callers already build a combined stream with <think> markers. Keep
  // that combined content byte-compatible, then derive separated fields from it.
  const content = `${prev.content || ""}${delta || ""}`;
  return { content, ...splitLegacyContent(content) };
}

function buildNext(id: string, patch: Partial<RealtimeData>): RealtimeData {
  const prev = store.get(id) || { content: "" };
  const ts = now();
  const startsGeneration = !!(
    patch.phase === "waiting_provider" ||
    patch.phase === "searching" ||
    patch.phase === "reasoning" ||
    patch.phase === "streaming_answer" ||
    patch.phase === "generating" ||
    patch.phase === "thinking" ||
    patch.generationTaskId ||
    patch.backgroundTaskId ||
    patch.activityStatus?.status === "running" ||
    patch.searchStatus === "searching"
  );
  const draft: RealtimeData = {
    ...prev,
    ...patch,
    content: patch.content ?? prev.content ?? "",
    generationStartedAt: patch.generationStartedAt ?? prev.generationStartedAt ?? (startsGeneration ? ts : undefined),
    version: ++versionCounter,
    updatedAt: ts,
    expiresAt: patch.expiresAt ?? ts + ttlFor({ ...prev, ...patch }),
  };
  const next: RealtimeData = immutable({
    ...draft,
    statusTimeline: updateStatusTimeline(prev.statusTimeline, prev, draft, patch, ts),
  });
  return next;
}

function setEntry(id: string, patch: Partial<RealtimeData>) {
  store.set(id, buildNext(id, patch));
  enforceMaxEntries();
  ensureCleanupTimer();
  schedule(id);
}

function enforceMaxEntries() {
  if (store.size <= MAX_ENTRIES) return;
  const entries = Array.from(store.entries()).sort(
    (a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0)
  );
  for (const [id] of entries.slice(0, store.size - MAX_ENTRIES)) {
    store.delete(id);
    pending.delete(id);
    schedule(id);
  }
}

export function realtimeSweepExpiredEntries(ts = now()) {
  let nextExpiry = Infinity;
  Array.from(store.entries()).forEach(([id, data]) => {
    const expiresAt = data.expiresAt || (data.updatedAt || ts) + DEFAULT_TTL_MS;
    if (expiresAt <= ts) {
      store.delete(id);
      pending.delete(id);
      schedule(id);
    } else {
      nextExpiry = Math.min(nextExpiry, expiresAt);
    }
  });
  return Number.isFinite(nextExpiry) ? nextExpiry : undefined;
}

function cleanupExpired() {
  cleanupTimer = null;
  const nextExpiry = realtimeSweepExpiredEntries();
  if (nextExpiry !== undefined) {
    cleanupTimer = setTimeout(cleanupExpired, Math.max(1000, nextExpiry - now()));
  }
}

function ensureCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setTimeout(cleanupExpired, DEFAULT_TTL_MS);
}

function flush() {
  frame = null;
  const ids = Array.from(pending);
  pending.clear();
  for (const id of ids) {
    const listeners = subs.get(id);
    if (listeners) {
      listeners.forEach((fn) => fn());
    }
  }
}

function schedule(id: string) {
  pending.add(id);
  if (!frame) {
    frame = requestAnimationFrame(flush);
  }
}

export function realtimeAppend(id: string, patch: RealtimeAppendPatch) {
  if (!id) return;
  const prev = store.get(id) || { content: "" };

  if (typeof patch === "string") {
    setEntry(id, applyLegacyDelta(prev, patch));
    return;
  }

  const nextReasoning = patch.reasoning ?? prev.isReasoning ?? false;
  const contentDelta = patch.contentDelta ?? "";
  const answerDelta = patch.answerDelta ?? "";
  const reasoningDelta = patch.reasoningDelta ?? "";
  const currentAnswer = patch.replace ? "" : prev.answerContent ?? splitLegacyContent(prev.content || "").answerContent ?? "";
  const currentReasoning = patch.replace ? "" : prev.reasoningContent ?? splitLegacyContent(prev.content || "").reasoningContent ?? "";
  const wasReasoning = !!prev.isReasoning;
  const answerContent = currentAnswer + answerDelta + (nextReasoning ? "" : contentDelta);
  const reasoningContent = currentReasoning + reasoningDelta + (nextReasoning ? contentDelta : "");
  const visibleDelta = answerDelta || (!nextReasoning ? contentDelta : "");
  const shouldOpenReasoning = !!(reasoningDelta || (nextReasoning && contentDelta)) && !wasReasoning;
  const shouldCloseReasoning = wasReasoning && !nextReasoning;
  const structuredDelta = `${shouldOpenReasoning ? "<think>" : ""}${reasoningDelta || (nextReasoning ? contentDelta : "")}${shouldCloseReasoning ? "</think>" : ""}${visibleDelta}`;
  const content = patch.replace
    ? `${reasoningContent ? `<think>${reasoningContent}${nextReasoning ? "" : "</think>"}` : ""}${answerContent}`
    : `${prev.content || ""}${structuredDelta}`;

  setEntry(id, {
    content,
    answerContent,
    reasoningContent,
    isReasoning: nextReasoning,
    phase: nextReasoning ? "reasoning" : (answerContent.trim() ? "streaming_answer" : prev.phase),
  });
}

export function realtimeUpdate(id: string, patch: Partial<RealtimeData>) {
  if (!id) return;
  const normalized = { ...patch };
  if (typeof normalized.content === "string" && (normalized.answerContent === undefined || normalized.reasoningContent === undefined)) {
    Object.assign(normalized, splitLegacyContent(normalized.content));
  }
  setEntry(id, normalized);
}

export function realtimeAppendContent(id: string, text: string): void {
  realtimeAppend(id, { contentDelta: text, reasoning: false });
}

export function realtimeSetContent(id: string, content: string): void {
  realtimeUpdate(id, { content, answerContent: content, reasoningContent: "", isReasoning: false });
}

export function realtimeAppendReasoning(id: string, text: string): void {
  realtimeAppend(id, { reasoningDelta: text, reasoning: true });
}

export function realtimeSetReasoning(id: string, reasoning: string): void {
  const prev = store.get(id) || { content: "" };
  const answerContent = prev.answerContent ?? splitLegacyContent(prev.content || "").answerContent ?? "";
  realtimeUpdate(id, {
    content: `${reasoning ? `<think>${reasoning}${prev.isReasoning ? "" : "</think>"}` : ""}${answerContent}`,
    answerContent,
    reasoningContent: reasoning,
  });
}

export function realtimeSetPhase(id: string, phase: RuntimePhase): void {
  realtimeUpdate(id, { phase });
}

export function realtimeGet(id: string): RealtimeData | undefined {
  const data = store.get(id);
  if (!data) return undefined;
  if ((data.expiresAt || 0) <= now()) {
    store.delete(id);
    pending.delete(id);
    schedule(id);
    return undefined;
  }
  return data;
}

export function realtimeMarkCompleted(id: string, completedAt = now()) {
  if (!id) return;
  const prev = store.get(id);
  if (!prev) return;
  const terminalPhase = prev.phase === "failed" || prev.phase === "stopped" ? prev.phase : "completed";
  setEntry(id, {
    completedAt,
    phase: terminalPhase,
    activityStatus: undefined,
    searchStatus: prev.searchStatus === "searching" ? undefined : prev.searchStatus,
    isReasoning: false,
    expiresAt: completedAt + FINALIZING_HOLD_TTL_MS,
  });
}

export function realtimeClear(id: string) {
  const hadEntry = store.has(id);
  store.delete(id);
  pending.delete(id);
  if (pending.size === 0 && frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  if (store.size === 0 && cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
  // Keep existing subscribers. React useSyncExternalStore listeners are long-lived;
  // deleting the listener set here silently orphans mounted message rows, so later
  // realtimeUpdate/realtimeAppend calls no longer wake them up. That makes the
  // main answer path lag behind Activity even though both read the same store.
  if (hadEntry) schedule(id);
}

export function realtimeSubscribe(id: string, fn: () => void): () => void {
  let listeners = subs.get(id);
  if (!listeners) {
    listeners = new Set();
    subs.set(id, listeners);
  }
  listeners.add(fn);
  return () => {
    listeners?.delete(fn);
    if (listeners?.size === 0) {
      subs.delete(id);
    }
  };
}

export function realtimeDebugSnapshot(): Record<string, RealtimeData> {
  return Object.fromEntries(store.entries());
}
