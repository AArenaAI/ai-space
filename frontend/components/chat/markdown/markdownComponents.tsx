"use client";

import dynamic from "next/dynamic";
import CodeBlock from "./CodeBlock";

const LazyEChartsBlock = dynamic(() => import("../EChartsBlock"), {
  ssr: false,
  loading: () => <div className="my-4 h-48 rounded-xl border border-surface-border bg-surface-card animate-pulse" />,
});

export function createMarkdownComponents({ isStreaming = false, lightweight = false }: { isStreaming?: boolean; lightweight?: boolean } = {}) {
  return {
    pre({ children }: any) {
      // Block code is rendered by the custom `code` component below. If we let
      // react-markdown keep its default `<pre>` wrapper around that component,
      // the DOM becomes `<pre><div class="code-block"><pre>...</pre></div></pre>`:
      // visually this appears as a code block nested inside another code block.
      return <>{children}</>;
    },
    code({ inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || "");
      const lang = match?.[1] || "";
      const value = String(children).replace(/\n$/, "");
      if (!inline && lang === "echarts" && !isStreaming && !lightweight) {
        return <LazyEChartsBlock value={value} />;
      }
      return !inline && match ? (
        <CodeBlock language={lang} value={value} lightweight={lightweight} />
      ) : (
        <code className="bg-[#E8E8E8] dark:bg-[#2A2A3A] text-[#333333] dark:text-[#E0E0E0] px-1 py-0.5 rounded text-[13px] font-mono" {...props}>
          {children}
        </code>
      );
    },
    p({ children }: any) {
      return <p className="text-[15px] leading-relaxed text-text-primary mb-4 last:mb-0 [li>&]:inline [li>&]:mb-0 [.reasoning-markdown_&]:text-[13px] [.reasoning-markdown_&]:text-text-secondary [.streaming-answer-markdown_&]:mb-0">{children}</p>;
    },
    ul({ children }: any) {
      return <ul className="list-disc ml-5 mb-4 space-y-1 text-text-primary">{children}</ul>;
    },
    ol({ children }: any) {
      return <ol className="list-decimal ml-5 mb-4 space-y-1 text-text-primary">{children}</ol>;
    },
    li({ children }: any) {
      return <li className="text-[15px] leading-relaxed">{children}</li>;
    },
    h1({ children }: any) {
      return <h1 className="text-xl font-semibold text-text-primary mb-3 mt-6">{children}</h1>;
    },
    h2({ children }: any) {
      return <h2 className="text-lg font-semibold text-text-primary mb-2 mt-5">{children}</h2>;
    },
    h3({ children }: any) {
      return <h3 className="text-base font-semibold text-text-primary mb-2 mt-4">{children}</h3>;
    },
    strong({ children }: any) {
      return <strong className="font-semibold text-text-primary [.reasoning-markdown_&]:text-text-secondary">{children}</strong>;
    },
    blockquote({ children }: any) {
      return <blockquote className="border-l-2 border-surface-border pl-4 italic text-text-secondary my-4">{children}</blockquote>;
    },
    table({ children }: any) {
      return <div className="overflow-x-auto my-4"><table className="w-full text-sm border-collapse" data-markdown-lightweight={lightweight ? "true" : undefined}>{children}</table></div>;
    },
    thead({ children }: any) {
      return <thead className="bg-surface-card border-b border-surface-border">{children}</thead>;
    },
    tbody({ children }: any) {
      return <tbody>{children}</tbody>;
    },
    tr({ children }: any) {
      return <tr className="border-b border-surface-border/50 hover:bg-surface-card/30 transition-colors">{children}</tr>;
    },
    th({ children }: any) {
      return <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-text-primary whitespace-nowrap">{children}</th>;
    },
    td({ children }: any) {
      return <td className="px-3 py-2.5 text-[13px] text-text-secondary leading-relaxed">{children}</td>;
    },
  };
}
