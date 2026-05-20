type StreamingListener = (delta: string, full: string) => void;

const store = new Map<string, string>();
const subs = new Map<string, Set<StreamingListener>>();

export function streamAppend(messageId: string, delta: string): void {
  const prev = store.get(messageId) || "";
  const next = prev + delta;
  store.set(messageId, next);
  const listeners = subs.get(messageId);
  if (listeners) {
    listeners.forEach((fn) => {
      try {
        fn(delta, next);
      } catch {}
    });
  }
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
}
