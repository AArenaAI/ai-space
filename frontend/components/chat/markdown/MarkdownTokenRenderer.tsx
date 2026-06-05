"use client";

import { useEffect, useMemo, useState } from "react";
import MarkdownLiteRenderer from "../MarkdownLiteRenderer";
import {
  getMarkdownTokenCacheKey,
  peekCachedMarkdownTokens,
} from "@/lib/markdown/markdownTokenCache";
import { tokenizeMarkdown } from "@/lib/markdown/markdownTokenize";
import type { MarkdownTokenDocument } from "@/lib/markdown/markdownTokenTypes";
import MarkdownBlockTokenRenderer from "./MarkdownBlockTokenRenderer";

function emitChatRenderProfileEvent(phase: string, detail: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const at = typeof performance !== "undefined" ? performance.now() : Date.now();
  window.dispatchEvent(new CustomEvent("chat-render-profile", {
    detail: { phase, at, ...detail },
  }));
}

export default function MarkdownTokenRenderer({
  content,
  compactPreview = true,
  isStreaming = false,
}: {
  content: string;
  compactPreview?: boolean;
  isStreaming?: boolean;
}) {
  const cacheKey = useMemo(() => getMarkdownTokenCacheKey({ content, compactPreview }), [compactPreview, content]);
  const [doc, setDoc] = useState<MarkdownTokenDocument | null>(() => peekCachedMarkdownTokens(cacheKey));

  useEffect(() => {
    const cached = peekCachedMarkdownTokens(cacheKey);
    setDoc(cached);
    if (cached) return;

    let cancelled = false;
    const parseDelay = isStreaming ? 360 : 1800;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const next = tokenizeMarkdown({ content, compactPreview });
      if (!cancelled) setDoc(next);
    }, parseDelay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cacheKey, compactPreview, content, isStreaming]);

  useEffect(() => {
    if (!doc) {
      emitChatRenderProfileEvent("markdown-token-deferred", {
        compactPreview,
        contentLength: content.length,
        isStreaming,
      });
      return;
    }
    emitChatRenderProfileEvent("markdown-token-rendered", {
      blockCount: doc.tokens.length,
      cacheHit: doc.cacheHit,
      compactPreview,
      contentLength: content.length,
      hasCode: doc.featureFlags.hasCode,
      hasLinks: doc.featureFlags.hasLinks,
      hasTable: doc.featureFlags.hasTable,
      isStreaming,
      parseMs: Number(doc.parseMs.toFixed(2)),
      truncated: doc.truncated,
    });
  }, [compactPreview, content.length, doc, isStreaming]);

  if (!doc) {
    return (
      <div data-markdown-token-renderer="deferred-lite">
        <MarkdownLiteRenderer content={content} compactPreview={compactPreview} isStreaming={isStreaming} />
      </div>
    );
  }

  return (
    <div data-markdown-token-renderer={doc.truncated ? "preview" : "stable"}>
      {doc.tokens.map((token, index) => <MarkdownBlockTokenRenderer key={index} token={token} />)}
    </div>
  );
}
