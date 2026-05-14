"use client";

import { useState } from "react";
import { CompareResult } from "@/hooks/useCompare";
import { Copy, Check, Clock, AlertCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme/ThemeProvider";

interface CompareResultsProps {
  results: CompareResult[];
}

const PROVIDER_COLORS: Record<string, string> = {
  DeepSeek: "#4d6bfa",
  OpenAI: "#10a37f",
  Anthropic: "#cc785c",
  Google: "#4285f4",
  Moonshot: "#00b96b",
};

function findColor(modelID: string): string {
  // 根据模型ID推断颜色（复用前端颜色约定）
  if (modelID.startsWith("gpt-")) return "#10a37f";
  if (modelID.startsWith("claude-")) return "#cc785c";
  if (modelID.startsWith("gemini-")) return "#4285f4";
  if (modelID.startsWith("deepseek-")) return "#4d6bfa";
  if (modelID.startsWith("kimi") || modelID.startsWith("moonshot-")) return "#00b96b";
  return "#888";
}

export default function CompareResults({ results }: CompareResultsProps) {
  return (
    <div className="px-4 pb-8">
      <div className="max-w-[1400px] mx-auto">
        <div className="text-sm text-text-tertiary mb-4">对比结果</div>
        <div className={cn("grid gap-4", results.length <= 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3")}>
          {results.map((res) => (
            <ResultCard key={res.model_id} result={res} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: CompareResult }) {
  const [copied, setCopied] = useState(false);
  const color = findColor(result.model_id);
  const themeCtx = useTheme();
  const isDark = themeCtx?.theme === "dark";

  const handleCopy = () => {
    navigator.clipboard.writeText(result.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-surface-border bg-surface-elevated flex flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm font-medium text-text-primary">{result.model_name}</span>
        </div>
        <div className="flex items-center gap-3">
          {result.elapsed_ms > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
              <Clock className="w-3 h-3" />
              {(result.elapsed_ms / 1000).toFixed(1)}s
            </span>
          )}
          <button
            onClick={handleCopy}
            className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
            title="复制回答"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* 内容 */}
      <div className="flex-1 px-4 py-3 overflow-y-auto max-h-[60vh]">
        {result.error ? (
          <div className="flex items-start gap-2 text-red-400">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="text-sm">{result.error}</p>
          </div>
        ) : (
          <div className="prose prose-sm max-w-none text-[14px] leading-relaxed text-text-primary">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              children={(() => {
                // 过滤引用来源列表和 [数字] 引用编号
                let clean = result.content;
                // 去掉末尾的"引用来源"段落
                clean = clean.replace(/\n*[*_]*\s*(?:引用来源|参考来源|来源|References|参考链接)[：:][\s\S]*$/, "");
                // 去掉末尾的 [数字] 列表
                clean = clean.replace(/\n*\[\d+\]\s+[^\n]*(?:\n\[\d+\]\s+[^\n]*)*$/, "");
                // 去掉末尾的 --- 分隔线
                clean = clean.replace(/\n*---+\s*$/, "");
                // 去掉行内 [数字] 引用编号
                clean = clean.replace(/(?<!\d)\[(\d+)\](?!\s*[.)])/g, "");
                return clean.trim();
              })()}
              components={{
                code({ inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || "");
                  return !inline && match ? (
                    <pre className={cn("rounded-lg p-3 overflow-x-auto my-2", isDark ? "bg-[#0D0D0D]" : "bg-[#F6F8FA]")}>
                      <code className={className} {...props}>{children}</code>
                    </pre>
                  ) : (
                    <code className={cn("px-1 py-0.5 rounded text-[13px] font-mono", isDark ? "bg-blue-900/20 text-blue-400" : "bg-blue-50 text-blue-600")} {...props}>{children}</code>
                  );
                },
                p({ children }) { return <p className="mb-3 last:mb-0">{children}</p>; },
                ul({ children }) { return <ul className="list-disc ml-4 mb-3 space-y-1">{children}</ul>; },
                ol({ children }) { return <ol className="list-decimal ml-4 mb-3 space-y-1">{children}</ol>; },
                h1({ children }) { return <h1 className="text-lg font-bold mb-2 mt-4">{children}</h1>; },
                h2({ children }) { return <h2 className="text-base font-bold mb-2 mt-3">{children}</h2>; },
                h3({ children }) { return <h3 className="text-sm font-bold mb-1 mt-3">{children}</h3>; },
              }}
            >
            </ReactMarkdown>
          </div>
        )}
        {/* 空内容占位 */}
        {!result.content && !result.error && (
          <div className="py-6 text-center text-text-tertiary text-sm">
            等待回答中...
          </div>
        )}
      </div>
    </div>
  );
}
