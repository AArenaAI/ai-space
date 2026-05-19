"use client";

import { useEffect, useState } from "react";
import { Bot, User, Loader2, AlertCircle } from "lucide-react";
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
  const isDark = themeCtx?.theme === "dark";

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

export default function ShareContent() {
  const [slug, setSlug] = useState("");
  const [data, setData] = useState<ShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    const apiPath = shareType === "compare" ? `/api/compare/share/${slug}` : `/api/share/${slug}`;
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
    const results: Array<{model_id: string; model_name: string; content: string; error?: string; elapsed_ms: number}> = compareData.results || [];

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
              <img src="/brand-title.png" alt="AI Space" className="h-5 w-auto object-contain" />
              <span className="text-text-tertiary">/</span>
              <span className="text-sm text-text-secondary truncate max-w-[200px]">对比结果</span>
            </div>
            <a href="/" className="text-sm text-brand hover:text-brand-hover transition-colors">开始对话 →</a>
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
                <div key={res.model_id} className="rounded-xl border border-surface-border bg-surface-elevated flex flex-col overflow-hidden">
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
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkFixBold]}
                        components={{
                          code({ node, inline, className, children, ...props }: any) {
                            const match = /language-(\w+)/.exec(className || "");
                            return !inline && match ? (
                              <CodeBlock language={match[1]} value={String(children).replace(/\n$/, "")} />
                            ) : (
                              <code className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1 py-0.5 rounded text-[13px] font-mono" {...props}>{children}</code>
                            );
                          },
                          p({ children }) { return <p className="mb-3 last:mb-0">{children}</p>; },
                          ul({ children }) { return <ul className="list-disc ml-4 mb-3 space-y-1">{children}</ul>; },
                          ol({ children }) { return <ol className="list-decimal ml-4 mb-3 space-y-1">{children}</ol>; },
                          h1({ children }) { return <h1 className="text-lg font-bold mb-2 mt-4">{children}</h1>; },
                          h2({ children }) { return <h2 className="text-base font-bold mb-2 mt-3">{children}</h2>; },
                          h3({ children }) { return <h3 className="text-sm font-bold mb-1 mt-3">{children}</h3>; },
                          blockquote({ children }) { return <blockquote className="border-l-2 border-surface-border pl-4 italic text-text-secondary my-4">{children}</blockquote>; },
                          a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">{children}</a>; },
                        }}
                      >
                        {res.content}
                      </ReactMarkdown>
                    ) : (
                      <div className="py-6 text-center text-text-tertiary text-sm">等待回答中...</div>
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
            <img src="/brand-title.png" alt="AI Space" className="h-5 w-auto object-contain" />
            <span className="text-text-tertiary">/</span>
            <span className="text-sm text-text-secondary truncate max-w-[200px]">{data.title || "分享的对话"}</span>
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
                    <p className="text-[15px] leading-relaxed text-text-primary whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkFixBold]}
                        components={{
                          code({ node, inline, className, children, ...props }: any) {
                            const match = /language-(\w+)/.exec(className || "");
                            return !inline && match ? (
                              <CodeBlock language={match[1]} value={String(children).replace(/\n$/, "")} />
                            ) : (
                              <code className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1 py-0.5 rounded text-[13px] font-mono" {...props}>
                                {children}
                              </code>
                            );
                          },
                          p({ children }) { return <p className="text-[15px] leading-relaxed text-text-primary mb-4 last:mb-0 [li>&]:inline [li>&]:mb-0">{children}</p>; },
                          ul({ children }) { return <ul className="list-disc ml-5 mb-4 space-y-1 text-text-primary">{children}</ul>; },
                          ol({ children }) { return <ol className="list-decimal ml-5 mb-4 space-y-1 text-text-primary">{children}</ol>; },
                          li({ children }) { return <li className="text-[15px] leading-relaxed">{children}</li>; },
                          h1({ children }) { return <h1 className="text-xl font-bold text-text-primary mb-3 mt-6">{children}</h1>; },
                          h2({ children }) { return <h2 className="text-lg font-bold text-text-primary mb-2 mt-5">{children}</h2>; },
                          h3({ children }) { return <h3 className="text-base font-bold text-text-primary mb-2 mt-4">{children}</h3>; },
                          strong({ children }) { return <strong className="font-bold text-text-primary">{children}</strong>; },
                          blockquote({ children }) { return <blockquote className="border-l-2 border-surface-border pl-4 italic text-text-secondary my-4">{children}</blockquote>; },
                          table({ children }) { return <div className="overflow-x-auto my-4"><table className="w-full text-sm border-collapse">{children}</table></div>; },
                          thead({ children }) { return <thead className="bg-surface-card border-b border-surface-border">{children}</thead>; },
                          tbody({ children }) { return <tbody>{children}</tbody>; },
                          tr({ children }) { return <tr className="border-b border-surface-border/50 hover:bg-surface-card/30 transition-colors">{children}</tr>; },
                          th({ children }) { return <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-text-primary whitespace-nowrap">{children}</th>; },
                          td({ children }) { return <td className="px-3 py-2.5 text-[13px] text-text-secondary leading-relaxed">{children}</td>; },
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
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
