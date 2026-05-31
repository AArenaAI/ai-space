"use client";

import { memo, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import CodeBlock from "./markdown/CodeBlock";

const ReactMarkdown = dynamic(() => import("react-markdown"), { ssr: false });
const LazyEChartsBlock = dynamic(() => import("./EChartsBlock"), {
  ssr: false,
  loading: () => <div className="my-4 h-48 rounded-xl border border-surface-border bg-surface-card animate-pulse" />,
});

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

  const markdownComponents = useMemo(() => ({
    pre({ children }: any) {
      // Block code is rendered by the custom `code` component below.  If we let
      // react-markdown keep its default `<pre>` wrapper around that component,
      // the DOM becomes `<pre><div class="code-block"><pre>...</pre></div></pre>`:
      // visually this appears as a code block nested inside another code block.
      return <>{children}</>;
    },
    code({ inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || "");
      const lang = match?.[1] || "";
      const value = String(children).replace(/\n$/, "");
      if (!inline && lang === "echarts" && !isStreaming) {
        return <LazyEChartsBlock value={value} />;
      }
      return !inline && match ? (
        <CodeBlock language={lang} value={value} />
      ) : (
        <code className="bg-[#E8E8E8] dark:bg-[#2A2A3A] text-[#333333] dark:text-[#E0E0E0] px-1 py-0.5 rounded text-[13px] font-mono" {...props}>
          {children}
        </code>
      );
    },
    p({ children }: any) { return <p className="text-[15px] leading-relaxed text-text-primary mb-4 last:mb-0 [li>&]:inline [li>&]:mb-0 [.reasoning-markdown_&]:text-[13px] [.reasoning-markdown_&]:text-text-secondary [.streaming-answer-markdown_&]:mb-0">{children}</p>; },
    ul({ children }: any) { return <ul className="list-disc ml-5 mb-4 space-y-1 text-text-primary">{children}</ul>; },
    ol({ children }: any) { return <ol className="list-decimal ml-5 mb-4 space-y-1 text-text-primary">{children}</ol>; },
    li({ children }: any) { return <li className="text-[15px] leading-relaxed">{children}</li>; },
    h1({ children }: any) { return <h1 className="text-xl font-semibold text-text-primary mb-3 mt-6">{children}</h1>; },
    h2({ children }: any) { return <h2 className="text-lg font-semibold text-text-primary mb-2 mt-5">{children}</h2>; },
    h3({ children }: any) { return <h3 className="text-base font-semibold text-text-primary mb-2 mt-4">{children}</h3>; },
    strong({ children }: any) { return <strong className="font-semibold text-text-primary [.reasoning-markdown_&]:text-text-secondary">{children}</strong>; },
    blockquote({ children }: any) { return <blockquote className="border-l-2 border-surface-border pl-4 italic text-text-secondary my-4">{children}</blockquote>; },
    table({ children }: any) { return <div className="overflow-x-auto my-4"><table className="w-full text-sm border-collapse">{children}</table></div>; },
    thead({ children }: any) { return <thead className="bg-surface-card border-b border-surface-border">{children}</thead>; },
    tbody({ children }: any) { return <tbody>{children}</tbody>; },
    tr({ children }: any) { return <tr className="border-b border-surface-border/50 hover:bg-surface-card/30 transition-colors">{children}</tr>; },
    th({ children }: any) { return <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-text-primary whitespace-nowrap">{children}</th>; },
    td({ children }: any) { return <td className="px-3 py-2.5 text-[13px] text-text-secondary leading-relaxed">{children}</td>; },
  }), [isStreaming]);

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
