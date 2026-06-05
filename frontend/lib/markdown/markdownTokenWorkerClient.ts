import type { MarkdownTokenDocument } from "./markdownTokenTypes";
import { getMarkdownTokenCacheKey, setCachedMarkdownTokens } from "./markdownTokenCache";
import { tokenizeMarkdown } from "./markdownTokenize";

let worker: Worker | null = null;
let requestSeq = 0;
const pending = new Map<number, { cacheKey: string; resolve: (doc: MarkdownTokenDocument) => void; reject: (error: Error) => void; timer: number }>();

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
  const markdownWorker = getMarkdownTokenWorker();
  if (!markdownWorker || typeof window === "undefined") {
    return Promise.resolve(tokenizeMarkdown({ content, compactPreview }));
  }

  const id = ++requestSeq;
  const cacheKey = getMarkdownTokenCacheKey({ content, compactPreview });
  return new Promise<MarkdownTokenDocument>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error("Markdown token worker timed out"));
    }, 6_000);
    pending.set(id, { cacheKey, resolve, reject, timer });
    markdownWorker.postMessage({ id, content, compactPreview });
  }).catch(() => tokenizeMarkdown({ content, compactPreview }));
}
