"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

const ReactMarkdown = dynamic(() => import("react-markdown"), { ssr: false });
const LazySyntaxHighlighter = dynamic(() => import("./LazySyntaxHighlighter"), {
  ssr: false,
  loading: () => null,
});
const LazyEChartsBlock = dynamic(() => import("./EChartsBlock"), {
  ssr: false,
  loading: () => <div className="my-4 h-48 rounded-xl border border-surface-border bg-surface-card animate-pulse" />,
});

type MarkdownPlugin = unknown;

interface MarkdownPlugins {
  remarkPlugins: MarkdownPlugin[];
  rehypePlugins: MarkdownPlugin[];
}

let cachedPlugins: MarkdownPlugins | null = null;
let pluginPromise: Promise<MarkdownPlugins> | null = null;

function loadMarkdownPlugins() {
  if (cachedPlugins) return Promise.resolve(cachedPlugins);
  if (!pluginPromise) {
    pluginPromise = Promise.all([
      import("remark-gfm").then((mod) => mod.default),
      import("@/lib/remark-fix-bold").then((mod) => mod.default),
      import("remark-math").then((mod) => mod.default),
      import("rehype-katex").then((mod) => mod.default),
    ]).then(([remarkGfm, remarkFixBold, remarkMath, rehypeKatex]) => {
      cachedPlugins = {
        remarkPlugins: [remarkGfm, remarkFixBold, remarkMath],
        rehypePlugins: [rehypeKatex],
      };
      return cachedPlugins;
    });
  }
  return pluginPromise;
}

function MarkdownPlainFallback({ content }: { content: string }) {
  return (
    <div data-i18n-skip="true" className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text-primary">
      {content}
    </div>
  );
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-4 rounded-lg overflow-hidden border border-surface-border">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border bg-[#F6F8FA] dark:bg-[#0D0D0D]">
        <span className="text-[11px] font-mono uppercase text-gray-500 dark:text-gray-400">
          {language || "text"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] transition-colors opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <LazySyntaxHighlighter language={language} value={value} />
    </div>
  );
}

export default function MarkdownRenderer({ content }: { content: string }) {
  const [plugins, setPlugins] = useState<MarkdownPlugins | null>(cachedPlugins);

  useEffect(() => {
    let cancelled = false;
    loadMarkdownPlugins().then((next) => {
      if (!cancelled) setPlugins(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const markdownComponents = useMemo(() => ({
    code({ inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || "");
      const lang = match?.[1] || "";
      const value = String(children).replace(/\n$/, "");
      if (!inline && lang === "echarts") {
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
    p({ children }: any) { return <p className="text-[15px] leading-relaxed text-text-primary mb-4 last:mb-0 [li>&]:inline [li>&]:mb-0">{children}</p>; },
    ul({ children }: any) { return <ul className="list-disc ml-5 mb-4 space-y-1 text-text-primary">{children}</ul>; },
    ol({ children }: any) { return <ol className="list-decimal ml-5 mb-4 space-y-1 text-text-primary">{children}</ol>; },
    li({ children }: any) { return <li className="text-[15px] leading-relaxed">{children}</li>; },
    h1({ children }: any) { return <h1 className="text-xl font-semibold text-text-primary mb-3 mt-6">{children}</h1>; },
    h2({ children }: any) { return <h2 className="text-lg font-semibold text-text-primary mb-2 mt-5">{children}</h2>; },
    h3({ children }: any) { return <h3 className="text-base font-semibold text-text-primary mb-2 mt-4">{children}</h3>; },
    strong({ children }: any) { return <strong className="font-semibold text-text-primary">{children}</strong>; },
    blockquote({ children }: any) { return <blockquote className="border-l-2 border-surface-border pl-4 italic text-text-secondary my-4">{children}</blockquote>; },
    table({ children }: any) { return <div className="overflow-x-auto my-4"><table className="w-full text-sm border-collapse">{children}</table></div>; },
    thead({ children }: any) { return <thead className="bg-surface-card border-b border-surface-border">{children}</thead>; },
    tbody({ children }: any) { return <tbody>{children}</tbody>; },
    tr({ children }: any) { return <tr className="border-b border-surface-border/50 hover:bg-surface-card/30 transition-colors">{children}</tr>; },
    th({ children }: any) { return <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-text-primary whitespace-nowrap">{children}</th>; },
    td({ children }: any) { return <td className="px-3 py-2.5 text-[13px] text-text-secondary leading-relaxed">{children}</td>; },
  }), []);

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
}
