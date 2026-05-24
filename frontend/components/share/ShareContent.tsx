"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  User,
  Loader2,
  AlertCircle,
  Lightbulb,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFixBold from "@/lib/remark-fix-bold";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "@/components/theme/ThemeProvider";

interface ShareMessage {
  id: number;
  role: string;
  content: string;
  model: string;
  created_at: string;
}

interface ShareData {
  title: string;
  model: string;
  messages: ShareMessage[];
  created_at: string;
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const themeCtx = useTheme();
  const theme = themeCtx?.theme || "light";
  const isDark = themeCtx?.theme === "dark";

  return (
    <div className="relative group my-4 rounded-lg overflow-hidden border border-surface-border">
      <div
        className={cn(
          "flex items-center justify-between px-3 py-2 border-b border-surface-border",
          isDark ? "bg-[#0D0D0D]" : "bg-[#F6F8FA]"
        )}
      >
        <span
          className={cn(
            "text-[11px] font-mono uppercase",
            isDark ? "text-gray-400" : "text-gray-500"
          )}
        >
          {language || "text"}
        </span>
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

// 解析 <think>...思考过程...</think>
function parseThinkContent(content: string): {
  reasoning: string | null;
  answer: string;
  isThinking: boolean;
} {
  const startIdx = content.indexOf("<think>");
  if (startIdx === -1) return { reasoning: null, answer: content, isThinking: false };

  const endIdx = content.indexOf("</think>");
  if (endIdx === -1) {
    return {
      reasoning: content.slice(startIdx + 7),
      answer: content.slice(0, startIdx),
      isThinking: true,
    };
  }

  return {
    reasoning: content.slice(startIdx + 7, endIdx).trim(),
    answer: (content.slice(0, startIdx) + content.slice(endIdx + 8)).trim(),
    isThinking: false,
  };
}

// 可折叠的思考过程块
function ThinkBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(() => content.length < 2000);

  return (
    <div className="mb-3 rounded-xl border border-surface-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left transition-colors
          bg-purple-50 hover:bg-purple-100
          dark:bg-[#1A1A2E] dark:hover:bg-[#252542]"
      >
        <Lightbulb className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
        <span className="text-sm font-medium text-text-secondary flex-1">
          推理过程{content.length >= 2000 ? " · 已折叠" : ""}
        </span>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        )}
      </button>
      {expanded && (
        <div
          className="px-3 py-2.5 text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap
          bg-slate-50 dark:bg-[#0F0F1A]"
        >
          {content}
        </div>
      )}
    </div>
  );
}

// Markdown 渲染组件映射
const markdownComponents = {
  code({ node, inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    return !inline && match ? (
      <CodeBlock language={match[1]} value={String(children).replace(/\n$/, "")} />
    ) : (
      <code
        className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1 py-0.5 rounded text-[13px] font-mono"
        {...props}
      >
        {children}
      </code>
    );
  },
  p({ children }: any) {
    return (
      <p className="text-[15px] leading-relaxed text-text-primary mb-4 last:mb-0 [li>&]:inline [li>&]:mb-0">
        {children}
      </p>
    );
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
    return <h1 className="text-xl font-bold text-text-primary mb-3 mt-6">{children}</h1>;
  },
  h2({ children }: any) {
    return <h2 className="text-lg font-bold text-text-primary mb-2 mt-5">{children}</h2>;
  },
  h3({ children }: any) {
    return <h3 className="text-base font-bold text-text-primary mb-2 mt-4">{children}</h3>;
  },
  strong({ children }: any) {
    return <strong className="font-bold text-text-primary">{children}</strong>;
  },
  blockquote({ children }: any) {
    return (
      <blockquote className="border-l-2 border-surface-border pl-4 italic text-text-secondary my-4">
        {children}
      </blockquote>
    );
  },
  table({ children }: any) {
    return (
      <div className="overflow-x-auto my-4">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    );
  },
  thead({ children }: any) {
    return <thead className="bg-surface-card border-b border-surface-border">{children}</thead>;
  },
  tbody({ children }: any) {
    return <tbody>{children}</tbody>;
  },
  tr({ children }: any) {
    return (
      <tr className="border-b border-surface-border/50 hover:bg-surface-card/30 transition-colors">
        {children}
      </tr>
    );
  },
  th({ children }: any) {
    return (
      <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-text-primary whitespace-nowrap">
        {children}
      </th>
    );
  },
  td({ children }: any) {
    return (
      <td className="px-3 py-2.5 text-[13px] text-text-secondary leading-relaxed">{children}</td>
    );
  },
};

// 渲染一条 AI 消息（包含 think 解析）
function AIMessageContent({ content, model }: { content: string; model?: string }) {
  const { reasoning, answer } = parseThinkContent(content);
  return (
    <>
      {model && (
        <div className="flex items-center gap-1.5 mb-2">
          <div className="w-1 h-1 rounded-full bg-brand" />
          <span className="text-[11px] text-text-tertiary">{model}</span>
        </div>
      )}
      {reasoning && <ThinkBlock content={reasoning} />}
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkFixBold]} components={markdownComponents}>
        {answer}
      </ReactMarkdown>
    </>
  );
}

export default function ShareContent() {
  const [slug, setSlug] = useState("");
  const [data, setData] = useState<ShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const themeCtx = useTheme();
  const theme = themeCtx?.theme || "light";

  // 从 URL query 参数解析 slug：/share?slug=xxx
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slugFromQuery = params.get("slug");
    const typeFromQuery = params.get("type") || "share";
    if (slugFromQuery) {
      setSlug(slugFromQuery);
      setShareType(typeFromQuery);
    } else {
      setError("无效的分享链接");
      setLoading(false);
    }
  }, []);

  const [shareType, setShareType] = useState("share");

  useEffect(() => {
    if (!slug) return;
    // 根据 type 选择不同的 API
    const apiPath =
      shareType === "compare" ? `/api/compare/share/${slug}` : `/api/share/${slug}`;
    fetch(apiPath)
      .then(async (res) => {
        if (!res.ok) throw new Error("分享不存在或已过期");
        return res.json();
      })
      .then((data) => {
        setData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [slug]);


  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex items-center gap-2 text-text-tertiary">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center max-w-sm px-4">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-text-primary mb-2">分享不可用</h1>
          <p className="text-sm text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // 对比记录渲染
  if (shareType === "compare") {
    const compareData = data as any;
    const results: Array<{
      model_id: string;
      model_name: string;
      content: string;
      error?: string;
      elapsed_ms: number;
    }> = compareData.results || [];

    // 推断颜色
    const findColor = (modelID: string): string => {
      if (modelID.startsWith("gpt-")) return "#10a37f";
      if (modelID.startsWith("claude-")) return "#cc785c";
      if (modelID.startsWith("gemini-")) return "#4285f4";
      if (modelID.startsWith("deepseek-")) return "#4d6bfa";
      if (modelID.startsWith("kimi") || modelID.startsWith("moonshot-")) return "#00b96b";
      return "#888";
    };

    return (
      <div className="min-h-screen bg-surface">
        <header className="sticky top-0 z-10 bg-surface/80 backdrop-blur-md border-b border-surface-border">
          <div className="max-w-[1200px] mx-auto px-4 h-12 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img
                src={theme === "dark" ? "/brand-dark-title.png" : "/brand-light-title.png"}
                alt="AI Space"
                className="h-5 w-auto object-contain"
              />
              <span className="text-text-tertiary">/</span>
              <span className="text-sm text-text-secondary truncate max-w-[200px]">对比结果</span>
            </div>
            <a href="/" className="text-sm text-brand hover:text-brand-hover transition-colors">
              开始对话 →
            </a>
          </div>
        </header>

        <main className="max-w-[1200px] mx-auto px-4 py-8">
          {/* 查询问题 */}
          <div className="mb-8">
            <div className="inline-block px-3 py-1.5 rounded-full bg-surface-card border border-surface-border text-sm text-text-primary mb-2">
              {compareData.query || "对比查询"}
            </div>
            <div className="flex items-center gap-2 text-xs text-text-tertiary">
              <span>{compareData.models?.length || 0} 个模型</span>
              <span>·</span>
              <span>{new Date(compareData.created_at).toLocaleDateString("zh-CN")}</span>
            </div>
          </div>

          {/* 对比结果网格 */}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {results.map((res) => {
              const color = findColor(res.model_id);
              return (
                <div
                  key={res.model_id}
                  className="rounded-xl border border-surface-border bg-surface-elevated flex flex-col overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-border">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-sm font-medium text-text-primary">{res.model_name}</span>
                    {res.elapsed_ms > 0 && (
                      <span className="ml-auto text-[11px] text-text-tertiary">
                        {(res.elapsed_ms / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <div className="flex-1 px-4 py-3 max-h-[60vh] overflow-y-auto prose prose-sm max-w-none text-[14px] leading-relaxed text-text-primary">
                    {res.error ? (
                      <div className="text-red-400 text-sm">{res.error}</div>
                    ) : res.content ? (
                      <AIMessageContent content={res.content} />
                    ) : (
                      <div className="py-6 text-center text-text-tertiary text-sm">
                        等待回答中...
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-center py-8">
            <p className="text-[11px] text-text-tertiary">由 AI Space · 对比记录</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-10 bg-surface/80 backdrop-blur-md border-b border-surface-border">
        <div className="max-w-[800px] mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src={theme === "dark" ? "/brand-dark-title.png" : "/brand-light-title.png"}
              alt="AI Space"
              className="h-5 w-auto object-contain"
            />
            <span className="text-text-tertiary">/</span>
            <span className="text-sm text-text-secondary truncate max-w-[200px]">
              {data.title || "分享的对话"}
            </span>
          </div>
          <a href="/" className="text-sm text-brand hover:text-brand-hover transition-colors">
            开始对话 →
          </a>
        </div>
      </header>

      <main className="max-w-[800px] mx-auto px-4 py-8 space-y-8">
        {data.messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div key={msg.id} className={cn("flex gap-4", isUser ? "justify-end" : "justify-start")}>
              {!isUser && (
                <div className="mt-1 w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-text-secondary" />
                </div>
              )}
              <div className="flex flex-col gap-1 max-w-[85%] sm:max-w-[75%]">
                <div
                  className={cn(
                    "px-4 py-3",
                    isUser
                      ? "rounded-2xl rounded-br-sm bg-[#EFF6FF] dark:bg-[#1E293B]"
                      : "rounded-2xl rounded-bl-sm bg-[#F5F4F2] dark:bg-[#1F1F1F]"
                  )}
                >
                  {!isUser && msg.model && (
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-1 h-1 rounded-full bg-brand" />
                      <span className="text-[11px] text-text-tertiary">{msg.model}</span>
                    </div>
                  )}
                  {isUser ? (
                    <p className="text-[15px] leading-relaxed text-text-primary whitespace-pre-wrap">
                      {msg.content}
                    </p>
                  ) : (
                    <div className="prose prose-sm max-w-none">
                      <AIMessageContent content={msg.content} />
                    </div>
                  )}
                </div>
              </div>
              {isUser && (
                <div className="mt-1 w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-text-secondary" />
                </div>
              )}
            </div>
          );
        })}

        <div className="text-center py-8">
          <p className="text-[11px] text-text-tertiary">
            由 AI Space 分享 · {new Date(data.created_at).toLocaleDateString("zh-CN")}
          </p>
        </div>
      </main>


    </div>
  );
}
