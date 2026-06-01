"use client";

import { memo, useMemo } from "react";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";
import MarkdownPlainFallback from "./markdown/MarkdownPlainFallback";

const STREAMING_COMPLEX_MARKDOWN_LENGTH_THRESHOLD = 2000;
const STREAMING_COMPLEX_LINE_THRESHOLD = 80;

function hasComplexMarkdownSyntax(content: string) {
  if (content.includes("```") || content.includes("~~~")) return true;
  if (/\n\s*\|[^\n]+\|\s*\n\s*\|[\s:|\-]+\|/.test(content)) return true;
  if (/(\$\$|\\\[|\\\(|\\begin\{)/.test(content)) return true;
  if (/\n\s*<(table|details|div|svg|iframe|pre|code)\b/i.test(content)) return true;
  if (/\n\s*```?(mermaid|chart|echarts|vega|graphviz)\b/i.test(content)) return true;
  return false;
}

function shouldUseStreamingPlainFallback(content: string) {
  if (!content) return false;
  if (content.length >= STREAMING_COMPLEX_MARKDOWN_LENGTH_THRESHOLD) return true;
  if (content.split("\n").length >= STREAMING_COMPLEX_LINE_THRESHOLD) return true;
  return hasComplexMarkdownSyntax(content);
}

export type StreamingMarkdownViewProps = {
  content: string;
  isStreaming: boolean;
  idleTimeout?: number;
  keepRenderedOnContentChange?: boolean;
  className?: string;
};

function StreamingMarkdownView({
  content,
  isStreaming,
  idleTimeout = 80,
  keepRenderedOnContentChange = true,
  className,
}: StreamingMarkdownViewProps) {
  const usePlainFallback = useMemo(() => isStreaming && shouldUseStreamingPlainFallback(content), [content, isStreaming]);

  if (usePlainFallback) {
    return (
      <div className={className} data-streaming-markdown-mode="plain">
        <MarkdownPlainFallback content={content} />
      </div>
    );
  }

  return (
    <div className={className} data-streaming-markdown-mode="rich">
      <DeferredMarkdownRenderer
        content={content}
        idleTimeout={idleTimeout}
        keepRenderedOnContentChange={keepRenderedOnContentChange}
        isStreaming={isStreaming}
      />
    </div>
  );
}

export default memo(StreamingMarkdownView);
