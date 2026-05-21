type StreamingListener = (delta: string, full: string) => void;

const store = new Map<string, string>();
const subs = new Map<string, Set<StreamingListener>>();

let pendingNotifyIds = new Set<string>();
let notifyFrame: ReturnType<typeof requestAnimationFrame> | null = null;

function flushNotify() {
  notifyFrame = null;
  const ids = Array.from(pendingNotifyIds);
  pendingNotifyIds.clear();
  for (const id of ids) {
    const full = store.get(id) || "";
    const listeners = subs.get(id);
    if (listeners) {
      listeners.forEach((fn) => {
        try {
          fn("", full);
        } catch {}
      });
    }
  }
}

function scheduleNotify(id: string) {
  pendingNotifyIds.add(id);
  if (notifyFrame === null) {
    notifyFrame = requestAnimationFrame(flushNotify);
  }
}

export function streamAppend(messageId: string, delta: string): void {
  const prev = store.get(messageId) || "";
  const next = prev + delta;
  store.set(messageId, next);
  scheduleNotify(messageId);
}

export function streamSubscribe(messageId: string, fn: StreamingListener): () => void {
  if (!subs.has(messageId)) subs.set(messageId, new Set());
  subs.get(messageId)!.add(fn);
  return () => subs.get(messageId)?.delete(fn);
}

export function streamGet(messageId: string): string {
  return store.get(messageId) || "";
}

export function streamClear(messageId: string): void {
  store.delete(messageId);
  subs.delete(messageId);
  pendingNotifyIds.delete(messageId);
  if (pendingNotifyIds.size === 0 && notifyFrame !== null) {
    cancelAnimationFrame(notifyFrame);
    notifyFrame = null;
  }
}
