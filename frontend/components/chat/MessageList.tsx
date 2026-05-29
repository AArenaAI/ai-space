"use client";

import { useEffect, useRef, useState, useCallback, useMemo, memo, type Ref, type UIEvent, type ReactNode, type ButtonHTMLAttributes } from "react";
import { User, Bot, Copy, Check, MoreHorizontal, Trash2, RotateCcw, Share2, X, SquareCheck, ChevronDown, ChevronUp, Lightbulb, Play, ChevronDown as ChevronDownIcon, FileText, Star, Columns2, Loader2, Download, ImageIcon, Sparkles } from "lucide-react";
import { toPng } from "html-to-image";
import { cn } from "@/lib/utils";
import { Message, ChatModel } from "@/hooks/useChat";
import { useFavorites } from "@/hooks/useFavorites";
import { toast } from "sonner";
import dynamic from "next/dynamic";
const ReactMarkdown = dynamic(() => import("react-markdown"), { ssr: false });
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
import { Virtuoso, VirtuosoHandle, type Components } from "react-virtuoso";
import { useMessageStream } from "@/hooks/useMessageStream";
import { inferGroups, InferredGroup } from "@/lib/groups";
import EChartsBlock from "./EChartsBlock";
import { useI18n } from "@/lib/i18n";
import { AssistantMessageMeta } from "./AssistantMessageMeta";
import ModelSelector from "./ModelSelector";
import { StreamingText } from "./StreamingText";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";

const CHAT_BOTTOM_SPACER = 280;
const SCROLL_TO_BOTTOM_OFFSET = 238;
const SELECT_MODE_EXTRA_SPACER = 80;
const LONG_REASONING_COLLAPSE_THRESHOLD = 2000;
const LONG_MARKDOWN_LAZY_THRESHOLD = 4000;
type SelectionMode = "share" | "favorite";

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
  isLoadingMore?: boolean;
  hasMoreMessages?: boolean;
  onLoadMore?: () => void | Promise<void>;
  targetMessageId?: number;
  bottomSpacer?: number;
  onSelectModeChange?: (active: boolean) => void;
  onExitCompare?: () => void;
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

function normalizeExportPlainText(content: string): string {
  return content
    .replace(/```([\w-]+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
      const label = lang ? `代码（${lang}）` : "代码";
      return `\n【${label}】\n${String(code).trim()}\n【代码结束】\n`;
    })
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1（$2）")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "引用：")
    .replace(/^\s{0,3}[-*+]\s+/gm, "• ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatMessageForTextExport(msg: Message, index: number, total: number): string {
  const roleLabel = msg.role === "user" ? "用户" : "AI Space";
  const title = `【${index + 1}/${total} ${roleLabel}】`;

  if (msg.role === "user") {
    const content = normalizeExportPlainText(msg.content || "");
    return `${title}\n${content || "（空消息）"}`;
  }

  const { reasoning, answer, isThinking } = parseThinkContent(msg.content || "");
  const cleanAnswer = normalizeExportPlainText(sanitizeContent(answer));
  const cleanReasoning = reasoning ? normalizeExportPlainText(reasoning) : "";
  const sections: string[] = [title];

  if (cleanReasoning) {
    sections.push(`【深度推理${isThinking ? "中" : ""}】\n${cleanReasoning}`);
  }

  sections.push(`【回答】\n${cleanAnswer || "（空回答）"}`);
  return sections.join("\n\n");
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
  // 正在实时推理时保持展开；历史长推理默认折叠，避免进入旧会话时一次性渲染大段文本。
  const shouldCollapseByDefault = !isThinking && content.length >= LONG_REASONING_COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(() => !shouldCollapseByDefault);

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
          {isThinking ? "深度推理中，片刻即达极致答案" : `深度推理${shouldCollapseByDefault && !expanded ? " · 已折叠" : ""}`}
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

function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn(
      "pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-2xl bg-surface-elevated border border-surface-border shadow-xl",
      className
    )}>
      {children}
    </div>
  );
}

function ActionBarGroup({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2">{children}</div>;
}

function ActionBarDivider() {
  return <div className="h-4 w-px bg-surface-border" />;
}

function ActionBarButton({
  children,
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "secondary" | "primary" }) {
  return (
    <button
      {...props}
      className={cn(
        "flex items-center gap-1.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        variant === "primary"
          ? "px-4 py-1.5 font-medium bg-brand text-white hover:bg-brand-hover"
          : "px-3 py-1.5 text-text-secondary hover:bg-surface-card hover:text-text-primary",
        className
      )}
    >
      {children}
    </button>
  );
}

// 导出为下拉菜单
function ExportDropdown({
  onExportImage,
  onExportText,
  disabled,
  exporting,
}: {
  onExportImage: () => void;
  onExportText: () => void;
  disabled: boolean;
  exporting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-surface-card border border-surface-border text-text-primary hover:bg-surface-elevated disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        {exporting ? "导出中..." : "导出为"}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-1 w-36 rounded-xl border border-surface-border bg-surface-elevated shadow-xl z-50 py-1 animate-fade-in">
            <button
              onClick={() => { onExportImage(); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              导出为图片
            </button>
            <button
              onClick={() => { onExportText(); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              导出为 TXT
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// 消息操作菜单
function MessageMenu({
  onCopy,
  onDelete,
  onRegenerate,
  onShareSelectMode,
  onFavoriteSelectMode,
  isFavorited,
  showRegenerate,
}: {
  onCopy: () => void;
  onDelete: () => void;
  onRegenerate?: () => void;
  onShareSelectMode: () => void;
  onFavoriteSelectMode?: () => void;
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
        className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
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
              onClick={() => { onShareSelectMode(); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
              选择分享
            </button>
            {onFavoriteSelectMode && (
              <button
                onClick={() => { onFavoriteSelectMode(); setOpen(false); }}
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
  onShareSelectMode,
  onFavoriteSelectMode,
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
  onShareSelectMode: () => void;
  onFavoriteSelectMode?: () => void;
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
      "mt-1 inline-flex items-center gap-0.5 rounded-xl bg-surface-card/80 px-1 py-0.5 transition-opacity duration-200",
      align === "right" ? "justify-end" : "justify-start",
      visible ? "opacity-100" : "opacity-0 group-hover:opacity-100"
    )}>
      <button
        onClick={() => { onCopy(); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
        title="复制"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>

      {showRegenerate && onRegenerate && (
        <button
          onClick={onRegenerate}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
          title="重新生成"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        onClick={onShareSelectMode}
        className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
        title="选择分享"
      >
        <Share2 className="w-3.5 h-3.5" />
      </button>
      {onFavoriteSelectMode && (
        <button
          onClick={onFavoriteSelectMode}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-lg transition-colors",
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
        className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
        title="删除"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <div className="relative" ref={moreRef}>
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
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

const markdownRemarkPlugins = [remarkGfm, remarkFixBold, remarkMath];
const markdownRehypePlugins = [rehypeKatex];

const MemoMarkdownRenderer = memo(function MemoMarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={markdownRemarkPlugins}
      rehypePlugins={markdownRehypePlugins}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
});

function LazyMarkdownRenderer({ content }: { content: string }) {
  if (content.length < LONG_MARKDOWN_LAZY_THRESHOLD) {
    return <MemoMarkdownRenderer content={content} />;
  }
  return <DeferredMarkdownRenderer content={content} />;
}

function ExportMessageContent({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return <div className="whitespace-pre-wrap break-words">{msg.content || ""}</div>;
  }

  const { reasoning, answer, isThinking } = parseThinkContent(msg.content || "");
  const cleanAnswer = sanitizeContent(answer);

  return (
    <div className="prose prose-sm max-w-none text-white/90">
      {reasoning && (
        <div className="mb-3 overflow-hidden rounded-xl border border-white/10 bg-white/8">
          <div className="flex items-center gap-2 px-3 py-2 bg-white/10">
            <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-300" />
            <span className="text-sm font-medium text-white/75">
              {isThinking ? "深度推理中，片刻即达极致答案" : "深度推理"}
            </span>
          </div>
          <div className="whitespace-pre-wrap px-3 py-2.5 text-[13px] leading-relaxed text-white/70">
            {reasoning}
          </div>
        </div>
      )}
      <MemoMarkdownRenderer content={cleanAnswer} />
    </div>
  );
}

function ExportShareCard({ messages, cardRef }: { messages: Message[]; cardRef?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={cardRef}
      className="relative w-full overflow-hidden rounded-3xl p-8 shadow-2xl"
      style={{
        background: "linear-gradient(135deg, #111827 0%, #1e1b4b 48%, #312e81 100%)",
      }}
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-brand/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-purple-500/25 blur-3xl" />

      <div className="relative z-10 mb-7 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/15">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-lg font-semibold text-white">AI Space</div>
          <div className="text-xs text-white/50">智能对话分享</div>
        </div>
      </div>

      <div className="relative z-10 space-y-5">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div key={msg.id} className={cn("flex", isUser ? "justify-end" : "justify-start gap-3")}>
              {!isUser && (
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10">
                  <Bot className="h-4 w-4 text-white/70" />
                </div>
              )}
              <div className="max-w-[82%]">
                {!isUser && <div className="mb-1 ml-1 text-[11px] text-white/45">AI Space</div>}
                <div
                  className={cn(
                    "break-words rounded-2xl border px-4 py-3 text-sm leading-relaxed shadow-sm",
                    isUser
                      ? "rounded-br-md border-white/15 bg-white/18 text-white"
                      : "rounded-bl-md border-white/10 bg-white/10 text-white/90"
                  )}
                >
                  <ExportMessageContent msg={msg} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="relative z-10 mt-8 flex items-center justify-between border-t border-white/10 pt-5 text-xs text-white/45">
        <span>{new Date().toLocaleDateString("zh-CN")}</span>
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" /> 由 AI Space 生成
        </span>
      </div>
    </div>
  );
}

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
  isLoadingMore,
  hasMoreMessages,
  onLoadMore,
  targetMessageId,
  onSelectModeChange,
  onExitCompare,
}: MessageListProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const loadingMoreTriggeredRef = useRef(false);
  const programmaticScrollUntilRef = useRef(0);
  const userScrollOverrideUntilRef = useRef(0);
  const bottomLockRafRef = useRef<number>(0);
  const bottomLockTimersRef = useRef<number[]>([]);

  const scrollToBottom = useCallback(() => {
    programmaticScrollUntilRef.current = Date.now() + 320;
    const el = scrollRef.current;
    if (el) {
      const nextTop = Math.ceil(el.scrollHeight - el.clientHeight);
      el.scrollTop = nextTop;
      lastScrollTopRef.current = el.scrollTop;
      return;
    }
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
  }, []);

  const lockBottomAfterLayout = useCallback(() => {
    if (bottomLockRafRef.current) cancelAnimationFrame(bottomLockRafRef.current);
    bottomLockTimersRef.current.forEach(window.clearTimeout);
    bottomLockTimersRef.current = [];

    const lock = () => {
      if (Date.now() < userScrollOverrideUntilRef.current) return;
      if (stickToBottomRef.current) scrollToBottom();
    };

    bottomLockRafRef.current = requestAnimationFrame(() => {
      lock();
      bottomLockRafRef.current = requestAnimationFrame(() => {
        bottomLockRafRef.current = 0;
        lock();
      });
    });

    // Virtuoso 对最后一项换行后的高度测量可能晚于 RAF，补两次 post-layout 锁底，
    // 否则每新增一行会短暂把底部 Composer 顶出一行高。
    bottomLockTimersRef.current = [
      window.setTimeout(lock, 80),
      window.setTimeout(lock, 180),
    ];
  }, [scrollToBottom]);

  const handleVirtuosoScrollerRef = useCallback((ref: Window | HTMLElement | null) => {
    const el = ref instanceof HTMLElement ? (ref as HTMLDivElement) : null;
    scrollRef.current = el;
    if (el) {
      lastScrollTopRef.current = el.scrollTop;
    }
  }, []);

  const handleVirtuosoScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const el = event.currentTarget;
    scrollRef.current = el as HTMLDivElement;

    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isScrollingUp = el.scrollTop < lastScrollTopRef.current;

    // stickToBottom 表示用户意图，只在明确上滑离开底部时关闭；
    // 用户主动上滑时立即打断补偿锁底，避免流式内容继续增长时把视图吸回底部。
    const isProgrammaticScroll = Date.now() < programmaticScrollUntilRef.current;
    if (isScrollingUp && distanceToBottom > 1) {
      stickToBottomRef.current = false;
      if (bottomLockRafRef.current) {
        cancelAnimationFrame(bottomLockRafRef.current);
        bottomLockRafRef.current = 0;
      }
      bottomLockTimersRef.current.forEach(window.clearTimeout);
      bottomLockTimersRef.current = [];
      userScrollOverrideUntilRef.current = Date.now() + (isProgrammaticScroll ? 900 : 1600);
    }
    if (distanceToBottom <= 24) {
      stickToBottomRef.current = true;
      userScrollOverrideUntilRef.current = 0;
    }
    lastScrollTopRef.current = el.scrollTop;

    if (el.scrollTop < 80 && !isLoadingMore && hasMoreMessages && !loadingMoreTriggeredRef.current) {
      loadingMoreTriggeredRef.current = true;
      onLoadMore?.();
    }
  }, [hasMoreMessages, isLoadingMore, onLoadMore]);

  useEffect(() => {
    if (!isLoadingMore) {
      loadingMoreTriggeredRef.current = false;
    }
  }, [isLoadingMore]);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode | null>(null);
  const selectMode = selectionMode !== null;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shareSlug, setShareSlug] = useState<string | undefined>(undefined);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const exportCardRef = useRef<HTMLDivElement>(null);
  const exportPreviewCardRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const renderScrollToBottomButton = useCallback(() => {
    if (atBottom) return null;
    return (
      <div
        className="pointer-events-none absolute inset-x-0 z-[75] mx-auto max-w-[1440px]"
        style={{ bottom: SCROLL_TO_BOTTOM_OFFSET + (selectMode ? SELECT_MODE_EXTRA_SPACER : 0) }}
      >
        <button
          type="button"
          onClick={() => {
            userScrollOverrideUntilRef.current = 0;
            stickToBottomRef.current = true;
            atBottomRef.current = true;
            setAtBottom(true);
            scrollToBottom();
            lockBottomAfterLayout();
          }}
          className="pointer-events-auto absolute left-1/2 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full
            border border-surface-border bg-surface-elevated/75 text-text-secondary shadow-lg backdrop-blur-md transition-all
            hover:bg-surface-card/85 hover:text-text-primary hover:shadow-xl hover:border-surface-border/80
            active:scale-95 active:bg-surface-card active:shadow-sm"
          aria-label="回到底部"
        >
          <ChevronDownIcon className="w-5 h-5" />
        </button>
      </div>
    );
  }, [atBottom, lockBottomAfterLayout, selectMode]);

  const createVirtuosoComponents = useCallback(<T,>(): Components<T, unknown> => ({
    Header: () =>
      hasMoreMessages ? (
        <div className="flex justify-center py-2">
          {isLoadingMore ? (
            <div className="flex items-center gap-2 text-text-secondary text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载中...
            </div>
          ) : (
            <button
              onClick={onLoadMore}
              className="text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              加载更多历史消息
            </button>
          )}
        </div>
      ) : null,
    Footer: () => <div style={{ height: CHAT_BOTTOM_SPACER + (selectMode ? SELECT_MODE_EXTRA_SPACER : 0) }} aria-hidden="true" />,
  }), [hasMoreMessages, isLoadingMore, onLoadMore, selectMode]);
  const virtuosoComponents = useMemo(() => createVirtuosoComponents<Message>(), [createVirtuosoComponents]);
  const compareVirtuosoComponents = useMemo(() => createVirtuosoComponents<InferredGroup>(), [createVirtuosoComponents]);
  const groups = useMemo(() => inferGroups(messages), [messages]);
  const groupByMessageId = useMemo(() => {
    const map = new Map<string, InferredGroup>();
    groups.forEach((group) => {
      map.set(group.userMessage.id, group);
      group.assistantMessages.forEach((assistant) => map.set(assistant.id, group));
    });
    return map;
  }, [groups]);

  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const locatedTargetKeyRef = useRef<string>("");
  const loadingTargetKeyRef = useRef<string>("");
  const highlightTimerRef = useRef<number | null>(null);
  const [openAvatarDropdownGroupId, setOpenAvatarDropdownGroupId] = useState<number | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".avatar-dropdown") && !target.closest(".avatar-dropdown-trigger")) {
        setOpenAvatarDropdownGroupId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const visibleMessages = useMemo(() => {
    return messages.filter((msg) => {
      const group = groupByMessageId.get(msg.id);
      if (msg.role !== "user" && group && group.assistantMessages.length > 1) {
        const activeIndex = groupViews?.get(group.id) ?? 0;
        const activeMsg = group.assistantMessages[activeIndex] ?? group.assistantMessages[0];
        return msg.id === activeMsg?.id;
      }
      return true;
    });
  }, [messages, groupByMessageId, groupViews]);


  const modelById = useMemo(() => {
    const map = new Map<string, ChatModel>();
    models.forEach((model) => map.set(model.id, model));
    return map;
  }, [models]);
  useEffect(() => {
    if (!targetMessageId) return;
    const targetKey = `${conversationId || "new"}:${targetMessageId}`;
    if (locatedTargetKeyRef.current === targetKey || isLoadingHistory) return;

    const index = visibleMessages.findIndex((msg) => msg.serverMessageId === targetMessageId);
    if (index < 0) {
      if (hasMoreMessages && onLoadMore && !isLoadingMore && loadingTargetKeyRef.current !== targetKey) {
        loadingTargetKeyRef.current = targetKey;
        Promise.resolve(onLoadMore()).finally(() => {
          if (loadingTargetKeyRef.current === targetKey) {
            loadingTargetKeyRef.current = "";
          }
        });
      }
      return;
    }

    const msg = visibleMessages[index];
    locatedTargetKeyRef.current = targetKey;
    loadingTargetKeyRef.current = "";
    stickToBottomRef.current = false;
    programmaticScrollUntilRef.current = Date.now() + 700;
    setHighlightedMessageId(msg.id);

    const scrollToTarget = () => {
      virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "auto" });
    };

    const raf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(scrollToTarget);
    });
    const settleTimer = window.setTimeout(scrollToTarget, 120);

    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimerRef.current = null;
    }, 2600);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
    };
  }, [conversationId, targetMessageId, visibleMessages, isLoadingHistory, isLoadingMore, hasMoreMessages, onLoadMore]);

  useEffect(() => {
    if (!targetMessageId) {
      locatedTargetKeyRef.current = "";
      loadingTargetKeyRef.current = "";
    }
  }, [conversationId, targetMessageId]);

  const openedConversationBottomKeyRef = useRef("");
  useEffect(() => {
    if (targetMessageId || isLoadingHistory || messages.length === 0) return;
    const key = `${conversationId || "new"}:${messages[0]?.id || ""}:${messages[messages.length - 1]?.id || ""}`;
    if (openedConversationBottomKeyRef.current === key) return;
    openedConversationBottomKeyRef.current = key;

    stickToBottomRef.current = true;
    atBottomRef.current = true;
    userScrollOverrideUntilRef.current = 0;
    setAtBottom(true);
    lockBottomAfterLayout();
  }, [conversationId, targetMessageId, isLoadingHistory, messages, lockBottomAfterLayout]);

  const activeCompareModels = useMemo(() => {
    if (!isCompare) return [];
    return compareModels && compareModels.length > 0
      ? compareModels
      : Array.from(new Set(messages.filter((m) => m.role === "assistant" && m.model).map((m) => m.model!))).slice(0, 2);
  }, [compareModels, isCompare, messages]);
  const columnMessages = useMemo(() => {
    if (!isCompare) return [];
    return activeCompareModels.map((modelId) =>
      messages.filter((msg) => msg.role === "user" || msg.model === modelId)
    );
  }, [activeCompareModels, isCompare, messages]);

  // 收藏功能
  const { toggleFavorite, addFavorite, isFavorited, checkBatch, loading: favoriteLoading } = useFavorites();

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
        stickToBottomRef.current = true;
        requestAnimationFrame(() => {
          scrollToBottom();
          requestAnimationFrame(scrollToBottom);
        });
      }
    }
    prevLengthRef.current = messages.length;
  }, [messages, scrollToBottom]);

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const getPairedMessageIds = useCallback((msgId: string) => {
    const ids = new Set<string>();
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return ids;

    const group = groupByMessageId.get(msg.id);
    if (group) {
      ids.add(group.userMessage.id);
      if (msg.role === "assistant") {
        ids.add(msg.id);
      } else {
        const activeIndex = groupViews?.get(group.id) ?? 0;
        const activeAssistant = group.assistantMessages[activeIndex] ?? group.assistantMessages[0];
        if (activeAssistant) ids.add(activeAssistant.id);
      }
      return ids;
    }

    const index = messages.findIndex((m) => m.id === msgId);
    ids.add(msg.id);
    if (msg.role === "user") {
      const pair = messages.slice(index + 1).find((m) => m.role === "assistant");
      if (pair) ids.add(pair.id);
    } else if (msg.role === "assistant") {
      const pair = [...messages.slice(0, index)].reverse().find((m) => m.role === "user");
      if (pair) ids.add(pair.id);
    }
    return ids;
  }, [messages, groupByMessageId, groupViews]);

  const selectedMessages = useMemo(
    () => messages.filter((m) => selectedIds.has(m.id)),
    [messages, selectedIds]
  );

  const toggleSelect = (msgId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const index = messages.findIndex((m) => m.id === msgId);
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

  const enterSelectMode = (mode: SelectionMode, msgId?: string) => {
    setSelectionMode(mode);
    setSelectedIds(msgId ? getPairedMessageIds(msgId) : new Set());
    onSelectModeChange?.(true);
  };

  const exitSelectMode = () => {
    setSelectionMode(null);
    setSelectedIds(new Set());
    setExportPreviewOpen(false);
    onSelectModeChange?.(false);
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
      }
    } catch {}
    setSharing(false);
  };

  const handleFavoriteSelected = async () => {
    if (!conversationId || selectedIds.size === 0 || favoriteLoading) return;
    const token = localStorage.getItem("token");
    if (!token) {
      toast.warning("请先登录后收藏");
      return;
    }

    const selectedServerIds = messages
      .filter((m) => m.role === "assistant" && selectedIds.has(m.id))
      .map((m) => m.serverMessageId)
      .filter((id): id is number => typeof id === "number" && id > 0 && !isFavorited(id));

    const uniqueIds = Array.from(new Set(selectedServerIds));
    if (uniqueIds.length === 0) return;

    let successCount = 0;
    for (const messageId of uniqueIds) {
      const ok = await addFavorite(messageId, conversationId, { silent: true });
      if (ok) successCount += 1;
    }
    if (successCount > 0) {
      toast.success("已收藏");
    }
  };

  const handleExportImage = async () => {
    if (selectedIds.size === 0) return;
    setExportPreviewOpen(true);
  };

  const handleDownloadImage = async () => {
    const exportNode = exportPreviewCardRef.current || exportCardRef.current;
    if (selectedIds.size === 0 || !exportNode) return;
    setExporting(true);
    try {
      await document.fonts?.ready;
      const dataUrl = await toPng(exportNode, {
        quality: 1.0,
        pixelRatio: 2,
        backgroundColor: "#0f172a",
        cacheBust: true,
      });
      const link = document.createElement("a");
      link.download = `AI-Space-share-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      setExportPreviewOpen(false);
    } catch (e) {
      console.error("Export image failed:", e);
    }
    setExporting(false);
  };


  const handleExportText = () => {
    if (selectedIds.size === 0) return;
    const selectedMessages = messages.filter((m) => selectedIds.has(m.id));
    const exportedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    const separator = "\n\n────────────────────────\n\n";
    const text = [
      "AI Space 对话导出",
      `导出时间：${exportedAt}`,
      `消息数量：${selectedMessages.length}`,
      "",
      selectedMessages.map((msg, index) => formatMessageForTextExport(msg, index, selectedMessages.length)).join(separator),
      "",
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `AI-Space-chat-${Date.now()}.txt`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  const isMessageGenerating = (msg: Message, isStreaming: boolean) => {
    if (isStreaming) return true;
    if (msg.completedAt || msg.stopped) return false;
    if (msg.activityStatus?.status === "running" || msg.activityStatus?.status === "searching") return true;
    return !!(msg.generationTaskId || msg.backgroundTaskId || msg.useBackground || msg.isComplexTask);
  };

  const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const lastVisibleIsStreaming = !!lastVisibleMessage && lastVisibleMessage.role === "assistant" && isMessageGenerating(lastVisibleMessage, isLoading && !lastVisibleMessage.completedAt);
  const streamingMessageId = lastVisibleIsStreaming ? lastVisibleMessage.id : "";
  const streamingText = useMessageStream(streamingMessageId, !!streamingMessageId);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !streamingMessageId) return;

    const observer = new MutationObserver(() => {
      if (!stickToBottomRef.current) return;
      lockBottomAfterLayout();
    });

    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [streamingMessageId, lockBottomAfterLayout]);

  // SSE 流式输出是同一条消息内容持续变高，不一定改变 messages 引用；
  // 用流式文本长度触发，并只在用户仍贴近底部时跟随。
  const rafRef = useRef<number>(0);
  useEffect(() => {
    if (!streamingMessageId || !stickToBottomRef.current) return;

    lockBottomAfterLayout();
    const timeout = window.setTimeout(lockBottomAfterLayout, 120);
    return () => {
      window.clearTimeout(timeout);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (bottomLockRafRef.current) {
        cancelAnimationFrame(bottomLockRafRef.current);
        bottomLockRafRef.current = 0;
      }
      bottomLockTimersRef.current.forEach(window.clearTimeout);
      bottomLockTimersRef.current = [];
    };
  }, [streamingMessageId, streamingText.length, lockBottomAfterLayout]);

  const renderAssistantContent = (msg: Message, isStreaming: boolean) => {
    const generating = isMessageGenerating(msg, isStreaming);
    if (generating) {
      return <StreamingText messageId={msg.id} content={msg.content || ""} isStreaming={true} className="text-[15px] leading-relaxed text-text-primary" />;
    }
    if (!msg.content) {
      const mayStillRecover = !msg.completedAt && !msg.stopped && !!(
        msg.activityStatus ||
        msg.serverMessageId ||
        msg.generationTaskId ||
        msg.backgroundTaskId ||
        msg.useBackground ||
        msg.isComplexTask
      );
      if (mayStillRecover) {
        return <StreamingText messageId={msg.id} content={msg.content || ""} isStreaming={true} className="text-[15px] leading-relaxed text-text-primary" />;
      }
      return <div className="text-[15px] leading-relaxed text-text-secondary">生成中断，可点击重新生成</div>;
    }
    const { reasoning, answer, isThinking } = parseThinkContent(msg.content);
    const cleanAnswer = sanitizeContent(answer);
    return (
      <div className="prose prose-sm max-w-none">
        {reasoning && <ThinkBlock content={reasoning} isThinking={isThinking} />}
        <LazyMarkdownRenderer content={cleanAnswer} />
      </div>
    );
  };

  const renderCompareModelHeader = (modelId: string, index: number) => {
    const model = modelById.get(modelId);
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <div className="flex-1 min-w-0">
          {model ? (
            <ModelSelector
              models={models}
              selected={model}
              onSelect={(nextModel) => onCompareModelChange?.(index, nextModel.id)}
            />
          ) : (
            <div className="rounded-lg px-2 py-1 text-sm font-medium text-text-secondary">{modelId || `模型 ${index + 1}`}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onExitCompare?.()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
          aria-label={t("chat.closeCompareColumn")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  };

  const renderCompareWelcome = (modelId: string, index: number) => (
    <div className="flex min-h-[360px] flex-col overflow-hidden">
      {renderCompareModelHeader(modelId, index)}
      <div className="flex-1 px-8 pb-10 pt-20">
        <h2 className="text-3xl font-semibold tracking-tight text-text-primary">{t("chat.helloComma")}</h2>
        <p className="mt-3 text-xl font-medium text-text-primary">{t("chat.howCanIHelp")}</p>
      </div>
    </div>
  );

  const renderCompareWelcomeContent = (modelId: string, index: number) => (
    <div className="flex min-h-[360px] flex-col">
      <div className="flex-1 px-8 pb-10 pt-20">
        <h2 className="text-3xl font-semibold tracking-tight text-text-primary">{t("chat.helloComma")}</h2>
        <p className="mt-3 text-xl font-medium text-text-primary">{t("chat.howCanIHelp")}</p>
      </div>
    </div>
  );

  if (isCompare) {
    const compareGroups = groups;
    const resolveCompareAssistant = (group: InferredGroup, colIndex: number, modelId: string) => {
      const hasSlotSnapshot = group.assistantMessages.some((m) => typeof m.groupIndex === "number");
      if (hasSlotSnapshot) {
        return group.assistantMessages.find((m) => m.groupIndex === colIndex);
      }

      return group.assistantMessages.find((m) => group.models[m.groupIndex ?? -1] === modelId)
        || group.assistantMessages.find((m) => m.model === modelId)
        || group.assistantMessages[colIndex];
    };

    const renderCompareUserMessage = (msg: Message) => (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-[#EFF6FF] px-4 py-3 text-text-primary shadow-sm dark:bg-[#1E293B]">
          <div className="flex flex-col gap-2">
            {msg.files && msg.files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {msg.files.map((f, fi) => {
                  if (f.type === "image") {
                    return (
                      <div key={fi} className="relative overflow-hidden rounded-xl border border-surface-border bg-surface-card/60">
                        <img
                          src={`/api/files/${f.public_id}/download`}
                          alt={f.filename}
                          className="max-h-[200px] max-w-[200px] rounded-xl object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = "";
                            (e.target as HTMLImageElement).classList.add("hidden");
                            (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                          }}
                        />
                        <div className="hidden px-3 py-2 text-xs text-text-primary/70">{t("chat.imageLoadFailed")}</div>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            )}
            {msg.files && msg.files.some((f) => f.type !== "image") && (
              <div className="flex flex-wrap gap-2">
                {msg.files.filter((f) => f.type !== "image").map((f, fi) => (
                  <a
                    key={fi}
                    href={`/api/files/${f.public_id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card/60 px-3 py-1.5 transition-colors hover:bg-brand/30"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-text-primary/70" />
                    <span className="max-w-[200px] truncate text-[13px] text-text-primary">{f.filename}</span>
                  </a>
                ))}
              </div>
            )}
            {msg.content ? <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{msg.content}</p> : null}
          </div>
        </div>
      </div>
    );

    const renderCompareColumnTurn = (userMsg: Message, msg: Message | undefined, modelId: string, isLastGroup: boolean, isSingleChat: boolean) => {
      const model = modelById.get(msg?.model || modelId || "");
      const hasLiveGenerationSignal = !!msg && !msg.completedAt && !msg.stopped && !!(
        msg.activityStatus ||
        msg.serverMessageId ||
        msg.generationTaskId ||
        msg.backgroundTaskId ||
        msg.useBackground ||
        msg.isComplexTask
      );
      const isStreaming = !!msg && isLastGroup && (isLoading || hasLiveGenerationSignal) && isMessageGenerating(msg, true);
      const isGenerating = !!msg && isMessageGenerating(msg, isStreaming);
      const canRegenerate = !!msg && isLastGroup && !isStreaming && !isGenerating;

      return (
        <div className="flex flex-col gap-3 h-full">
          {renderCompareUserMessage(userMsg)}
          <div className="flex-1 flex flex-col">
            {msg ? (
              <div className="group flex gap-3 animate-message-appear">
                <div className="mt-1 w-7 shrink-0">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-surface-border bg-surface-card">
                    <Bot className="h-4 w-4 text-text-secondary" />
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="w-fit max-w-full rounded-2xl rounded-bl-sm bg-surface-elevated px-4 py-3">
                    {model && <AssistantMessageMeta msg={msg} isStreaming={isStreaming} model={model} />}
                    {renderAssistantContent(msg, isStreaming)}
                  </div>
                  {!isStreaming && (
                    <div className="flex items-center gap-2 px-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <MessageActions
                        onCopy={() => handleCopy(msg.content)}
                        onDelete={() => setDeleteTarget(msg.id)}
                        onRegenerate={onRegenerate}
                        onShareSelectMode={() => enterSelectMode("share", msg.id)}
                        onFavoriteSelectMode={msg.serverMessageId && conversationId ? () => enterSelectMode("favorite", msg.id) : undefined}
                        isFavorited={msg.serverMessageId ? isFavorited(msg.serverMessageId) : false}
                        showRegenerate={canRegenerate}
                        align="left"
                        visible={isLastGroup}
                        createdAt={msg.createdAt}
                        completedAt={msg.completedAt}
                        onForkCompare={msg.serverMessageId ? () => onForkCompare?.(msg.serverMessageId!) : undefined}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : isLoading && isLastGroup ? (
              <div className="flex gap-3 animate-message-appear">
                <div className="mt-1 w-7 shrink-0">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-surface-border bg-surface-card">
                    <Bot className="h-4 w-4 text-text-secondary" />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="inline-flex rounded-2xl rounded-bl-sm bg-surface-elevated px-4 py-3 text-sm text-text-secondary">
                    {isComplexTask ? (
                      <span className="inline-flex items-center gap-0.5">
                        <WaveText text={t("chat.deepReasoning")} />
                        <ThinkingDots />
                      </span>
                    ) : (
                      <ThinkingDots />
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="rounded-xl border border-dashed border-surface-border bg-surface-elevated/40 px-3 py-2 text-center text-xs text-text-tertiary">
                  {isSingleChat ? "单聊模式的对话" : "当前模型未参与本轮"}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    };

    return (
      <div className="relative flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* 固定模型选择栏 */}
        <div className="flex w-full shrink-0">
          {(activeCompareModels.length ? activeCompareModels : compareModels).map((modelId, colIndex) => (
            <div key={modelId || colIndex} className="flex min-w-[320px] flex-1 flex-col">
              {renderCompareModelHeader(modelId, colIndex)}
            </div>
          ))}
        </div>
        {/* 滚动内容区域：对比模式也使用 Virtuoso，和单聊共享滚动/锁底体系 */}
        {messages.length === 0 ? (
          <div className="flex-1 overflow-hidden px-3 py-3">
            <div className="mx-auto flex h-full max-w-[1440px]">
              {(activeCompareModels.length ? activeCompareModels : compareModels).map((modelId, index) => (
                <div key={modelId || index} className="flex min-w-[320px] flex-1 flex-col border-r border-surface-border last:border-r-0">
                  {renderCompareWelcomeContent(modelId, index)}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Virtuoso
            style={{ height: "100%" }}
            data={compareGroups}
            ref={virtuosoRef}
            scrollerRef={handleVirtuosoScrollerRef}
            followOutput={false}
            atBottomThreshold={160}
            atBottomStateChange={(atBottom) => {
              atBottomRef.current = atBottom;
              if (atBottom) stickToBottomRef.current = true;
              setAtBottom(atBottom);
            }}
            computeItemKey={(_, group) => group.id}
            onScroll={handleVirtuosoScroll}
            increaseViewportBy={{ top: 200, bottom: CHAT_BOTTOM_SPACER }}
            overscan={{ main: 2, reverse: 2 }}
            components={compareVirtuosoComponents}
            itemContent={(groupIndex, group) => {
              const isLastGroup = groupIndex === compareGroups.length - 1;
              const isSingleChat = group.models.length <= 1;
              return (
                <div className="mx-auto max-w-[1440px]">
                  <div className="flex items-stretch">
                    {(activeCompareModels.length ? activeCompareModels : compareModels).map((modelId, colIndex) => {
                      const assistant = resolveCompareAssistant(group, colIndex, modelId);
                      return (
                        <div key={colIndex} className="flex min-w-[320px] flex-1 flex-col px-4 py-4">
                          {renderCompareColumnTurn(group.userMessage, assistant, modelId, isLastGroup, isSingleChat)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }}
          />
        )}

        {renderScrollToBottomButton()}

        <ConfirmDialog
          isOpen={!!deleteTarget}
          title={t("chat.deleteMessageTitle")}
          description={t("chat.deleteMessageDesc")}
          confirmText={t("common.delete")}
          cancelText={t("common.cancel")}
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
        <div className="flex-1 flex items-center justify-center" style={{ paddingBottom: CHAT_BOTTOM_SPACER }}>
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
      <div className="flex-1 flex flex-col items-center justify-start px-4 pt-48" style={{ paddingBottom: CHAT_BOTTOM_SPACER }}>
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
              <h1 className="text-[32px] font-semibold leading-tight tracking-tight mb-2 text-text-primary">
                {userName ? t("chat.userGreeting").replace("{name}", userName) : t("chat.greeting")}
              </h1>
              <p className="text-[25px] font-medium leading-tight tracking-tight text-text-primary/80">{t("chat.whatCanWeDo")}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <Virtuoso
        style={{ height: "100%" }}
        data={visibleMessages}
        ref={virtuosoRef}
        scrollerRef={handleVirtuosoScrollerRef}
        followOutput={false}
        atBottomThreshold={160}
        atBottomStateChange={(atBottom) => {
          atBottomRef.current = atBottom;
          if (atBottom) stickToBottomRef.current = true;
          setAtBottom(atBottom);
        }}
        computeItemKey={(_, msg) => msg.id}
        onScroll={handleVirtuosoScroll}
        increaseViewportBy={{ top: 200, bottom: CHAT_BOTTOM_SPACER }}
        overscan={{ main: 2, reverse: 2 }}
        components={virtuosoComponents}
        itemContent={(index, msg) => {
          const group = groupByMessageId.get(msg.id);
          const isUser = msg.role === "user";
          const model = msg.model ? modelById.get(msg.model) : undefined;
          const isLast = index === visibleMessages.length - 1;
          const isStreaming = isLoading && msg.role === "assistant" && !msg.completedAt && isLast;
          const isGenerating = !isUser && isMessageGenerating(msg, isStreaming);
          const canRegenerate = !isUser && (isLast || !msg.content) && !isLoading && !isGenerating;
          const isSelected = selectedIds.has(msg.id);
          const isHighlighted = highlightedMessageId === msg.id;

          return (
            <div className={cn("max-w-[800px] mx-auto px-4 py-4 rounded-2xl transition-colors duration-500", isHighlighted && "bg-brand/10")}>
              <div
                key={msg.id}
                className={cn("flex gap-3 animate-message-appear group", isUser ? "justify-end" : "justify-start")}
              >
                {/* 左侧：AI头像 / 用户复选框 */}
                <div className={cn("mt-1 shrink-0", isUser && !selectMode ? "hidden" : "w-7")}>
                  {!isUser && !selectMode && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (group && group.assistantMessages.length > 1) {
                            setOpenAvatarDropdownGroupId((prev) => (prev === group.id ? null : group.id));
                          }
                        }}
                        className={cn(
                          "w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center relative avatar-dropdown-trigger",
                          group && group.assistantMessages.length > 1 && "cursor-pointer hover:bg-surface-elevated"
                        )}
                      >
                        <Bot className="w-4 h-4 text-text-secondary" />
                        {group && group.assistantMessages.length > 1 && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-brand text-[8px] font-bold text-white flex items-center justify-center border border-white dark:border-[#1F1F1F]">
                            {group.assistantMessages.length}
                          </span>
                        )}
                      </button>
                      {openAvatarDropdownGroupId === group?.id && group && (
                        <div className="avatar-dropdown absolute top-full left-0 mt-1.5 z-50 w-44 rounded-xl border border-surface-border bg-surface-elevated shadow-xl py-1.5 px-1.5 flex flex-col gap-0.5">
                          {group.assistantMessages.map((a, idx) => {
                            const m = a.model ? modelById.get(a.model) : undefined;
                            const isActive = (groupViews?.get(group.id) ?? 0) === idx;
                            return (
                              <button
                                key={a.id}
                                onClick={() => {
                                  switchGroupModel?.(group.id, idx);
                                  setOpenAvatarDropdownGroupId(null);
                                }}
                                className={cn(
                                  "flex items-center gap-2 w-full px-2.5 py-2 text-left transition-colors rounded-lg",
                                  isActive ? "bg-surface-card text-text-primary font-medium shadow-sm" : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                                )}
                              >
                                <div
                                  className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0"
                                  style={{ backgroundColor: m?.color }}
                                >
                                  {(m?.name || a.model || `模型${idx + 1}`).slice(0, 1).toUpperCase()}
                                </div>
                                <span className="text-xs truncate">{m?.name || a.model || `模型 ${idx + 1}`}</span>
                                {isActive && <Check className="w-3 h-3 text-text-primary shrink-0 ml-auto" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  {isUser && selectMode && (
                    <button
                      onClick={() => toggleSelect(msg.id)}
                      className={cn(
                        "w-5 h-5 rounded-md border flex items-center justify-center transition-colors",
                        isSelected
                          ? "border-slate-900 bg-slate-900 text-white shadow-sm dark:border-text-primary dark:bg-text-primary dark:text-surface"
                          : "border-surface-border text-transparent hover:border-text-tertiary/50"
                      )}
                    >
                      {isSelected && <SquareCheck className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>

                {/* 中间内容 */}
                <div className={cn("flex-1 flex min-w-0", isUser ? "justify-end" : "justify-start")}>
                  <div className={cn("flex flex-col gap-1 min-w-0", isUser ? "items-end" : "items-start")}>

                    <div
                      className={cn(
                        "px-4 py-3 relative w-fit max-w-full transition-shadow duration-500",
                        isUser
                          ? "rounded-2xl rounded-br-sm bg-[#EFF6FF] dark:bg-[#1E293B]"
                          : "rounded-2xl rounded-bl-sm bg-[#F5F4F2] dark:bg-[#1F1F1F]",
                        isHighlighted && "ring-2 ring-brand/40 shadow-lg shadow-brand/10"
                      )}
                    >

                    {!isUser && model && !selectMode && (
                      <AssistantMessageMeta msg={msg} isStreaming={isStreaming} model={model} />
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
                                    <div className="hidden text-xs text-text-tertiary px-3 py-2">{t("chat.imageLoadFailed")}</div>
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
                        onShareSelectMode={() => enterSelectMode("share", msg.id)}
                        onFavoriteSelectMode={msg.serverMessageId && conversationId ? () => enterSelectMode("favorite", msg.id) : undefined}
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
                      onClick={() => toggleSelect(msg.id)}
                      className={cn(
                        "w-5 h-5 rounded-md border flex items-center justify-center transition-colors",
                        isSelected
                          ? "border-slate-900 bg-slate-900 text-white shadow-sm dark:border-text-primary dark:bg-text-primary dark:text-surface"
                          : "border-surface-border text-transparent hover:border-text-tertiary/50"
                      )}
                    >
                      {isSelected && <SquareCheck className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        }}
      />

      {renderScrollToBottomButton()}

      {/* 选择模式底部工具栏 */}
      {selectMode && (
        <div className="absolute bottom-0 left-0 right-0 z-[80] flex flex-wrap items-center justify-center gap-3 px-4 pb-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
          <ActionBar>
            <ActionBarGroup>
              <ActionBarButton
                onClick={() => {
                  const allIds = new Set(messages.map((m) => m.id));
                  const isAllSelected = messages.length > 0 && messages.every((m) => selectedIds.has(m.id));
                  setSelectedIds(isAllSelected ? new Set() : allIds);
                }}
              >
                <SquareCheck className="w-4 h-4" />
                {messages.length > 0 && messages.every((m) => selectedIds.has(m.id)) ? "取消全选" : "全选"}
              </ActionBarButton>
              <span className="px-1 text-sm text-text-secondary">
                已选择 <span className="text-text-primary font-medium">{selectedIds.size}</span> 条消息
              </span>
              <ActionBarButton onClick={exitSelectMode}>
                <X className="w-3.5 h-3.5" />
                取消
              </ActionBarButton>
            </ActionBarGroup>
          </ActionBar>

          {selectionMode === "favorite" && (
            <ActionBar>
              <ActionBarButton
                onClick={handleFavoriteSelected}
                disabled={selectedIds.size === 0 || favoriteLoading}
                variant="primary"
              >
                <Star className="w-3.5 h-3.5" />
                {favoriteLoading ? "收藏中..." : "收藏所选"}
              </ActionBarButton>
            </ActionBar>
          )}

          {selectionMode === "share" && (
            <ActionBar>
              <ExportDropdown
                onExportImage={handleExportImage}
                onExportText={handleExportText}
                disabled={selectedIds.size === 0 || exporting}
                exporting={exporting}
              />
              <ActionBarButton
                onClick={handleShareSelected}
                disabled={selectedIds.size === 0 || sharing}
                variant="primary"
              >
                <Share2 className="w-3.5 h-3.5" />
                {sharing ? "生成中..." : "生成分享链接"}
              </ActionBarButton>
            </ActionBar>
          )}
        </div>
      )}

      {/* 删除消息确认弹窗 */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title={t("chat.deleteMessageTitle")}
        description={t("chat.deleteMessageDesc")}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        variant="danger"
        onConfirm={() => {
          if (deleteTarget && onDeleteMessage) onDeleteMessage(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* 分享链接弹窗 */}
      <ShareDialog isOpen={shareOpen} slug={shareSlug} onClose={() => setShareOpen(false)} />

      {/* 导出图片预览 */}
      {exportPreviewOpen && selectedMessages.length > 0 && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setExportPreviewOpen(false)}
            aria-label="关闭预览"
          />
          <div className="relative z-10 flex max-h-full w-full max-w-[620px] flex-col items-center gap-4">
            <div className="w-full overflow-auto rounded-3xl bg-surface-elevated p-3 shadow-2xl">
              <ExportShareCard messages={selectedMessages} cardRef={exportPreviewCardRef} />
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-surface-border bg-surface-elevated px-4 py-3 shadow-xl">
              <button
                type="button"
                onClick={() => setExportPreviewOpen(false)}
                className="rounded-xl px-4 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDownloadImage}
                disabled={exporting}
                className="flex items-center gap-2 rounded-xl bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Download className="w-4 h-4" />
                {exporting ? "导出中..." : "导出图片"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 隐藏的分享卡片（用于导出图片） */}
      {selectMode && selectedMessages.length > 0 && (
        <div
          style={{ position: "fixed", left: 0, top: 0, width: "560px", opacity: 0, pointerEvents: "none", zIndex: -1 }}
        >
          <ExportShareCard messages={selectedMessages} cardRef={exportCardRef} />
        </div>
      )}
    </div>
  );
}

export default memo(MessageList);

