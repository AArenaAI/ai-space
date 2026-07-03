"use client";

import { useMemo } from "react";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";
import MarkdownPlainFallback from "./markdown/MarkdownPlainFallback";
import MarkdownTokenRenderer from "./markdown/MarkdownTokenRenderer";

export type StableMarkdownPhase = "streaming" | "settling" | "completed-visible" | "historical";
export type StableMarkdownPolicy = "plain" | "token" | "rich-deferred";

const COMPLEX_STREAMING_LENGTH_THRESHOLD = 2000;
const COMPLEX_STREAMING_LINE_THRESHOLD = 80;

function hasComplexMarkdownSyntax(content: string) {
  if (content.includes("```") || content.includes("~~~")) return true;
  if (/\n\s*\|[^\n]+\|\s*\n\s*\|[\s:|\-]+\|/.test(content)) return true;
  if (/(\$\$|\\\[|\\\(|\\begin\{)/.test(content)) return true;
  if (/\n\s*<(table|details|div|svg|iframe|pre|code)\b/i.test(content)) return true;
  if (/\n\s*```?(mermaid|chart|echarts|vega|graphviz)\b/i.test(content)) return true;
  return false;
}

function shouldUsePlainDuringStreaming(content: string) {
  if (!content) return false;
  if (content.length >= COMPLEX_STREAMING_LENGTH_THRESHOLD) return true;
  if (content.split("\n").length >= COMPLEX_STREAMING_LINE_THRESHOLD) return true;
  return hasComplexMarkdownSyntax(content);
}

function resolveStableMarkdownPolicy({
  content,
  phase,
  policy,
}: {
  content: string;
  phase: StableMarkdownPhase;
  policy?: StableMarkdownPolicy;
}): StableMarkdownPolicy {
  if (policy) return policy;
  if (phase === "streaming" && shouldUsePlainDuringStreaming(content)) return "plain";
  return "token";
}

export default function StableMarkdownRenderer({
  content,
  phase,
  policy,
  idleTimeout = 80,
  keepRenderedOnContentChange = true,
  className,
  messageId,
  shouldHydrateRichText = true,
  priorityHydrateRichText = false,
  allowRichLiteFallback = false,
  compactRichLitePreview = true,
}: {
  content: string;
  phase: StableMarkdownPhase;
  policy?: StableMarkdownPolicy;
  idleTimeout?: number;
  keepRenderedOnContentChange?: boolean;
  className?: string;
  messageId?: string | number;
  shouldHydrateRichText?: boolean;
  priorityHydrateRichText?: boolean;
  allowRichLiteFallback?: boolean;
  compactRichLitePreview?: boolean;
}) {
  const resolvedPolicy = useMemo(() => resolveStableMarkdownPolicy({ content, phase, policy }), [content, phase, policy]);
  const isStreamingLike = resolvedPolicy === "rich-deferred"
    ? phase === "streaming" || phase === "settling" || phase === "completed-visible"
    : phase === "streaming";
  const shouldPriorityTokenize = resolvedPolicy === "token" && phase !== "streaming";

  if (resolvedPolicy === "plain") {
    return (
      <div
        className={className}
        data-stable-markdown-renderer="true"
        data-stable-markdown-phase={phase}
        data-stable-markdown-policy="plain"
      >
        <MarkdownPlainFallback content={content} messageId={messageId} />
      </div>
    );
  }

  if (resolvedPolicy === "token") {
    return (
      <div
        className={className}
        data-stable-markdown-renderer="true"
        data-stable-markdown-phase={phase}
        data-stable-markdown-policy="token"
      >
        <MarkdownTokenRenderer
          content={content}
          compactPreview={compactRichLitePreview}
          isStreaming={isStreamingLike}
          messageId={messageId}
          priorityHydrateRichText={shouldPriorityTokenize}
        />
      </div>
    );
  }

  return (
    <div
      className={className}
      data-stable-markdown-renderer="true"
      data-stable-markdown-phase={phase}
      data-stable-markdown-policy={resolvedPolicy}
    >
      <DeferredMarkdownRenderer
        content={content}
        idleTimeout={idleTimeout}
        keepRenderedOnContentChange={keepRenderedOnContentChange}
        isStreaming={isStreamingLike}
        messageId={messageId}
        shouldHydrateRichText={resolvedPolicy === "rich-deferred" ? shouldHydrateRichText : true}
        priorityHydrateRichText={resolvedPolicy === "rich-deferred" ? priorityHydrateRichText : shouldPriorityTokenize}
        allowRichLiteFallback={resolvedPolicy === "rich-deferred" ? allowRichLiteFallback : true}
        compactRichLitePreview={compactRichLitePreview}
      />
    </div>
  );
}
