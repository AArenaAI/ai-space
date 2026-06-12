"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import MarkdownPlainFallback from "./markdown/MarkdownPlainFallback";
import MarkdownTokenRenderer from "./markdown/MarkdownTokenRenderer";
import MarkdownLiteRenderer from "./MarkdownLiteRenderer";
import { emitChatRenderProfileEvent } from "@/lib/chatRenderProfile";

type MarkdownRendererProps = { content: string; isStreaming?: boolean; priorityHydrateRichText?: boolean; messageId?: string | number };

let markdownRendererPromise: Promise<{ default: ComponentType<MarkdownRendererProps> }> | null = null;
let MarkdownRendererModule: ComponentType<MarkdownRendererProps> | null = null;

function loadMarkdownRenderer() {
  if (!markdownRendererPromise) {
    markdownRendererPromise = import("./MarkdownRenderer").then((module) => {
      MarkdownRendererModule = module.default;
      return { default: module.default as ComponentType<MarkdownRendererProps> };
    });
  }
  return markdownRendererPromise;
}

const DEFAULT_ROOT_MARGIN = "180px 0px";
const DEFAULT_IDLE_TIMEOUT = 900;
const FIRST_MARKDOWN_CHUNK_HYDRATION_DELAY_MS = 1_800;
const PRIORITY_MARKDOWN_HYDRATION_DELAY_MS = 0;
const HEAVY_MARKDOWN_HYDRATION_DELAY_MS = 2_500;
const EXTREME_MARKDOWN_HYDRATION_DELAY_MS = 15_000;
const HEAVY_MARKDOWN_LENGTH_THRESHOLD = 1_000;
const HEAVY_MARKDOWN_CODE_BLOCK_THRESHOLD = 3;
const HEAVY_MARKDOWN_TABLE_LINE_THRESHOLD = 7;
const EXTREME_MARKDOWN_LENGTH_THRESHOLD = 10_000;
const EXTREME_MARKDOWN_CODE_BLOCK_THRESHOLD = 20;
const EXTREME_MARKDOWN_TABLE_LINE_THRESHOLD = 100;
let markdownHydrationSequence = 0;
let heavyMarkdownHydrationSequence = 0;

function nextMarkdownHydrationDelay() {
  markdownHydrationSequence = (markdownHydrationSequence + 1) % 6;
  return markdownHydrationSequence * 70;
}

function nextHeavyMarkdownHydrationDelay() {
  heavyMarkdownHydrationSequence = (heavyMarkdownHydrationSequence + 1) % 12;
  return heavyMarkdownHydrationSequence * 250;
}

function getMarkdownComplexity(content: string) {
  const codeFenceCount = content.match(/```/g)?.length || 0;
  const codeBlocks = Math.floor(codeFenceCount / 2);
  const tableLines = content.split("\n").filter((line) => /^\s*\|.+\|\s*$/.test(line)).length;
  const isHeavy =
    content.length > HEAVY_MARKDOWN_LENGTH_THRESHOLD ||
    codeBlocks >= HEAVY_MARKDOWN_CODE_BLOCK_THRESHOLD ||
    tableLines >= HEAVY_MARKDOWN_TABLE_LINE_THRESHOLD;
  const isExtreme =
    content.length > EXTREME_MARKDOWN_LENGTH_THRESHOLD ||
    codeBlocks >= EXTREME_MARKDOWN_CODE_BLOCK_THRESHOLD ||
    tableLines >= EXTREME_MARKDOWN_TABLE_LINE_THRESHOLD;
  return { codeBlocks, isExtreme, isHeavy, tableLines };
}

function shouldUseRichLiteFallback(content: string, complexity: ReturnType<typeof getMarkdownComplexity>) {
  return content.length <= 500 && complexity.codeBlocks === 0 && complexity.tableLines === 0;
}

function MarkdownFallback({ content, loading, compactPreview = true, messageId }: { content: string; loading?: boolean; compactPreview?: boolean; messageId?: string | number }) {
  if (loading) {
    return <div className="h-5 w-32 rounded bg-surface-card animate-pulse" />;
  }

  return <MarkdownPlainFallback content={content} compactPreview={compactPreview} messageId={messageId} />;
}

export function DeferredMarkdownRenderer({
  content,
  shouldHydrateRichText = true,
  priorityHydrateRichText = false,
  rootMargin = DEFAULT_ROOT_MARGIN,
  idleTimeout = DEFAULT_IDLE_TIMEOUT,
  keepRenderedOnContentChange = false,
  isStreaming = false,
  allowRichLiteFallback = false,
  compactRichLitePreview = true,
  messageId,
}: {
  content: string;
  shouldHydrateRichText?: boolean;
  priorityHydrateRichText?: boolean;
  rootMargin?: string;
  idleTimeout?: number;
  keepRenderedOnContentChange?: boolean;
  isStreaming?: boolean;
  allowRichLiteFallback?: boolean;
  compactRichLitePreview?: boolean;
  messageId?: string | number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const complexity = useMemo(() => getMarkdownComplexity(content), [content]);
  const [shouldRenderMarkdown, setShouldRenderMarkdown] = useState(false);
  const [guardMinHeight, setGuardMinHeight] = useState<number | null>(null);
  const [Renderer, setRenderer] = useState(() => MarkdownRendererModule);
  const hasRenderedMarkdownRef = useRef(false);

  useEffect(() => {
    if (!shouldRenderMarkdown || Renderer) return;
    let cancelled = false;
    loadMarkdownRenderer().then((module) => {
      if (!cancelled) setRenderer(() => module.default);
    });
    return () => {
      cancelled = true;
    };
  }, [Renderer, shouldRenderMarkdown]);

  useEffect(() => {
    if (shouldRenderMarkdown) {
      hasRenderedMarkdownRef.current = true;
      emitChatRenderProfileEvent("markdown-hydrate-start", {
        contentLength: content.length,
      });
    }
  }, [content.length, shouldRenderMarkdown]);

  useEffect(() => {
    if (keepRenderedOnContentChange && hasRenderedMarkdownRef.current) {
      if (!content) {
        hasRenderedMarkdownRef.current = false;
        setShouldRenderMarkdown(false);
      } else {
        setShouldRenderMarkdown(true);
      }
      return;
    }

    if (!shouldHydrateRichText) {
      if (!hasRenderedMarkdownRef.current) setShouldRenderMarkdown(false);
      emitChatRenderProfileEvent("markdown-hydrate-waiting-for-viewport", {
        contentLength: content.length,
        codeBlocks: complexity.codeBlocks,
        tableLines: complexity.tableLines,
      });
      return;
    }

    if (priorityHydrateRichText && !isStreaming && !complexity.isExtreme) {
      if (!hasRenderedMarkdownRef.current) setShouldRenderMarkdown(false);
      emitChatRenderProfileEvent("markdown-hydrate-stable-priority-lite", {
        contentLength: content.length,
        codeBlocks: complexity.codeBlocks,
        tableLines: complexity.tableLines,
      });
      return;
    }

    if (allowRichLiteFallback && complexity.isHeavy && !isStreaming) {
      if (!hasRenderedMarkdownRef.current) setShouldRenderMarkdown(false);
      emitChatRenderProfileEvent("markdown-hydrate-stable-rich-lite", {
        contentLength: content.length,
        codeBlocks: complexity.codeBlocks,
        tableLines: complexity.tableLines,
      });
      return;
    }

    setShouldRenderMarkdown(false);
    if (!content) {
      hasRenderedMarkdownRef.current = false;
      return;
    }

    const node = hostRef.current;
    if (!node) return;

    let cancelled = false;
    let cleanupIdle: void | (() => void);

    const renderWhenIdle = () => {
      const win = window as typeof window & {
        requestIdleCallback?: (cb: IdleRequestCallback, options?: IdleRequestOptions) => number;
        cancelIdleCallback?: (handle: number) => void;
      };
      let staggerTimer: number | undefined;
      const markReady = () => {
        const staggerMs = priorityHydrateRichText ? nextMarkdownHydrationDelay() : complexity.isHeavy ? nextHeavyMarkdownHydrationDelay() : nextMarkdownHydrationDelay();
        emitChatRenderProfileEvent("markdown-hydrate-scheduled", {
          contentLength: content.length,
          codeBlocks: complexity.codeBlocks,
          priority: priorityHydrateRichText,
          staggerMs,
          tableLines: complexity.tableLines,
        });
        staggerTimer = window.setTimeout(() => {
          if (!cancelled) {
            const currentHeight = hostRef.current?.getBoundingClientRect().height || 0;
            if (!priorityHydrateRichText && currentHeight > 0) {
              setGuardMinHeight(currentHeight);
            }
            setShouldRenderMarkdown(true);
          }
        }, staggerMs);
      };

      if (win.requestIdleCallback) {
        const idleId = win.requestIdleCallback(markReady, { timeout: idleTimeout });
        return () => {
          win.cancelIdleCallback?.(idleId);
          if (staggerTimer !== undefined) window.clearTimeout(staggerTimer);
        };
      }

      const timeoutId = window.setTimeout(markReady, Math.min(idleTimeout, 180));
      return () => {
        window.clearTimeout(timeoutId);
        if (staggerTimer !== undefined) window.clearTimeout(staggerTimer);
      };
    };

    const startIdleRender = () => {
      cleanupIdle?.();
      const initialDelayMs = complexity.isHeavy
        ? complexity.isExtreme
          ? EXTREME_MARKDOWN_HYDRATION_DELAY_MS
          : HEAVY_MARKDOWN_HYDRATION_DELAY_MS
        : priorityHydrateRichText || MarkdownRendererModule
          ? PRIORITY_MARKDOWN_HYDRATION_DELAY_MS
          : FIRST_MARKDOWN_CHUNK_HYDRATION_DELAY_MS;
      if (initialDelayMs > 0) {
        emitChatRenderProfileEvent(complexity.isHeavy ? "markdown-hydrate-delayed-heavy" : "markdown-hydrate-delayed-first-chunk", {
          contentLength: content.length,
          codeBlocks: complexity.codeBlocks,
          delayMs: initialDelayMs,
          isExtreme: complexity.isExtreme,
          priority: priorityHydrateRichText,
          tableLines: complexity.tableLines,
        });
        let delayTimer: number | undefined = window.setTimeout(() => {
          delayTimer = undefined;
          if (!cancelled) cleanupIdle = renderWhenIdle();
        }, initialDelayMs);
        cleanupIdle = () => {
          if (delayTimer !== undefined) window.clearTimeout(delayTimer);
        };
        return;
      }
      cleanupIdle = renderWhenIdle();
    };

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          startIdleRender();
          observer.disconnect();
        }
      }, { rootMargin });

      observer.observe(node);
      return () => {
        cancelled = true;
        observer.disconnect();
        cleanupIdle?.();
      };
    }

    startIdleRender();
    return () => {
      cancelled = true;
      cleanupIdle?.();
    };
  }, [allowRichLiteFallback, complexity.codeBlocks, complexity.isExtreme, complexity.isHeavy, complexity.tableLines, content, idleTimeout, isStreaming, keepRenderedOnContentChange, priorityHydrateRichText, rootMargin, shouldHydrateRichText]);

  return (
    <div ref={hostRef} style={guardMinHeight !== null ? { minHeight: guardMinHeight } : undefined}>
      {shouldRenderMarkdown && Renderer ? (
        <Renderer content={content} isStreaming={isStreaming} priorityHydrateRichText={priorityHydrateRichText} messageId={messageId} />
      ) : priorityHydrateRichText && !isStreaming && !complexity.isExtreme ? (
        <MarkdownLiteRenderer content={content} compactPreview={false} disablePreview messageId={messageId} />
      ) : priorityHydrateRichText || allowRichLiteFallback || shouldUseRichLiteFallback(content, complexity) ? (
        <MarkdownTokenRenderer content={content} isStreaming={isStreaming} compactPreview={priorityHydrateRichText ? false : compactRichLitePreview} messageId={messageId} priorityHydrateRichText={priorityHydrateRichText} />
      ) : (
        <MarkdownFallback content={content} compactPreview={compactRichLitePreview} messageId={messageId} />
      )}
    </div>
  );
}
