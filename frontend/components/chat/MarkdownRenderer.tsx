"use client";

import { memo, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { createMarkdownComponents } from "./markdown/markdownComponents";
import MarkdownPlainFallback from "./markdown/MarkdownPlainFallback";
import {
  contentMayContainMath,
  getCachedMarkdownPlugins,
  loadMarkdownPlugins,
  type MarkdownPlugins,
} from "./markdown/markdownPlugins";

const ReactMarkdown = dynamic(() => import("react-markdown"), { ssr: false });

const MarkdownRenderer = memo(function MarkdownRenderer({ content, isStreaming = false }: { content: string; isStreaming?: boolean }) {
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

  const markdownComponents = useMemo(() => createMarkdownComponents({ isStreaming }), [isStreaming]);

  if (!plugins) {
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
