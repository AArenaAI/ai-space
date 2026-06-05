import type { MarkdownTokenDocument } from "./markdownTokenTypes";
import { getMarkdownTokenCacheKey, peekCachedMarkdownTokens, setCachedMarkdownTokens } from "./markdownTokenCache";
import { tokenizeMarkdown } from "./markdownTokenize";

let worker: Worker | null = null;
let requestSeq = 0;
const pending = new Map<number, { cacheKey: string; resolve: (doc: MarkdownTokenDocument) => void; reject: (error: Error) => void; timer: number }>();
const inFlightByCacheKey = new Map<string, Promise<MarkdownTokenDocument>>();

function getMarkdownTokenWorker() {
  if (typeof window === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("../../workers/markdownTokenWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; doc?: MarkdownTokenDocument; error?: string }>) => {
      const { id, ok, doc, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      inFlightByCacheKey.delete(entry.cacheKey);
      window.clearTimeout(entry.timer);
      if (ok && doc) {
        const workerDoc = { ...doc, tokenizerSource: "worker" as const };
        setCachedMarkdownTokens(entry.cacheKey, workerDoc);
        entry.resolve(workerDoc);
      } else {
        entry.reject(new Error(error || "Markdown token worker failed"));
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "Markdown token worker error");
      pending.forEach((entry) => {
        window.clearTimeout(entry.timer);
        inFlightByCacheKey.delete(entry.cacheKey);
        entry.reject(error);
      });
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

export function tokenizeMarkdownAsync({ content, compactPreview }: { content: string; compactPreview: boolean }): Promise<MarkdownTokenDocument> {
  const cacheKey = getMarkdownTokenCacheKey({ content, compactPreview });
  const inFlight = inFlightByCacheKey.get(cacheKey);
  if (inFlight) return inFlight;

  const markdownWorker = getMarkdownTokenWorker();
  if (!markdownWorker || typeof window === "undefined") {
    return Promise.resolve(tokenizeMarkdown({ content, compactPreview }));
  }

  const id = ++requestSeq;
  const request = new Promise<MarkdownTokenDocument>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      inFlightByCacheKey.delete(cacheKey);
      reject(new Error("Markdown token worker timed out"));
    }, 6_000);
    pending.set(id, { cacheKey, resolve, reject, timer });
    markdownWorker.postMessage({ id, content, compactPreview });
  }).catch(() => tokenizeMarkdown({ content, compactPreview }));
  inFlightByCacheKey.set(cacheKey, request);
  return request;
}

export function preheatMarkdownTokens({ content, compactPreview }: { content: string; compactPreview: boolean }): void {
  if (typeof window === "undefined" || !content.trim()) return;
  const cacheKey = getMarkdownTokenCacheKey({ content, compactPreview });
  if (peekCachedMarkdownTokens(cacheKey)) return;
  if (inFlightByCacheKey.has(cacheKey)) return;
  window.setTimeout(() => {
    tokenizeMarkdownAsync({ content, compactPreview }).catch(() => undefined);
  }, 0);
}
