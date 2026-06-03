"use client";

import { memo, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { createMarkdownComponents } from "./markdown/markdownComponents";
import MarkdownPlainFallback from "./markdown/MarkdownPlainFallback";
import {
  contentMayContainMath,
  getCachedMarkdownPlugins,
  loadMarkdownPlugins,
  type MarkdownPlugins,
} from "./markdown/markdownPlugins";

const MarkdownRenderer = memo(function MarkdownRenderer({ content, isStreaming = false, priorityHydrateRichText = false }: { content: string; isStreaming?: boolean; priorityHydrateRichText?: boolean }) {
  const withMath = useMemo(() => contentMayContainMath(content), [content]);
  const [plugins, setPlugins] = useState<MarkdownPlugins | null>(() => getCachedMarkdownPlugins(withMath));

  useEffect(() => {
    let cancelled = false;
    setPlugins(getCachedMarkdownPlugins(withMath));
    loadMarkdownPlugins(withMath).then((next) => {
      if (!cancelled) setPlugins(next);
    });
    return () => {
      cancelled = true;
    };
  }, [withMath]);

  const markdownComponents = useMemo(() => createMarkdownComponents({ isStreaming, lightweight: !plugins && priorityHydrateRichText }), [isStreaming, plugins, priorityHydrateRichText]);

  if (!plugins) {
    if (priorityHydrateRichText) {
      return (
        <ReactMarkdown components={markdownComponents}>
          {content}
        </ReactMarkdown>
      );
    }
    return <MarkdownPlainFallback content={content} />;
  }

  return (
    <ReactMarkdown
      remarkPlugins={plugins.remarkPlugins as any}
      rehypePlugins={plugins.rehypePlugins as any}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
});

export default MarkdownRenderer;
