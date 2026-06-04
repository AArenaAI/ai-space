"use client";

import { useEffect } from "react";
import MarkdownLiteRenderer from "../MarkdownLiteRenderer";

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
  useEffect(() => {
    emitChatRenderProfileEvent("markdown-token-rendered", {
      compactPreview,
      contentLength: content.length,
      isStreaming,
    });
  }, [compactPreview, content.length, isStreaming]);

  return (
    <div data-markdown-token-renderer={compactPreview ? "preview" : "stable"}>
      <MarkdownLiteRenderer content={content} compactPreview={compactPreview} isStreaming={isStreaming} />
    </div>
  );
}
