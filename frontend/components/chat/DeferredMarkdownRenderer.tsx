"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const MarkdownRenderer = dynamic(() => import("./MarkdownRenderer"), {
  ssr: false,
  loading: () => <MarkdownFallback content="" loading />,
});

const DEFAULT_ROOT_MARGIN = "700px 0px";
const DEFAULT_IDLE_TIMEOUT = 600;

function MarkdownFallback({ content, loading }: { content: string; loading?: boolean }) {
  if (loading) {
    return <div className="h-5 w-32 rounded bg-surface-card animate-pulse" />;
  }

  return (
    <div
      data-i18n-skip="true"
      className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text-primary"
    >
      {content}
    </div>
  );
}

export function DeferredMarkdownRenderer({
  content,
  rootMargin = DEFAULT_ROOT_MARGIN,
  idleTimeout = DEFAULT_IDLE_TIMEOUT,
  keepRenderedOnContentChange = false,
  isStreaming = false,
}: {
  content: string;
  rootMargin?: string;
  idleTimeout?: number;
  keepRenderedOnContentChange?: boolean;
  isStreaming?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [shouldRenderMarkdown, setShouldRenderMarkdown] = useState(false);
  const hasRenderedMarkdownRef = useRef(false);

  useEffect(() => {
    if (shouldRenderMarkdown) {
      hasRenderedMarkdownRef.current = true;
    }
  }, [shouldRenderMarkdown]);

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

      if (win.requestIdleCallback) {
        const idleId = win.requestIdleCallback(() => {
          if (!cancelled) setShouldRenderMarkdown(true);
        }, { timeout: idleTimeout });
        return () => win.cancelIdleCallback?.(idleId);
      }

      const timeoutId = window.setTimeout(() => {
        if (!cancelled) setShouldRenderMarkdown(true);
      }, Math.min(idleTimeout, 120));
      return () => window.clearTimeout(timeoutId);
    };

    const startIdleRender = () => {
      cleanupIdle?.();
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
  }, [content, idleTimeout, keepRenderedOnContentChange, rootMargin]);

  return (
    <div ref={hostRef}>
      {shouldRenderMarkdown ? <MarkdownRenderer content={content} isStreaming={isStreaming} /> : <MarkdownFallback content={content} />}
    </div>
  );
}
