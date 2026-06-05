"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MarkdownLiteRenderer from "../MarkdownLiteRenderer";
import {
  getMarkdownTokenCacheKey,
  peekCachedMarkdownTokens,
} from "@/lib/markdown/markdownTokenCache";
import { tokenizeMarkdown } from "@/lib/markdown/markdownTokenize";
import { tokenizeMarkdownAsync } from "@/lib/markdown/markdownTokenWorkerClient";
import type { MarkdownTokenDocument } from "@/lib/markdown/markdownTokenTypes";
import MarkdownBlockTokenRenderer from "./MarkdownBlockTokenRenderer";
import { emitChatRenderProfileEvent } from "@/lib/chatRenderProfile";

const INITIAL_TOKEN_BLOCK_BUDGET = 32;
const TOKEN_BLOCK_BATCH_SIZE = 32;
const TOKEN_UPGRADE_HEIGHT_GUARD_MS = 1200;
const TOKEN_UPGRADE_BOTTOM_DISTANCE_THRESHOLD = 48;

function shouldSkipTokenUpgradeForUserBrowse() {
  if (typeof window !== "undefined") {
    const browseUntil = (window as Window & { __AI_SPACE_CHAT_USER_BROWSE_UNTIL?: number }).__AI_SPACE_CHAT_USER_BROWSE_UNTIL || 0;
    if (Date.now() < browseUntil) return true;
  }
  if (typeof document === "undefined") return false;
  const scroller = document.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]');
  if (!scroller) return false;
  const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  return distanceToBottom > TOKEN_UPGRADE_BOTTOM_DISTANCE_THRESHOLD;
}

export default function MarkdownTokenRenderer({
  content,
  compactPreview = true,
  isStreaming = false,
  messageId,
  priorityHydrateRichText = false,
}: {
  content: string;
  compactPreview?: boolean;
  isStreaming?: boolean;
  messageId?: string | number;
  priorityHydrateRichText?: boolean;
}) {
  const cacheKey = useMemo(() => getMarkdownTokenCacheKey({ content, compactPreview }), [compactPreview, content]);
  const rootRef = useRef<HTMLDivElement>(null);
  const heightGuardTimerRef = useRef<number | null>(null);
  const [doc, setDoc] = useState<MarkdownTokenDocument | null>(() => {
    const cached = peekCachedMarkdownTokens(cacheKey);
    if (cached && !isStreaming && !priorityHydrateRichText && shouldSkipTokenUpgradeForUserBrowse()) return null;
    if (!cached && priorityHydrateRichText && !isStreaming) {
      return tokenizeMarkdown({ content, compactPreview });
    }
    return cached;
  });
  const [renderedBlockCount, setRenderedBlockCount] = useState(INITIAL_TOKEN_BLOCK_BUDGET);
  const [guardMinHeight, setGuardMinHeight] = useState<number | null>(null);

  const applyTokenDocument = (next: MarkdownTokenDocument | null, guardHeight = false) => {
    if (next && !isStreaming && !priorityHydrateRichText && shouldSkipTokenUpgradeForUserBrowse()) {
      emitChatRenderProfileEvent("markdown-token-upgrade-skipped-browse", {
        compactPreview,
        contentLength: content.length,
        messageId,
        priority: priorityHydrateRichText,
      });
      setDoc(null);
      return;
    }
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
    const initialBlockCount = priorityHydrateRichText && !isStreaming
      ? Math.max(next?.tokens.length || INITIAL_TOKEN_BLOCK_BUDGET, 1)
      : Math.min(INITIAL_TOKEN_BLOCK_BUDGET, Math.max(next?.tokens.length || INITIAL_TOKEN_BLOCK_BUDGET, 1));
    setRenderedBlockCount(initialBlockCount);
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
    const parseDelay = isStreaming ? 360 : priorityHydrateRichText ? 0 : 1800;
    emitChatRenderProfileEvent("markdown-token-parse-scheduled", {
      compactPreview,
      contentLength: content.length,
      isStreaming,
      messageId,
      parseDelay,
      priority: priorityHydrateRichText,
    });
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
  }, [cacheKey, compactPreview, content, isStreaming, messageId, priorityHydrateRichText]);

  useEffect(() => {
    if (!doc || renderedBlockCount >= doc.tokens.length) return;
    let cancelled = false;
    const scheduleNextBatch = () => {
      window.setTimeout(() => {
        if (cancelled) return;
        if (!isStreaming && !priorityHydrateRichText && shouldSkipTokenUpgradeForUserBrowse()) {
          emitChatRenderProfileEvent("markdown-token-batch-skipped-browse", {
            blockCount: doc.tokens.length,
            compactPreview,
            contentLength: content.length,
            messageId,
            renderedBlockCount,
          });
          return;
        }
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
      messageId,
      parseMs: Number(doc.parseMs.toFixed(2)),
      renderedBlockCount,
      tokenizerSource: doc.tokenizerSource || "unknown",
      truncated: doc.truncated,
    });
  }, [compactPreview, content.length, doc, isStreaming, messageId, renderedBlockCount]);

  if (!doc) {
    return (
      <div ref={rootRef} data-markdown-token-renderer="deferred-lite">
        <MarkdownLiteRenderer content={content} compactPreview={compactPreview} isStreaming={isStreaming} messageId={messageId} />
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
