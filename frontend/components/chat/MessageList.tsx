"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { User, Bot, Copy, Check, MoreHorizontal, Trash2, RotateCcw, Share2, X, SquareCheck, ChevronDown, ChevronUp, Lightbulb, Play, Search, ChevronDown as ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Message, ChatModel } from "@/hooks/useChat";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFixBold from "@/lib/remark-fix-bold";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "@/components/theme/ThemeProvider";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ShareDialog from "@/components/ui/ShareDialog";
import { useSmartAutoScroll } from "@/hooks/useSmartAutoScroll";

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  models: ChatModel[];
  conversationId?: number;
  onDeleteMessage?: (id: string) => void;
  onRegenerate?: () => void;
  onContinueGenerate?: () => void;
  isCompare?: boolean;
  compareModels?: string[];
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  welcomeExamples?: { title: string; desc: string; prompt: string }[];
  onExampleClick?: (prompt: string) => void;
}

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

function StreamingCursor() {
  return <span className="inline-block w-[2px] h-[1.2em] bg-brand ml-0.5 animate-cursor-blink align-middle" />;
}

// 解析 <think>...思考过程...</think>
function parseThinkContent(content: string): { reasoning: string | null; answer: string; isThinking: boolean } {
  const startIdx = content.indexOf("<think>");
  if (startIdx === -1) return { reasoning: null, answer: content, isThinking: false };

  const endIdx = content.indexOf("</think>");
  if (endIdx === -1) {
    // 正在思考中，只有 <think> 没有 </think>
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

// 从回答内容中提取被引用的编号
function extractCitations(content: string): number[] {
  const matches = content.match(/\[(\d+)\]/g);
  if (!matches) return [];
  const nums = matches.map((m) => parseInt(m.slice(1, -1), 10));
  // 去重并排序
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

// 过滤掉搜索来源引用：去掉末尾的"引用来源：..."段落、--- 分隔线、和回答中的 [数字] 引用编号
function sanitizeContent(content: string): string {
  let result = content;
  
  // 匹配 "**引用来源**"、"引用来源："、"参考来源："、"References：" 等开头的末尾段落
  result = result.replace(/\n*[*_]*\s*(?:引用来源|参考来源|来源|References|参考链接)[：:][\s\S]*$/, "");
  
  // 去掉末尾的 [数字] Title - URL 格式的列表
  result = result.replace(/\n*\[\d+\]\s+[^\n]*(?:\n\[\d+\]\s+[^\n]*)*$/, "");
  
  // 去掉末尾的 --- 分隔线（搜索注入的分隔或 AI 自己写的）
  result = result.replace(/\n*---+\s*$/, "");
  
  // 去掉行内单独的 [数字] 引用标记（但保留 Markdown 有序列表中的 [数字]）
  result = result.replace(/(?<!\d)\[(\d+)\](?!\s*[.)])/g, "");
  
  return result.trim();
}

// 根据回答内容过滤出实际被引用的来源
function getCitedSources(content: string, allSources?: { title: string; url: string; description: string }[]) {
  if (!allSources || allSources.length === 0) return [];
  const citations = extractCitations(content);
  if (citations.length === 0) return [];
  // 引用编号是 1-based，转换为 0-based 索引
  return citations
    .filter((n) => n >= 1 && n <= allSources.length)
    .map((n) => allSources[n - 1]);
}

// 可折叠的思考过程块
function ThinkBlock({ content, isThinking }: { content: string; isThinking: boolean }) {
  const [expanded, setExpanded] = useState(true);

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
          {isThinking ? "正在思考..." : "深度思考"}
        </span>
        {isThinking && (
          <div className="flex gap-0.5">
            <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce" />
            <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce [animation-delay:0.15s]" />
            <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce [animation-delay:0.3s]" />
          </div>
        )}
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-3 py-2.5 text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap
          bg-slate-50 dark:bg-[#0F0F1A]">
          {content}
        </div>
      )}
    </div>
  );
}

// 消息操作菜单
function MessageMenu({
  onCopy,
  onDelete,
  onRegenerate,
  onSelectMode,
  showRegenerate,
}: {
  onCopy: () => void;
  onDelete: () => void;
  onRegenerate?: () => void;
  onSelectMode: () => void;
  showRegenerate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 mb-1 w-36 rounded-xl border border-surface-border bg-surface-elevated shadow-xl z-50 py-1 animate-fade-in">
            <button
              onClick={() => { onCopy(); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              复制
            </button>
            {showRegenerate && onRegenerate && (
              <button
                onClick={() => { onRegenerate(); setOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                重新生成
              </button>
            )}
            <button
              onClick={() => { onSelectMode(); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
              选择分享
            </button>
            <div className="mx-2 my-1 h-px bg-surface-border" />
            <button
              onClick={() => { onDelete(); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function MessageList({
  messages,
  isLoading,
  models,
  conversationId,
  onDeleteMessage,
  onRegenerate,
  onContinueGenerate,
  isCompare = false,
  compareModels = [],
  welcomeTitle,
  welcomeSubtitle,
  welcomeExamples,
  onExampleClick,
}: MessageListProps) {
  const {
    containerRef,
    bottomRef,
    showScrollButton,
    handleScroll,
    scrollToBottom,
    followIfAtBottom,
  } = useSmartAutoScroll({
    threshold: 120,
    enabled: true,
  });

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shareSlug, setShareSlug] = useState<string | undefined>(undefined);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  // 用户发送消息时强制 smooth 滚到底部（排除初始加载）
  const prevLengthRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevLengthRef.current && prevLengthRef.current > 0) {
      const newMessages = messages.slice(prevLengthRef.current);
      if (newMessages.some((m) => m.role === "user")) {
        scrollToBottom("smooth");
      }
    }
    prevLengthRef.current = messages.length;
  }, [messages, scrollToBottom]);

  // SSE 流式输出时，RAF + 时间节流跟随（避免高频 scrollTop 设置造成视觉跳动）
  const rafRef = useRef<number>(0);
  const lastScrollTimeRef = useRef(0);
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    const isStreaming = isLoading && lastMessage?.role === "assistant";
    if (!isStreaming) return;

    if (rafRef.current) return; // 已有待执行的 RAF，不再重复 schedule

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const now = Date.now();
      if (now - lastScrollTimeRef.current < 150) return; // 150ms 时间节流
      lastScrollTimeRef.current = now;
      followIfAtBottom();
    });
  }, [messages, isLoading, followIfAtBottom]);

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const toggleSelect = (index: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const msg = messages[index];
      if (!msg) return prev;

      // 切换当前消息
      if (next.has(msg.id)) next.delete(msg.id);
      else next.add(msg.id);

      // 连带切换配对消息（同一轮次的问题和回答）
      if (msg.role === "user" && index + 1 < messages.length) {
        const pair = messages[index + 1];
        if (pair?.role === "assistant") {
          if (next.has(msg.id)) next.add(pair.id);
          else next.delete(pair.id);
        }
      } else if (msg.role === "assistant" && index > 0) {
        const pair = messages[index - 1];
        if (pair?.role === "user") {
          if (next.has(msg.id)) next.add(pair.id);
          else next.delete(pair.id);
        }
      }

      return next;
    });
  };

  const enterSelectMode = () => {
    setSelectMode(true);
    setSelectedIds(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleShareSelected = async () => {
    if (!conversationId || selectedIds.size === 0) return;
    const token = localStorage.getItem("token");
    if (!token) return;

    setSharing(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/share`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ selected_messages: Array.from(selectedIds) }),
      });
      if (res.ok) {
        const data = await res.json();
        setShareSlug(data.slug);
        setShareOpen(true);
        exitSelectMode();
      }
    } catch {}
    setSharing(false);
  };

  if (messages.length === 0) {
    const hasCustomWelcome = welcomeExamples && welcomeExamples.length > 0;
    const defaultExamples = [
      { title: "知识问答", desc: "用通俗易懂的方式讲清一个话题，并给出3个延伸阅读方向", prompt: "用通俗易懂的方式讲清一个话题，并给出3个延伸阅读方向" },
      { title: "写作助手", desc: "帮我把这段文字改写得更专业、更精炼，并保留原意", prompt: "帮我把这段文字改写得更专业、更精炼，并保留原意" },
      { title: "代码辅助", desc: "解释这段代码的工作原理，并给出优化建议", prompt: "解释这段代码的工作原理，并给出优化建议" },
    ];
    const examples = hasCustomWelcome ? welcomeExamples : defaultExamples;

    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="text-center max-w-md">
          {hasCustomWelcome ? (
            <>
              <div className="w-12 h-12 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center mx-auto mb-6">
                <Bot className="w-5 h-5 text-text-secondary" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight mb-2 text-text-primary">{welcomeTitle}</h2>
              {welcomeSubtitle && (
                <p className="text-text-secondary text-sm leading-relaxed mb-8">{welcomeSubtitle}</p>
              )}
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center mx-auto mb-8">
                <span className="text-lg font-bold text-text-primary">AI</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-3 text-text-primary">一个入口，所有顶尖AI</h1>
              <p className="text-text-secondary text-[15px] leading-relaxed mb-10">集成 GPT、Claude、Gemini、DeepSeek、Kimi 等主流大模型</p>
            </>
          )}
          <div className="grid grid-cols-1 gap-2 text-left">
            {examples.map((item, i) => (
              <button
                key={i}
                onClick={() => onExampleClick?.(item.prompt)}
                className="group relative flex items-start gap-3 px-4 py-3 rounded-xl border border-surface-border bg-surface-elevated/50 hover:bg-surface-card transition-colors duration-200 text-left cursor-pointer"
              >
                <span className="mt-0.5 text-[11px] font-mono text-text-tertiary">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <div className="text-sm font-medium text-text-primary">{item.title}</div>
                  <div className="text-[12px] text-text-secondary mt-0.5 leading-relaxed">{item.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-8"
      >
        <div className="max-w-[800px] mx-auto space-y-8">
        {isCompare && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand/5 border border-brand/20">
            <span className="text-xs font-medium text-brand">并列对比</span>
            {compareModels && compareModels.length > 0 && (
              <div className="flex items-center gap-1.5 ml-2">
                <span className="text-[11px] text-text-tertiary">模型：</span>
                {compareModels.map((m) => {
                  const model = models.find((mod) => mod.id === m);
                  return (
                    <span key={m} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-text-secondary bg-surface-card">
                      {model && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: model.color }} />}
                      {model?.name || m}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {messages.map((msg, index) => {
          const model = models.find((m) => m.id === msg.model);
          const isUser = msg.role === "user";
          const isLast = index === messages.length - 1;
          const isStreaming = isLast && isLoading && msg.role === "assistant";
          const canRegenerate = !isUser && isLast && !isLoading;
          const isSelected = selectedIds.has(msg.id);

          return (
            <div
              key={msg.id}
              className={cn(
                "flex gap-4 animate-message-appear group",
                isUser ? "justify-end" : "justify-start"
              )}
            >
              {/* 复选框 - 选择模式 */}
              {selectMode && (
                <button
                  onClick={() => toggleSelect(index)}
                  className={cn(
                    "mt-1 shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors",
                    isSelected
                      ? "bg-brand border-brand text-white"
                      : "border-surface-border text-transparent hover:border-brand/50"
                  )}
                >
                  {isSelected && <SquareCheck className="w-3.5 h-3.5" />}
                </button>
              )}

              {!isUser && !selectMode && (
                <div className="mt-1 w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-text-secondary" />
                </div>
              )}

              <div className="flex flex-col gap-1 max-w-[85%] sm:max-w-[75%]">
                <div
                  className={cn(
                    "px-4 py-3 relative",
                    isUser
                      ? "rounded-2xl rounded-br-sm bg-[#EFF6FF] dark:bg-[#1E293B]"
                      : "rounded-2xl rounded-bl-sm bg-[#F5F4F2] dark:bg-[#1F1F1F]"
                  )}
                >
                  {!isUser && model && !selectMode && (
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1 h-1 rounded-full" style={{ backgroundColor: model.color }} />
                          <span className="text-[11px] text-text-tertiary">{model.name}</span>
                        </div>
                        {msg.search && msg.searchStatus === "searching" && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full text-amber-600 bg-amber-500/10">
                            <Search className="w-3 h-3 animate-pulse" />
                            正在搜索...
                          </span>
                        )}
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <MessageMenu
                          onCopy={() => handleCopy(msg.content)}
                          onDelete={() => setDeleteTarget(msg.id)}
                          onRegenerate={onRegenerate}
                          onSelectMode={enterSelectMode}
                          showRegenerate={canRegenerate}
                        />
                      </div>
                    </div>
                  )}

                  {isUser ? (
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[15px] leading-relaxed text-text-primary whitespace-pre-wrap">{msg.content}</p>
                      {!selectMode && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
                          <MessageMenu
                            onCopy={() => handleCopy(msg.content)}
                            onDelete={() => setDeleteTarget(msg.id)}
                            onSelectMode={enterSelectMode}
                            showRegenerate={false}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none">
                      {(() => {
                        const { reasoning, answer, isThinking } = parseThinkContent(msg.content);
                        const cleanAnswer = sanitizeContent(answer);
                        return (
                          <>
                            {reasoning && <ThinkBlock content={reasoning} isThinking={isThinking} />}
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm, remarkFixBold]}
                              components={{
                                code({ node, inline, className, children, ...props }: any) {
                                  const match = /language-(\w+)/.exec(className || "");
                                  return !inline && match ? (
                                    <CodeBlock language={match[1]} value={String(children).replace(/\n$/, "")} />
                                  ) : (
                                    <code className="bg-[#E8E8E8] dark:bg-[#2A2A3A] text-[#333333] dark:text-[#E0E0E0] px-1 py-0.5 rounded text-[13px] font-mono" {...props}>
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
                              {cleanAnswer}
                            </ReactMarkdown>
                          </>
                        );
                      })()}
                      {isStreaming && <StreamingCursor />}
                      {msg.stopped && onContinueGenerate && (
                        <button
                          onClick={onContinueGenerate}
                          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-card border border-surface-border transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" />
                          继续生成
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {isUser && !selectMode && (
                <div className="mt-1 w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-text-secondary" />
                </div>
              )}
            </div>
          );
        })}

        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex gap-4 animate-message-appear">
            <div className="mt-1 w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-text-secondary" />
            </div>
            <div className="bg-[#F5F4F2] dark:bg-[#1F1F1F] rounded-2xl rounded-bl-sm px-4 py-3 flex items-center">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" />
                <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce [animation-delay:0.1s]" />
                <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce [animation-delay:0.2s]" />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
      </div>

      {/* 回到底部按钮 */}
      {showScrollButton && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center justify-center w-10 h-10 rounded-full
            bg-surface-elevated border border-surface-border text-text-secondary
            shadow-lg hover:bg-surface-card hover:text-text-primary transition-colors"
          aria-label="回到底部"
        >
          <ChevronDownIcon className="w-5 h-5" />
        </button>
      )}

      {/* 选择模式底部工具栏 */}
      {selectMode && (
        <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-center px-4 pb-4">
          <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-surface-elevated border border-surface-border shadow-xl">
            <span className="text-sm text-text-secondary">
              已选择 <span className="text-text-primary font-medium">{selectedIds.size}</span> 条消息
            </span>
            <div className="h-4 w-px bg-surface-border" />
            <button
              onClick={exitSelectMode}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-surface-card transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              取消
            </button>
            <button
              onClick={handleShareSelected}
              disabled={selectedIds.size === 0 || sharing}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-brand text-white hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
              {sharing ? "生成中..." : "生成分享链接"}
            </button>
          </div>
        </div>
      )}

      {/* 删除消息确认弹窗 */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="删除此消息"
        description="删除后，该消息将不可恢复。"
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget && onDeleteMessage) onDeleteMessage(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* 分享链接弹窗 */}
      <ShareDialog isOpen={shareOpen} slug={shareSlug} onClose={() => setShareOpen(false)} />
    </div>
  );
}
