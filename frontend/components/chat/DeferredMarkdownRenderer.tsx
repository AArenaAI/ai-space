"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import MarkdownPlainFallback from "./markdown/MarkdownPlainFallback";

type MarkdownRendererProps = { content: string; isStreaming?: boolean };

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

const DEFAULT_ROOT_MARGIN = "700px 0px";
const DEFAULT_IDLE_TIMEOUT = 600;

function MarkdownFallback({ content, loading }: { content: string; loading?: boolean }) {
  if (loading) {
    return <div className="h-5 w-32 rounded bg-surface-card animate-pulse" />;
  }

  return <MarkdownPlainFallback content={content} />;
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
      {shouldRenderMarkdown && Renderer ? <Renderer content={content} isStreaming={isStreaming} /> : <MarkdownFallback content={content} />}
    </div>
  );
}
