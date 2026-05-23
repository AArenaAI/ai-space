"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme/ThemeProvider";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkFixBold from "@/lib/remark-fix-bold";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import EChartsBlock from "./EChartsBlock";

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const themeCtx = useTheme();
  const isDark = themeCtx?.theme === "dark";

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-4 rounded-lg overflow-hidden border border-surface-border">
      <div className={cn(
        "flex items-center justify-between px-3 py-2 border-b border-surface-border",
        isDark ? "bg-[#0D0D0D]" : "bg-[#F6F8FA]"
      )}>
        <span className={cn(
          "text-[11px] font-mono uppercase",
          isDark ? "text-gray-400" : "text-gray-500"
        )}>
          {language || "text"}
        </span>
        <button
          onClick={handleCopy}
          className={cn(
            "flex items-center gap-1 text-[11px] transition-colors opacity-0 group-hover:opacity-100",
            isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-800"
          )}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={isDark ? vscDarkPlus : oneLight}
        customStyle={{
          margin: 0,
          padding: "1rem",
          fontSize: "13px",
          lineHeight: "1.5",
          background: isDark ? "#0D0D0D" : "#F6F8FA",
          overflowX: "auto",
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}

const markdownComponents = {
  code({ inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    const lang = match?.[1] || "";
    const value = String(children).replace(/\n$/, "");
    if (!inline && lang === "echarts") {
      return <EChartsBlock value={value} />;
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
  h1({ children }: any) { return <h1 className="text-xl font-bold text-text-primary mb-3 mt-6">{children}</h1>; },
  h2({ children }: any) { return <h2 className="text-lg font-bold text-text-primary mb-2 mt-5">{children}</h2>; },
  h3({ children }: any) { return <h3 className="text-base font-bold text-text-primary mb-2 mt-4">{children}</h3>; },
  strong({ children }: any) { return <strong className="font-bold text-text-primary">{children}</strong>; },
  blockquote({ children }: any) { return <blockquote className="border-l-2 border-surface-border pl-4 italic text-text-secondary my-4">{children}</blockquote>; },
  table({ children }: any) { return <div className="overflow-x-auto my-4"><table className="w-full text-sm border-collapse">{children}</table></div>; },
  thead({ children }: any) { return <thead className="bg-surface-card border-b border-surface-border">{children}</thead>; },
  tbody({ children }: any) { return <tbody>{children}</tbody>; },
  tr({ children }: any) { return <tr className="border-b border-surface-border/50 hover:bg-surface-card/30 transition-colors">{children}</tr>; },
  th({ children }: any) { return <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-text-primary whitespace-nowrap">{children}</th>; },
  td({ children }: any) { return <td className="px-3 py-2.5 text-[13px] text-text-secondary leading-relaxed">{children}</td>; },
};

export default function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkFixBold, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
}
