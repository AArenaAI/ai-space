"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

const LazySyntaxHighlighter = dynamic(() => import("../LazySyntaxHighlighter"), {
  ssr: false,
  loading: () => null,
});

const LONG_CODE_CHAR_THRESHOLD = 4000;
const LONG_CODE_LINE_THRESHOLD = 120;

export default function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const lineCount = value.split("\n").length;
  const isLongCode = value.length >= LONG_CODE_CHAR_THRESHOLD || lineCount >= LONG_CODE_LINE_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLongCode);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div data-testid="markdown-code-block" className="relative group my-4 rounded-lg overflow-hidden border border-surface-border">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-surface-border bg-[#F6F8FA] dark:bg-[#0D0D0D]">
        <span className="min-w-0 truncate text-[11px] font-mono uppercase text-gray-500 dark:text-gray-400">
          {language || "text"}
        </span>
        <div className="flex items-center gap-2">
          {isLongCode && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-surface-card hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
              {expanded ? "收起" : `代码块较长，已折叠 · ${lineCount} 行`}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-[11px] transition-colors opacity-100 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      </div>
      {expanded ? (
        <LazySyntaxHighlighter language={language} value={value} />
      ) : (
        <div className="bg-[#0D1117] px-4 py-3 text-[13px] text-gray-300">
          <pre className="max-h-28 overflow-hidden whitespace-pre-wrap break-words font-mono">{value.slice(0, 1200)}</pre>
          <div className="mt-2 text-[11px] text-gray-500">点击展开查看完整代码并加载高亮</div>
        </div>
      )}
    </div>
  );
}
