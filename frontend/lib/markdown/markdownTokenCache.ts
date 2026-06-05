import type { MarkdownTokenDocument } from "./markdownTokenTypes";

const TOKEN_CACHE_LIMIT = 128;
const tokenCache = new Map<string, MarkdownTokenDocument>();

export function hashMarkdownContent(content: string) {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function getMarkdownTokenCacheKey({
  content,
  compactPreview,
}: {
  content: string;
  compactPreview: boolean;
}) {
  return `${compactPreview ? "preview" : "stable"}:${hashMarkdownContent(content)}:${content.length}`;
}

export function getCachedMarkdownTokens(key: string) {
  const cached = tokenCache.get(key);
  if (!cached) return null;
  tokenCache.delete(key);
  tokenCache.set(key, cached);
  return { ...cached, cacheHit: true, parseMs: 0 };
}

export function peekCachedMarkdownTokens(key: string) {
  const cached = tokenCache.get(key);
  if (!cached) return null;
  return { ...cached, cacheHit: true, parseMs: 0 };
}

export function setCachedMarkdownTokens(key: string, doc: MarkdownTokenDocument) {
  tokenCache.set(key, { ...doc, cacheHit: false });
  while (tokenCache.size > TOKEN_CACHE_LIMIT) {
    const oldest = tokenCache.keys().next().value;
    if (!oldest) break;
    tokenCache.delete(oldest);
  }
}
