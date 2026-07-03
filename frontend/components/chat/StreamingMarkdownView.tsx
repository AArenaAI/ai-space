"use client";

import { memo } from "react";
import StableMarkdownRenderer from "./StableMarkdownRenderer";

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
  return (
    <div className={className} data-streaming-markdown-mode="stable">
      <StableMarkdownRenderer
        content={content}
        phase={isStreaming ? "streaming" : "completed-visible"}
        idleTimeout={idleTimeout}
        keepRenderedOnContentChange={keepRenderedOnContentChange}
      />
    </div>
  );
}

export default memo(StreamingMarkdownView);
