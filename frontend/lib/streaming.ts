type StreamingListener = (delta: string, full: string) => void;

export type RealtimeData = {
  content: string;
  activityStatus?: { kind: string; status: string; label: string };
  searchStatus?: "searching" | "completed";
  searchSources?: any[];
  searchSourcesCount?: number;
  serverMessageId?: number;
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

const store = new Map<string, RealtimeData>();
const subs = new Map<string, Set<() => void>>();
const pending = new Set<string>();
let frame: ReturnType<typeof requestAnimationFrame> | null = null;

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

export function realtimeAppend(id: string, text: string) {
  const data = store.get(id);
  if (data) {
    data.content += text;
  } else {
    store.set(id, { content: text });
  }
  schedule(id);
}

export function realtimeUpdate(id: string, patch: Partial<RealtimeData>) {
  const data = store.get(id);
  if (data) {
    Object.assign(data, patch);
  } else {
    store.set(id, { content: "", ...patch });
  }
  schedule(id);
}

export function realtimeGet(id: string): RealtimeData | undefined {
  return store.get(id);
}

export function realtimeClear(id: string) {
  store.delete(id);
  subs.delete(id);
  pending.delete(id);
  if (pending.size === 0 && frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
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
export function streamAppend(id: string, delta: string): void {
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
  return store.get(messageId)?.content || "";
}

export function streamClear(messageId: string): void {
  realtimeClear(messageId);
}
