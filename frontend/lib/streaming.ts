type StreamingListener = (delta: string, full: string) => void;

export type RealtimeActivityStatus = { kind: string; status: string; label: string };

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
  activityStatus?: RealtimeActivityStatus;
  searchStatus?: "searching" | "completed";
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
  const next: RealtimeData = immutable({
    ...prev,
    ...patch,
    content: patch.content ?? prev.content ?? "",
    version: ++versionCounter,
    updatedAt: ts,
    expiresAt: ts + ttlFor({ ...prev, ...patch }),
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

function cleanupExpired() {
  cleanupTimer = null;
  const ts = now();
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
  if (Number.isFinite(nextExpiry)) {
    cleanupTimer = setTimeout(cleanupExpired, Math.max(1000, nextExpiry - ts));
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

export function realtimeClear(id: string) {
  store.delete(id);
  subs.delete(id);
  pending.delete(id);
  if (pending.size === 0 && frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  if (store.size === 0 && cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
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

// 兼容旧 API，基于新 API 实现
export function streamAppend(id: string, delta: RealtimeAppendPatch): void {
  realtimeAppend(id, delta);
}

export function streamSubscribe(messageId: string, fn: StreamingListener): () => void {
  let lastContent = streamGet(messageId);
  const wrapper = () => {
    const current = streamGet(messageId);
    if (current !== lastContent) {
      const delta = current.slice(lastContent.length);
      lastContent = current;
      fn(delta, current);
    }
  };
  return realtimeSubscribe(messageId, wrapper);
}

export function streamGet(messageId: string): string {
  return realtimeGet(messageId)?.content || "";
}

export function streamClear(messageId: string): void {
  realtimeClear(messageId);
}

export function realtimeDebugSnapshot(): Record<string, RealtimeData> {
  return Object.fromEntries(store.entries());
}
