"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MarkdownLiteRenderer from "../MarkdownLiteRenderer";
import {
  getMarkdownTokenCacheKey,
  peekCachedMarkdownTokens,
} from "@/lib/markdown/markdownTokenCache";
import { tokenizeMarkdownAsync } from "@/lib/markdown/markdownTokenWorkerClient";
import type { MarkdownTokenDocument } from "@/lib/markdown/markdownTokenTypes";
import MarkdownBlockTokenRenderer from "./MarkdownBlockTokenRenderer";

const INITIAL_TOKEN_BLOCK_BUDGET = 32;
const TOKEN_BLOCK_BATCH_SIZE = 32;
const TOKEN_UPGRADE_HEIGHT_GUARD_MS = 1200;

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
  const rootRef = useRef<HTMLDivElement>(null);
  const heightGuardTimerRef = useRef<number | null>(null);
  const [doc, setDoc] = useState<MarkdownTokenDocument | null>(() => peekCachedMarkdownTokens(cacheKey));
  const [renderedBlockCount, setRenderedBlockCount] = useState(INITIAL_TOKEN_BLOCK_BUDGET);
  const [guardMinHeight, setGuardMinHeight] = useState<number | null>(null);

  const applyTokenDocument = (next: MarkdownTokenDocument | null, guardHeight = false) => {
    if (guardHeight) {
      const currentHeight = rootRef.current?.getBoundingClientRect().height || 0;
      if (currentHeight > 0) {
        setGuardMinHeight(currentHeight);
        if (heightGuardTimerRef.current !== null) window.clearTimeout(heightGuardTimerRef.current);
        heightGuardTimerRef.current = window.setTimeout(() => {
          heightGuardTimerRef.current = null;
          setGuardMinHeight(null);
        }, TOKEN_UPGRADE_HEIGHT_GUARD_MS);
      }
    }
    setRenderedBlockCount(Math.min(INITIAL_TOKEN_BLOCK_BUDGET, Math.max(next?.tokens.length || INITIAL_TOKEN_BLOCK_BUDGET, 1)));
    setDoc(next);
  };

  useEffect(() => {
    return () => {
      if (heightGuardTimerRef.current !== null) window.clearTimeout(heightGuardTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const cached = peekCachedMarkdownTokens(cacheKey);
    applyTokenDocument(cached);
    if (cached) return;

    let cancelled = false;
    const parseDelay = isStreaming ? 360 : 1800;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      tokenizeMarkdownAsync({ content, compactPreview }).then((next) => {
        if (!cancelled) applyTokenDocument(next, true);
      });
    }, parseDelay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cacheKey, compactPreview, content, isStreaming]);

  useEffect(() => {
    if (!doc || renderedBlockCount >= doc.tokens.length) return;
    let cancelled = false;
    const scheduleNextBatch = () => {
      window.setTimeout(() => {
        if (cancelled) return;
        setRenderedBlockCount((current) => Math.min(current + TOKEN_BLOCK_BATCH_SIZE, doc.tokens.length));
      }, 120);
    };
    scheduleNextBatch();
    return () => {
      cancelled = true;
    };
  }, [doc, renderedBlockCount]);

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
      renderedBlockCount,
      tokenizerSource: doc.tokenizerSource || "unknown",
      truncated: doc.truncated,
    });
  }, [compactPreview, content.length, doc, isStreaming, renderedBlockCount]);

  if (!doc) {
    return (
      <div ref={rootRef} data-markdown-token-renderer="deferred-lite">
        <MarkdownLiteRenderer content={content} compactPreview={compactPreview} isStreaming={isStreaming} />
      </div>
    );
  }

  const visibleTokens = doc.tokens.slice(0, renderedBlockCount);

  return (
    <div
      ref={rootRef}
      data-markdown-token-renderer={doc.truncated ? "preview" : "stable"}
      style={guardMinHeight ? { minHeight: `${Math.ceil(guardMinHeight)}px` } : undefined}
    >
      {visibleTokens.map((token, index) => <MarkdownBlockTokenRenderer key={index} token={token} />)}
    </div>
  );
}
