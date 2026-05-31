"use client";

import { memo, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { createMarkdownComponents } from "./markdown/markdownComponents";

const ReactMarkdown = dynamic(() => import("react-markdown"), { ssr: false });

type MarkdownPlugin = unknown;

interface MarkdownPlugins {
  remarkPlugins: MarkdownPlugin[];
  rehypePlugins: MarkdownPlugin[];
}

let cachedBasicPlugins: MarkdownPlugins | null = null;
let cachedMathPlugins: MarkdownPlugins | null = null;
let basicPluginPromise: Promise<MarkdownPlugins> | null = null;
let mathPluginPromise: Promise<MarkdownPlugins> | null = null;

function contentMayContainMath(content: string) {
  return /(^|[^\\])\$\$?[\s\S]*?\$\$?|\\\(|\\\)|\\\[|\\\]/.test(content);
}

function loadMarkdownPlugins(withMath: boolean) {
  if (withMath && cachedMathPlugins) return Promise.resolve(cachedMathPlugins);
  if (!withMath && cachedBasicPlugins) return Promise.resolve(cachedBasicPlugins);

  if (!basicPluginPromise) {
    basicPluginPromise = Promise.all([
      import("remark-gfm").then((mod) => mod.default),
      import("@/lib/remark-fix-bold").then((mod) => mod.default),
    ]).then(([remarkGfm, remarkFixBold]) => {
      cachedBasicPlugins = {
        remarkPlugins: [remarkGfm, remarkFixBold],
        rehypePlugins: [],
      };
      return cachedBasicPlugins;
    });
  }

  if (!withMath) return basicPluginPromise;

  if (!mathPluginPromise) {
    mathPluginPromise = Promise.all([
      basicPluginPromise,
      import("remark-math").then((mod) => mod.default),
      import("rehype-katex").then((mod) => mod.default),
    ]).then(([basic, remarkMath, rehypeKatex]) => {
      cachedMathPlugins = {
        remarkPlugins: [...basic.remarkPlugins, remarkMath],
        rehypePlugins: [rehypeKatex],
      };
      return cachedMathPlugins;
    });
  }
  return mathPluginPromise;
}

function MarkdownPlainFallback({ content }: { content: string }) {
  return (
    <div data-i18n-skip="true" className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text-primary">
      {content}
    </div>
  );
}

const MarkdownRenderer = memo(function MarkdownRenderer({ content, isStreaming = false }: { content: string; isStreaming?: boolean }) {
  const withMath = useMemo(() => contentMayContainMath(content), [content]);
  const [plugins, setPlugins] = useState<MarkdownPlugins | null>(() => (withMath ? cachedMathPlugins : cachedBasicPlugins));

  useEffect(() => {
    let cancelled = false;
    setPlugins(withMath ? cachedMathPlugins : cachedBasicPlugins);
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
