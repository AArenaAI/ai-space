"use client";

import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import { User, Bot, Copy, Check, MoreHorizontal, Trash2, RotateCcw, Share2, X, SquareCheck, ChevronDown, ChevronUp, Lightbulb, Play, Search, ChevronDown as ChevronDownIcon, FileText, Wrench, Star, Columns2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Message, ChatModel } from "@/hooks/useChat";
import { useFavorites } from "@/hooks/useFavorites";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkFixBold from "@/lib/remark-fix-bold";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "@/components/theme/ThemeProvider";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ShareDialog from "@/components/ui/ShareDialog";
import { useSmartAutoScroll } from "@/hooks/useSmartAutoScroll";
import { useMessageStream } from "@/hooks/useMessageStream";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";
import { useSmoothStreaming } from "@/hooks/useSmoothStreaming";
import { inferGroups, InferredGroup } from "@/lib/groups";
import EChartsBlock from "./EChartsBlock";

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  isLoadingHistory?: boolean;
  isComplexTask?: boolean;
  models: ChatModel[];
  conversationId?: number;
  onDeleteMessage?: (id: string) => void;
  onRegenerate?: () => void;
  onContinueGenerate?: () => void;
  isCompare?: boolean;
  compareModels?: string[];
  onCompareModelChange?: (index: number, modelId: string) => void;
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  welcomeExamples?: { title: string; desc: string; prompt: string }[];
  onExampleClick?: (prompt: string) => void;
  groupViews?: Map<number, number>;
  switchGroupModel?: (groupId: number, activeIndex: number) => void;
  onForkCompare?: (messageId: number) => void;
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center">
      <span className="animate-bounce [animation-delay:0s]">.</span>
      <span className="animate-bounce [animation-delay:0.2s]">.</span>
      <span className="animate-bounce [animation-delay:0.4s]">.</span>
    </span>
  );
}

function WaveText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("relative inline-block overflow-hidden", className)}>
      <span className="text-text-secondary">{text}</span>
      <span
        className="pointer-events-none absolute inset-0 block -translate-x-full animate-shimmer"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
        }}
      />
    </span>
  );
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

function StreamingText({ messageId, content, isStreaming, className }: { messageId: string; content: string; isStreaming: boolean; className?: string }) {
  const streamText = useMessageStream(messageId, isStreaming);
  const effectiveText = isStreaming ? (streamText || content) : content;
  const hasThinkTag = effectiveText.includes("<think>");
  const fullParsed = parseThinkContent(effectiveText);
  const displayedText = useSmoothStreaming(effectiveText, isStreaming && !hasThinkTag, `${messageId}:full`);
  const displayedReasoning = useSmoothStreaming(fullParsed.reasoning || "", isStreaming && hasThinkTag, `${messageId}:reasoning`);
  const displayedAnswer = useSmoothStreaming(fullParsed.answer, isStreaming && hasThinkTag, `${messageId}:answer`);

  // 含 <think> 的消息必须用完整实时内容解析边界，不能先做整段打字机截断；
  // 否则 </think> 尚未显示时正文会被临时归入思考块。
  // 解析出 reasoning / answer 后分别做打字机，让思考块和正文都逐字显示。
  const parsed = hasThinkTag
    ? { ...fullParsed, reasoning: fullParsed.reasoning === null ? null : displayedReasoning, answer: displayedAnswer }
    : parseThinkContent(displayedText);
  const hasReason = !!parsed.reasoning;
  const hasContent = !!parsed.answer.trim();

  return (
    <span className={className}>
      {hasReason && (
        <div className="mb-3 rounded-xl border border-purple-200 dark:border-purple-800/40 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 dark:bg-[#1A1A2E]">
            <Lightbulb className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
            <span className="text-sm font-medium text-text-secondary">正在思考...</span>
            <div className="flex gap-0.5 ml-1">
              <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce" />
              <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce [animation-delay:0.15s]" />
              <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce [animation-delay:0.3s]" />
            </div>
          </div>
          <div className="px-3 py-2.5 text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap bg-slate-50 dark:bg-[#0F0F1A]">
            {parsed.reasoning || ""}
          </div>
        </div>
      )}
      <span className="whitespace-pre-wrap break-words">{parsed.answer}</span>
      {!hasContent && !hasReason && <ThinkingDots />}
      {isStreaming && <StreamingCursor />}
    </span>
  );
}

function AssistantMeta({ msg, isStreaming, model }: { msg: Message; isStreaming: boolean; model?: ChatModel }) {
  const realtime = useMessageRealtime(isStreaming ? msg.id : "");
  const activityStatus = realtime?.activityStatus ?? msg.activityStatus;
  const searchStatus = realtime?.searchStatus;
  const searchSources = realtime?.searchSources;

  if (!model) return null;

  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="flex items-center gap-1.5">
        <div className="w-1 h-1 rounded-full" style={{ backgroundColor: model.color }} />
        <span className="text-[11px] text-text-tertiary">{model.name}</span>
      </div>
      {searchStatus === "searching" && (
        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full text-blue-600 bg-blue-500/10">
          <Search className="w-3 h-3 animate-pulse" />
          正在联网搜索
        </span>
      )}
      {(searchStatus === "completed" || (searchSources && searchSources.length > 0)) && (
        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full text-green-600 bg-green-500/10">
          <Search className="w-3 h-3" />
          已联网搜索{searchSources && searchSources.length > 0 ? `·引用${searchSources.length}个来源` : ""}
        </span>
      )}
      {activityStatus && activityStatus.status !== "completed" && (
        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full text-amber-600 bg-amber-500/10">
          {activityStatus.kind === "tool_call" ? (
            <Wrench className="w-3 h-3 animate-pulse" />
          ) : activityStatus.kind === "file_search" ? (
            <FileText className="w-3 h-3 animate-pulse" />
          ) : (
            <Search className="w-3 h-3 animate-pulse" />
          )}
          {activityStatus.label}
        </span>
      )}
    </div>
  );
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

  // 把模型常见的 [ ... ] 行间公式转为 remark-math 识别的 $$...$$（含数学符号 = + - * / ^ _ \\times 等时）
  result = result.replace(
    /^\[\s*([^\]]*(?:[=+\-*/^\\]|\\[a-zA-Z]+|[_^])[^\]]*)\s*\]$/gm,
    "$$$$$1$$$$"
  );

  // 只移除搜索模块追加在末尾的来源区块；不要匹配普通正文里的"来源：AP"，否则会把新闻列表从第一条来源处截断
  result = result.replace(/\n{2,}[*_]*\s*(?:引用来源|参考来源|References|参考链接)[：:]\s*[\s\S]*$/, "");
  
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
  // GPT-5.5 Pro 的 reasoning summary 可能很长，默认展开会让历史消息渲染明显卡顿。
  const [expanded, setExpanded] = useState(() => isThinking || content.length < 2000);

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
          {isThinking ? "正在思考..." : `深度思考${content.length >= 2000 ? " · 已折叠" : ""}`}
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
  onFavorite,
  isFavorited,
  showRegenerate,
}: {
  onCopy: () => void;
  onDelete: () => void;
  onRegenerate?: () => void;
  onSelectMode: () => void;
  onFavorite?: () => void;
  isFavorited?: boolean;
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
            {onFavorite && (
              <button
                onClick={() => { onFavorite(); setOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
              >
                <Star className={cn("w-3.5 h-3.5", isFavorited && "fill-amber-400 text-amber-400")} />
                {isFavorited ? "取消收藏" : "收藏"}
              </button>
            )}
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

function MessageActions({
  onCopy,
  onDelete,
  onRegenerate,
  onSelectMode,
  onFavorite,
  isFavorited,
  showRegenerate,
  align,
  visible,
  createdAt,
  completedAt,
  onForkCompare,
}: {
  onCopy: () => void;
  onDelete: () => void;
  onRegenerate?: () => void;
  onSelectMode: () => void;
  onFavorite?: () => void;
  isFavorited?: boolean;
  showRegenerate: boolean;
  align: "left" | "right";
  visible: boolean;
  createdAt: number;
  completedAt?: number;
  onForkCompare?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    if (moreOpen) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [moreOpen]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const timeStr = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    if (isToday) return timeStr;
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return `${month}月${day}日 ${timeStr}`;
  };

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) return `${minutes}分${seconds}秒`;
    return `${seconds}秒`;
  };

  const durationMs = completedAt ? completedAt - createdAt : 0;

  return (
    <div className={cn(
      "flex items-center gap-0.5 mt-1 transition-opacity duration-200",
      align === "right" ? "justify-end" : "justify-start",
      visible ? "opacity-100" : "opacity-0 group-hover:opacity-100"
    )}>
      <button
        onClick={() => { onCopy(); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
        title="复制"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {onForkCompare && align === "right" && (
        <button
          onClick={onForkCompare}
          className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
          title="对比"
        >
          <Columns2 className="w-3.5 h-3.5" />
        </button>
      )}
      {showRegenerate && onRegenerate && (
        <button
          onClick={onRegenerate}
          className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
          title="重新生成"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        onClick={onSelectMode}
        className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
        title="选择分享"
      >
        <Share2 className="w-3.5 h-3.5" />
      </button>
      {onFavorite && (
        <button
          onClick={onFavorite}
          className={cn(
            "p-1 rounded-md transition-colors",
            isFavorited
              ? "text-amber-400 hover:text-amber-500 hover:bg-amber-400/10"
              : "text-text-tertiary hover:text-amber-400 hover:bg-amber-400/10"
          )}
          title={isFavorited ? "取消收藏" : "收藏"}
        >
          <Star className={cn("w-3.5 h-3.5", isFavorited && "fill-amber-400")} />
        </button>
      )}
      <button
        onClick={onDelete}
        className="p-1 rounded-md text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
        title="删除"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <div className="relative" ref={moreRef}>
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
          title="更多"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        {moreOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
            <div className={cn(
              "absolute top-full mt-1 w-40 rounded-xl border border-surface-border bg-surface-elevated shadow-xl z-50 py-2 px-3 animate-fade-in",
              align === "right" ? "right-0" : "left-0"
            )}>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-tertiary">起始时间</span>
                  <span className="text-text-secondary">{formatTime(createdAt)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-tertiary">耗时</span>
                  <span className="text-text-secondary">{formatDuration(durationMs)}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 模块级：缓存 ReactMarkdown components，避免每次渲染重新挂载 Markdown 节点
const markdownComponents = {
  code({ node, inline, className, children, ...props }: any) {
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

function MessageList({
  messages,
  isLoading,
  isLoadingHistory,
  isComplexTask = false,
  models,
  conversationId,
  onDeleteMessage,
  onRegenerate,
  onContinueGenerate,
  isCompare = false,
  compareModels = [],
  onCompareModelChange,
  welcomeTitle,
  welcomeSubtitle,
  welcomeExamples,
  onExampleClick,
  groupViews,
  switchGroupModel,
  onForkCompare,
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
  const [compareModelMenuOpen, setCompareModelMenuOpen] = useState<number | null>(null);
  const groups = useMemo(() => inferGroups(messages), [messages]);
  const groupByMessageId = useMemo(() => {
    const map = new Map<string, InferredGroup>();
    groups.forEach((group) => {
      map.set(group.userMessage.id, group);
      group.assistantMessages.forEach((assistant) => map.set(assistant.id, group));
    });
    return map;
  }, [groups]);
  const modelById = useMemo(() => {
    const map = new Map<string, ChatModel>();
    models.forEach((model) => map.set(model.id, model));
    return map;
  }, [models]);
  const activeCompareModels = useMemo(() => {
    if (!isCompare) return [];
    return compareModels && compareModels.length > 0
      ? compareModels
      : Array.from(new Set(messages.filter((m) => m.role === "assistant" && m.model).map((m) => m.model!)));
  }, [compareModels, isCompare, messages]);
  const columnMessages = useMemo(() => {
    if (!isCompare) return [];
    return activeCompareModels.map((modelId) =>
      messages.filter((msg) => msg.role === "user" || msg.model === modelId)
    );
  }, [activeCompareModels, isCompare, messages]);

  // 收藏功能
  const { toggleFavorite, isFavorited, checkBatch } = useFavorites();

  // 批量检查消息收藏状态
  useEffect(() => {
    const ids = messages
      .map((m) => m.serverMessageId)
      .filter((id): id is number => typeof id === "number" && id > 0);
    if (ids.length > 0) {
      checkBatch(ids);
    }
  }, [messages, checkBatch]);

  // 读取本地用户信息（必须在条件分支之前调用 Hook）
  const [userName, setUserName] = useState<string>("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem("user");
      if (raw) {
        const parsed = JSON.parse(raw);
        setUserName(parsed.name || parsed.email || "");
      }
    } catch {}
  }, []);

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


  const isMessageGenerating = (msg: Message, isStreaming: boolean) => {
    if (isStreaming) return true;
    if (msg.completedAt || msg.stopped) return false;
    if (msg.activityStatus?.status === "running" || msg.activityStatus?.status === "searching") return true;
    return !!(msg.generationTaskId || msg.backgroundTaskId || msg.useBackground || msg.isComplexTask);
  };

  const renderAssistantContent = (msg: Message, isStreaming: boolean) => {
    const generating = isMessageGenerating(msg, isStreaming);
    if (generating) {
      return <StreamingText messageId={msg.id} content={msg.content || msg.activityStatus?.label || "任务繁忙，正在生成中"} isStreaming={true} className="text-[15px] leading-relaxed text-text-primary" />;
    }
    if (!msg.content) {
      return <div className="text-[15px] leading-relaxed text-text-secondary">生成中断，可点击重新生成</div>;
    }
    const { reasoning, answer, isThinking } = parseThinkContent(msg.content);
    const cleanAnswer = sanitizeContent(answer);
    return (
      <div className="prose prose-sm max-w-none">
        {reasoning && <ThinkBlock content={reasoning} isThinking={isThinking} />}
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkFixBold, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={markdownComponents}
        >
          {cleanAnswer}
        </ReactMarkdown>
      </div>
    );
  };

  const renderCompareModelHeader = (modelId: string, index: number) => {
    const model = modelById.get(modelId);
    const isOpen = compareModelMenuOpen === index;
    return (
      <div className="flex items-center justify-between gap-3 border-b border-surface-border bg-surface-card px-4 py-3">
        <div className="relative">
          <button
            onClick={() => setCompareModelMenuOpen(isOpen ? null : index)}
            className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-surface-border bg-surface-elevated px-3 py-1.5 text-sm text-text-primary hover:bg-surface-card transition-colors"
          >
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
              style={{ backgroundColor: model?.color || undefined }}
            >
              {(model?.name || modelId || `模型${index + 1}`).slice(0, 1).toUpperCase()}
            </div>
            <span className="truncate font-medium">{model?.name || modelId || `模型 ${index + 1}`}</span>
            <ChevronDownIcon className={cn("h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform", isOpen && "rotate-180")} />
          </button>

          {isOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setCompareModelMenuOpen(null)} />
              <div className="absolute top-full left-0 mt-2 w-[260px] z-50 rounded-xl border border-surface-border bg-surface-elevated shadow-xl overflow-hidden max-h-[70vh] overflow-y-auto">
                <div className="px-3 py-2 text-[11px] font-medium text-text-tertiary uppercase tracking-wider border-b border-surface-border">
                  选择模型
                </div>
                <div className="py-1">
                  {models.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        onCompareModelChange?.(index, m.id);
                        setCompareModelMenuOpen(null);
                      }}
                      className={cn(
                        "flex items-center gap-3 w-full px-3 py-2 text-left transition-colors hover:bg-surface-card",
                        m.id === modelId && "bg-brand/5"
                      )}
                    >
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                      <span className={cn("flex-1 text-sm truncate", m.id === modelId ? "text-brand font-medium" : "text-text-secondary")}>
                        {m.name}
                      </span>
                      {m.id === modelId && <Check className="w-3.5 h-3.5 text-brand shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
          aria-label="关闭对比列"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  };

  const renderCompareWelcome = (modelId: string, index: number) => (
    <div key={modelId || index} className="flex min-h-[360px] flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-sm">
      {renderCompareModelHeader(modelId, index)}
      <div className="flex-1 px-8 pb-10 pt-20">
        <h2 className="text-3xl font-semibold tracking-tight text-text-primary">你好，</h2>
        <p className="mt-3 text-xl font-medium text-text-primary">我今天能帮你什么？</p>
      </div>
    </div>
  );

  if (isCompare) {
    return (
      <div className="relative flex-1 overflow-hidden">
        <div className="h-full px-3 py-3">
          <div className="mx-auto h-full">
            <div className="flex gap-3 h-full">
              {activeCompareModels.map((modelId, colIndex) => {
                const colMsgs = columnMessages[colIndex];
                return (
                  <div key={modelId} className="flex-1 min-w-0 flex flex-col h-full rounded-2xl border border-surface-border bg-surface-card shadow-sm overflow-hidden">
                    {renderCompareModelHeader(modelId, colIndex)}

                    <div className="flex-1 space-y-5 px-4 py-5 overflow-y-auto">
                    {messages.length === 0 ? (
                      <div className="flex flex-col pt-16 pb-10">
                        <h2 className="text-3xl font-semibold tracking-tight text-text-primary">你好，</h2>
                        <p className="mt-3 text-base font-medium text-text-secondary">我今天能帮你什么？</p>
                      </div>
                    ) : (
                      <>
                        {colMsgs.map((msg, msgIndex) => {
                          const model = msg.model ? modelById.get(msg.model) : undefined;
                          const isUser = msg.role === "user";
                          const isLast = msgIndex === colMsgs.length - 1;
                          const isStreaming = isLoading && msg.role === "assistant" && !msg.completedAt && isLast;
                          const isGenerating = !isUser && isMessageGenerating(msg, isStreaming);
                          const canRegenerate = !isUser && (isLast || !msg.content) && !isLoading && !isGenerating;

                          return (
                            <div key={`${colIndex}-${msg.id}`} className="flex gap-3 animate-message-appear group">
                              <div className="mt-1 w-7 shrink-0">
                                {!isUser && (
                                  <div className="w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center">
                                    <Bot className="w-4 h-4 text-text-secondary" />
                                  </div>
                                )}
                              </div>

                              <div className={cn("flex-1 flex min-w-0", isUser ? "justify-end" : "justify-start")}>
                                <div className="flex flex-col gap-1 min-w-0">
                                  <div
                                    className={cn(
                                      "px-4 py-3 relative w-fit max-w-full",
                                      isUser
                                        ? "rounded-2xl rounded-br-sm bg-[#EFF6FF] dark:bg-[#1E293B]"
                                        : "rounded-2xl rounded-bl-sm bg-[#F5F4F2] dark:bg-[#1F1F1F]"
                                    )}
                                  >
                                    {!isUser && model && (
                                      <AssistantMeta msg={msg} isStreaming={isStreaming} model={model} />
                                    )}

                                    {isUser ? (
                                      <div className="flex flex-col gap-2">
                                        {msg.files && msg.files.length > 0 && (
                                          <div className="flex flex-wrap gap-2">
                                            {msg.files.map((f, fi) => {
                                              if (f.type === "image") {
                                                return (
                                                  <div key={fi} className="relative group/file rounded-xl overflow-hidden border border-surface-border bg-surface-card">
                                                    <img
                                                      src={`/api/files/${f.public_id}/download`}
                                                      alt={f.filename}
                                                      className="max-w-[200px] max-h-[200px] object-cover rounded-xl"
                                                      onError={(e) => {
                                                        (e.target as HTMLImageElement).src = "";
                                                        (e.target as HTMLImageElement).classList.add("hidden");
                                                        (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                                                      }}
                                                    />
                                                    <div className="hidden text-xs text-text-tertiary px-3 py-2">图片加载失败</div>
                                                  </div>
                                                );
                                              }
                                              return null;
                                            })}
                                          </div>
                                        )}
                                        {msg.files && msg.files.some(f => f.type !== "image") && (
                                          <div className="flex flex-wrap gap-2">
                                            {msg.files.filter(f => f.type !== "image").map((f, fi) => (
                                              <a
                                                key={fi}
                                                href={`/api/files/${f.public_id}/download`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-card border border-surface-border hover:border-brand/30 transition-colors"
                                              >
                                                <FileText className="w-4 h-4 text-text-tertiary shrink-0" />
                                                <span className="text-[13px] text-text-secondary truncate max-w-[200px]">{f.filename}</span>
                                              </a>
                                            ))}
                                          </div>
                                        )}
                                        <div className="flex items-start justify-between gap-2">
                                          {msg.content ? (
                                            <p className="text-[15px] leading-relaxed text-text-primary whitespace-pre-wrap">{msg.content}</p>
                                          ) : null}
                                        </div>
                                      </div>
                                    ) : (
                                      renderAssistantContent(msg, isStreaming)
                                    )}
                                  </div>

                                  {!isUser && !isStreaming && (
                                    <div className="flex items-center gap-2 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <MessageActions
                                        onCopy={() => handleCopy(msg.content)}
                                        onDelete={() => setDeleteTarget(msg.id)}
                                        onRegenerate={onRegenerate}
                                        onSelectMode={enterSelectMode}
                                        onFavorite={msg.serverMessageId && conversationId ? () => toggleFavorite(msg.serverMessageId!, conversationId) : undefined}
                                        isFavorited={msg.serverMessageId ? isFavorited(msg.serverMessageId) : false}
                                        showRegenerate={canRegenerate}
                                        align={isUser ? "right" : "left"}
                                        visible={isLast}
                                        createdAt={msg.createdAt}
                                        completedAt={msg.completedAt}
                                      />
                                    </div>
                                  )}
                                  {isUser && !isStreaming && (
                                    <div className="flex items-center justify-end gap-2 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <MessageActions
                                        onCopy={() => handleCopy(msg.content)}
                                        onDelete={() => setDeleteTarget(msg.id)}
                                        onSelectMode={enterSelectMode}
                                        showRegenerate={false}
                                        align="right"
                                        visible={isLast}
                                        createdAt={msg.createdAt}
                                        onForkCompare={msg.serverMessageId ? () => onForkCompare?.(msg.serverMessageId!) : undefined}
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="mt-1 w-7 shrink-0">
                                {isUser && (
                                  <div className="w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center">
                                    <User className="w-4 h-4 text-text-secondary" />
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {isLoading && colMsgs[colMsgs.length - 1]?.role !== "assistant" && (
                          <div className="flex gap-3 animate-message-appear">
                            <div className="mt-1 w-7 shrink-0">
                              <div className="w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center">
                                <Bot className="w-4 h-4 text-text-secondary" />
                              </div>
                            </div>
                            <div className="flex-1 flex justify-start">
                              <div className="bg-[#F5F4F2] dark:bg-[#1F1F1F] rounded-2xl rounded-bl-sm px-4 py-3 flex items-center">
                                <div className="flex items-center gap-1.5 text-sm text-text-secondary">
                                  {isComplexTask && (
                                    <span className="inline-flex items-center gap-0.5">
                                      <WaveText text="深度推理中，片刻即达极致答案" />
                                      <ThinkingDots />
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="mt-1 w-7 shrink-0" />
                          </div>
                        )}
                      </>
                    )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div ref={bottomRef} />
          </div>
        </div>

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
        <ShareDialog isOpen={shareOpen} slug={shareSlug} onClose={() => setShareOpen(false)} />
      </div>
    );
  }

  if (messages.length === 0) {
    if (isLoadingHistory) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex gap-2">
            <div className="w-2 h-2 rounded-full bg-text-tertiary animate-bounce" />
            <div className="w-2 h-2 rounded-full bg-text-tertiary animate-bounce [animation-delay:0.15s]" />
            <div className="w-2 h-2 rounded-full bg-text-tertiary animate-bounce [animation-delay:0.3s]" />
          </div>
        </div>
      );
    }
    const hasCustomWelcome = welcomeExamples && welcomeExamples.length > 0;
    const defaultExamples = [
      { title: "知识问答", desc: "用通俗易懂的方式讲清一个话题，并给出3个延伸阅读方向", prompt: "用通俗易懂的方式讲清一个话题，并给出3个延伸阅读方向" },
      { title: "写作助手", desc: "帮我把这段文字改写得更专业、更精炼，并保留原意", prompt: "帮我把这段文字改写得更专业、更精炼，并保留原意" },
      { title: "代码辅助", desc: "解释这段代码的工作原理，并给出优化建议", prompt: "解释这段代码的工作原理，并给出优化建议" },
    ];
    const examples = hasCustomWelcome ? welcomeExamples : defaultExamples;

    return (
      <div className="flex-1 flex flex-col items-center justify-start px-4 pt-48 pb-12">
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
              <h1 className="text-2xl font-semibold tracking-tight mb-2 text-text-primary">
                {userName ? `${userName}，您好` : "您好"}
              </h1>
              <p className="text-text-secondary text-[15px] leading-relaxed">需要我们为你做些什么？</p>
            </>
          )}
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
        {messages.map((msg, index) => {
          const group = groupByMessageId.get(msg.id);
          const isUser = msg.role === "user";

          // 非活跃 assistant 跳过渲染
          if (!isUser && group && group.assistantMessages.length > 1) {
            const activeIndex = groupViews?.get(group.id) ?? 0;
            const activeMsg = group.assistantMessages[activeIndex] ?? group.assistantMessages[0];
            if (msg.id !== activeMsg?.id) return null;
          }

          const model = msg.model ? modelById.get(msg.model) : undefined;
          const isLast = index === messages.length - 1;
          const isStreaming = isLoading && msg.role === "assistant" && !msg.completedAt && isLast;
          const isGenerating = !isUser && isMessageGenerating(msg, isStreaming);
          const canRegenerate = !isUser && (isLast || !msg.content) && !isLoading && !isGenerating;
          const isSelected = selectedIds.has(msg.id);

          return (
            <div
              key={msg.id}
              className="flex gap-3 animate-message-appear group"
            >
              {/* 左侧：AI头像 / 用户复选框 */}
              <div className="mt-1 w-7 shrink-0">
                {!isUser && !selectMode && (
                  <div className="w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center">
                    <Bot className="w-4 h-4 text-text-secondary" />
                  </div>
                )}
                {isUser && selectMode && (
                  <button
                    onClick={() => toggleSelect(index)}
                    className={cn(
                      "w-5 h-5 rounded-md border flex items-center justify-center transition-colors",
                      isSelected
                        ? "bg-brand border-brand text-white"
                        : "border-surface-border text-transparent hover:border-brand/50"
                    )}
                  >
                    {isSelected && <SquareCheck className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>

              {/* 中间内容 */}
              <div className={cn("flex-1 flex min-w-0", isUser ? "justify-end" : "justify-start")}>
                <div className="flex flex-col gap-1 min-w-0">
                  {!isUser && group && group.assistantMessages.length > 1 && (
                    <div className="flex items-center gap-1.5 mb-1">
                      {group.assistantMessages.map((a, idx) => {
                        const m = a.model ? modelById.get(a.model) : undefined;
                        const isActive = (groupViews?.get(group.id) ?? 0) === idx;
                        return (
                          <button
                            key={a.id}
                            onClick={() => switchGroupModel?.(group.id, idx)}
                            className={cn(
                              "flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] transition-colors",
                              isActive
                                ? "bg-brand/10 text-brand font-medium"
                                : "bg-surface-card text-text-secondary hover:bg-surface-elevated"
                            )}
                          >
                            <div
                              className="w-3 h-3 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                              style={{ backgroundColor: m?.color }}
                            >
                              {(m?.name || a.model || `模型${idx + 1}`).slice(0, 1).toUpperCase()}
                            </div>
                            <span className="truncate max-w-[80px]">{m?.name || a.model || `模型 ${idx + 1}`}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div
                    className={cn(
                      "px-4 py-3 relative w-fit max-w-full",
                      isUser
                        ? "rounded-2xl rounded-br-sm bg-[#EFF6FF] dark:bg-[#1E293B]"
                        : "rounded-2xl rounded-bl-sm bg-[#F5F4F2] dark:bg-[#1F1F1F]"
                    )}
                  >

                  {!isUser && model && !selectMode && (
                    <AssistantMeta msg={msg} isStreaming={isStreaming} model={model} />
                  )}

                  {isUser ? (
                    <div className="flex flex-col gap-2">
                      {/* 图片附件渲染 */}
                      {msg.files && msg.files.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {msg.files.map((f, fi) => {
                            if (f.type === "image") {
                              return (
                                <div key={fi} className="relative group/file rounded-xl overflow-hidden border border-surface-border bg-surface-card">
                                  <img
                                    src={`/api/files/${f.public_id}/download`}
                                    alt={f.filename}
                                    className="max-w-[200px] max-h-[200px] object-cover rounded-xl"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).src = "";
                                      (e.target as HTMLImageElement).classList.add("hidden");
                                      (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                                    }}
                                  />
                                  <div className="hidden text-xs text-text-tertiary px-3 py-2">图片加载失败</div>
                                </div>
                              );
                            }
                            return null;
                          })}
                        </div>
                      )}
                      {/* 非图片文件卡片 */}
                      {msg.files && msg.files.some(f => f.type !== "image") && (
                        <div className="flex flex-wrap gap-2">
                          {msg.files.filter(f => f.type !== "image").map((f, fi) => (
                            <a
                              key={fi}
                              href={`/api/files/${f.public_id}/download`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-card border border-surface-border hover:border-brand/30 transition-colors"
                            >
                              <FileText className="w-4 h-4 text-text-tertiary shrink-0" />
                              <span className="text-[13px] text-text-secondary truncate max-w-[200px]">{f.filename}</span>
                            </a>
                          ))}
                        </div>
                      )}
                      <div className="flex items-start justify-between gap-2">
                        {msg.content ? (
                          <p className="text-[15px] leading-relaxed text-text-primary whitespace-pre-wrap">{msg.content}</p>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <>
                      {renderAssistantContent(msg, isStreaming)}
                      {msg.stopped && onContinueGenerate && (
                        <button
                          onClick={onContinueGenerate}
                          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-card border border-surface-border transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" />
                          继续生成
                        </button>
                      )}
                    </>
                  )}
                </div>
                {!selectMode && !isStreaming && (
                  <MessageActions
                    onCopy={() => handleCopy(msg.content)}
                    onDelete={() => setDeleteTarget(msg.id)}
                    onRegenerate={onRegenerate}
                    onSelectMode={enterSelectMode}
                    onFavorite={msg.serverMessageId && conversationId ? () => toggleFavorite(msg.serverMessageId!, conversationId) : undefined}
                    isFavorited={msg.serverMessageId ? isFavorited(msg.serverMessageId) : false}
                    showRegenerate={canRegenerate}
                    align={isUser ? "right" : "left"}
                    visible={isLast}
                    createdAt={msg.createdAt}
                    completedAt={msg.completedAt}
                    onForkCompare={isUser && msg.serverMessageId ? () => onForkCompare?.(msg.serverMessageId!) : undefined}
                  />
                )}
              </div>
              </div>

              {/* 右侧：用户头像 / AI复选框 */}
              <div className="mt-1 w-7 shrink-0">
                {isUser && !selectMode && (
                  <div className="w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center">
                    <User className="w-4 h-4 text-text-secondary" />
                  </div>
                )}
                {!isUser && selectMode && (
                  <button
                    onClick={() => toggleSelect(index)}
                    className={cn(
                      "w-5 h-5 rounded-md border flex items-center justify-center transition-colors",
                      isSelected
                        ? "bg-brand border-brand text-white"
                        : "border-surface-border text-transparent hover:border-brand/50"
                    )}
                  >
                    {isSelected && <SquareCheck className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex gap-3 animate-message-appear">
            <div className="mt-1 w-7 shrink-0">
              <div className="w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center">
                <Bot className="w-4 h-4 text-text-secondary" />
              </div>
            </div>
            <div className="flex-1 flex justify-start">
              <div className="bg-[#F5F4F2] dark:bg-[#1F1F1F] rounded-2xl rounded-bl-sm px-4 py-3 flex items-center">
                <div className="flex items-center gap-1.5 text-sm text-text-secondary">
                  {isComplexTask && (
                    <span className="inline-flex items-center gap-0.5">
                      <WaveText text="深度推理中，片刻即达极致答案" />
                      <ThinkingDots />
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-1 w-7 shrink-0" />
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

export default memo(MessageList);
