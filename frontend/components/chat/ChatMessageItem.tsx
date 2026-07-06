"use client";

import React, { useEffect, useRef, useState, useCallback, memo } from "react";
import {
  User, Bot, Copy, Check, MoreHorizontal, RotateCcw, Share2, X, SquareCheck,
  Play, FileText, Star, Columns2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Message, ChatModel } from "@/lib/chatTypes";
import { InferredGroup } from "@/lib/groups";
import { AssistantMessageMeta } from "./AssistantMessageMeta";
import { ThinkBlock } from "./ThinkBlock";
import { AssistantMessageContent } from "./AssistantMessageContent";
import { useI18n } from "@/lib/i18n";
import { parseThinkContent, extractCitations, sanitizeContent, getCitedSources, isMessageGenerating } from "@/lib/chatContent";

/* ---------- 工具函数 ---------- */

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

function MessageMenu({
  onCopy,
  onRegenerate,
  onSelectMode,
  onFavorite,
  isFavorited,
  showRegenerate,
}: {
  onCopy: () => void;
  onRegenerate?: () => void;
  onSelectMode: () => void;
  onFavorite?: () => void;
  isFavorited?: boolean;
  showRegenerate: boolean;
}) {
  const { t } = useI18n();
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
              {t("chat.action.copy")}
            </button>
            {showRegenerate && onRegenerate && (
              <button
                onClick={() => { onRegenerate(); setOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t("chat.action.regenerate")}
              </button>
            )}
            <button
              onClick={() => { onSelectMode(); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
              {t("chat.action.shareSelect")}
            </button>
            {onFavorite && (
              <button
                onClick={() => { onFavorite(); setOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
              >
                <Star className={cn("w-3.5 h-3.5", isFavorited && "fill-amber-400 text-amber-400")} />
                {isFavorited ? t("chat.action.unfavorite") : t("chat.action.favorite")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MessageActions({
  onCopy,
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
  const { t, language } = useI18n();
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
    const timeStr = d.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
    if (isToday) return timeStr;
    return `${d.toLocaleDateString(language, { month: "short", day: "numeric" })} ${timeStr}`;
  };

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) return t("time.duration.minutesSeconds", { minutes: String(minutes), seconds: String(seconds) });
    return t("time.duration.seconds", { seconds: String(seconds) });
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
        title={t("chat.action.copy")}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>

      {showRegenerate && onRegenerate && (
        <button
          onClick={onRegenerate}
          className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
          title={t("chat.action.regenerate")}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      )}
      {onForkCompare && (
        <button
          onClick={onForkCompare}
          className="p-1 rounded-md text-text-tertiary hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
          title={t("chat.action.compare")}
        >
          <Columns2 className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        onClick={onSelectMode}
        className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
        title={t("chat.action.shareSelect")}
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
          title={isFavorited ? t("chat.action.unfavorite") : t("chat.action.favorite")}
        >
          <Star className={cn("w-3.5 h-3.5", isFavorited && "fill-amber-400")} />
        </button>
      )}
      <div className="relative" ref={moreRef}>
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
          title={t("chat.action.more")}
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
                  <span className="text-text-tertiary">{t("chat.action.startTime")}</span>
                  <span className="text-text-secondary">{formatTime(createdAt)}</span>
                </div>
                {completedAt && durationMs >= 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-tertiary">{t("chat.action.duration")}</span>
                    <span className="text-text-secondary">{formatDuration(durationMs)}</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- 主组件 ---------- */

/* ---------- 导出 ---------- */

export { ThinkingDots, WaveText, AssistantMessageMeta, AssistantMessageContent, parseThinkContent, extractCitations, sanitizeContent, getCitedSources, ThinkBlock, MessageMenu, MessageActions, isMessageGenerating };

export interface ChatMessageItemProps {
  msg: Message;
  index: number;
  messagesLength: number;
  isLoading: boolean;
  isComplexTask?: boolean;
  model?: ChatModel;
  group?: InferredGroup;
  groupViews?: Map<number, number>;
  selectMode: boolean;
  isSelected: boolean;
  conversationId?: number;
  isFavorited: boolean;
  onToggleSelect: (index: number) => void;
  onCopy: (content: string) => void;
  onRegenerate?: () => void;
  onContinueGenerate?: () => void;
  onEnterSelectMode: () => void;
  onToggleFavorite: (serverMessageId: number, conversationId: number) => void;
  onForkCompare?: (serverMessageId: number) => void;
  switchGroupModel?: (groupId: number, activeIndex: number) => void;
}

function ChatMessageItemRaw({
  msg,
  index,
  messagesLength,
  isLoading,
  isComplexTask,
  model,
  group,
  groupViews,
  selectMode,
  isSelected,
  conversationId,
  isFavorited,
  onToggleSelect,
  onCopy,
  onRegenerate,
  onContinueGenerate,
  onEnterSelectMode,
  onToggleFavorite,
  onForkCompare,
  switchGroupModel,
}: ChatMessageItemProps) {
  const { t } = useI18n();
  const isUser = msg.role === "user";
  const isLast = index === messagesLength - 1;
  const isStreaming = isLoading && msg.role === "assistant" && !msg.completedAt && isLast;
  const isGenerating = !isUser && isMessageGenerating(msg, isStreaming);
  const canRegenerate = !isUser && (isLast || !msg.content) && !isLoading && !isGenerating;

  const handleCopy = useCallback(() => {
    onCopy(msg.content || "");
  }, [onCopy, msg.content]);

  const handleFavorite = useCallback(() => {
    if (msg.serverMessageId && conversationId) {
      onToggleFavorite(msg.serverMessageId, conversationId);
    }
  }, [msg.serverMessageId, conversationId, onToggleFavorite]);

  const handleForkCompare = useCallback(() => {
    if (msg.serverMessageId) {
      onForkCompare?.(msg.serverMessageId);
    }
  }, [msg.serverMessageId, onForkCompare]);

  return (
    <div className={cn("flex animate-message-appear group py-1", isUser ? "justify-end" : "gap-3")}>
      {/* 左侧：AI头像 / 用户复选框 */}
      <div className={cn("mt-1 shrink-0", isUser && !selectMode ? "hidden" : "w-7")}>
        {!isUser && !selectMode && (
          <div className="w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center">
            <Bot className="w-4 h-4 text-text-secondary" />
          </div>
        )}
        {isUser && selectMode && (
          <button
            onClick={() => onToggleSelect(index)}
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
        <div className={cn(
          "flex flex-col gap-1 min-w-0",
          isUser ? "items-end" : "items-start"
        )}>
          {!isUser && group && group.assistantMessages.length > 1 && (
            <div className="flex items-center gap-1.5 mb-1">
              {group.assistantMessages.map((a, idx) => {
                const isActive = (groupViews?.get(group.id) ?? 0) === idx;
                const m = a.model ? model : undefined;
                return (
                  <button
                    key={a.id}
                    onClick={() => switchGroupModel?.(group.id, idx)}
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] transition-colors",
                      isActive
                        ? "bg-surface-card text-text-primary font-medium shadow-sm"
                        : "bg-surface-card text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                    )}
                  >
                    <div
                      className="w-3 h-3 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                      style={{ backgroundColor: m?.color || model?.color }}
                    >
                      {(m?.name || a.model || model?.name || t("chat.model.fallback", { index: String(idx + 1) })).slice(0, 1).toUpperCase()}
                    </div>
                    <span className="truncate max-w-[80px]">{m?.name || a.model || model?.name || t("chat.model.fallback", { index: String(idx + 1) })}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div
            className={cn(
              "px-4 py-3 relative w-fit",
              isUser
                ? "max-w-[720px] rounded-2xl rounded-br-sm bg-[#EFF6FF] dark:bg-[#1E293B]"
                : "max-w-full rounded-2xl rounded-bl-sm bg-[#F5F4F2] dark:bg-[#1F1F1F]"
            )}
          >
            {!isUser && model && !selectMode && (
              <AssistantMessageMeta msg={msg} isStreaming={isStreaming} model={model} />
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
                            <div className="hidden text-xs text-text-tertiary px-3 py-2">{t("chat.imageLoadFailed")}</div>
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
              <>
                <AssistantMessageContent message={msg} isStreaming={isStreaming} />
                {msg.stopped && onContinueGenerate && (
                  <button
                    onClick={onContinueGenerate}
                    className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-card border border-surface-border transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {t("chat.action.continueGenerate")}
                  </button>
                )}
              </>
            )}
          </div>

          {!selectMode && !isStreaming && (
            <MessageActions
              onCopy={handleCopy}
              onRegenerate={onRegenerate}
              onSelectMode={onEnterSelectMode}
              onFavorite={!isUser && msg.serverMessageId && conversationId ? handleFavorite : undefined}
              isFavorited={isFavorited}
              showRegenerate={canRegenerate}
              align={isUser ? "right" : "left"}
              visible={isLast}
              createdAt={msg.createdAt}
              completedAt={msg.completedAt}
              onForkCompare={!isUser && msg.serverMessageId && conversationId ? handleForkCompare : undefined}
            />
          )}
        </div>
      </div>

      {/* 右侧：用户头像 / AI复选框 */}
      <div className={cn("mt-1 shrink-0", isUser && !selectMode ? "hidden" : "w-7")}>
        {isUser && !selectMode && (
          <div className="w-7 h-7 rounded-lg bg-surface-card border border-surface-border flex items-center justify-center">
            <User className="w-4 h-4 text-text-secondary" />
          </div>
        )}
        {!isUser && selectMode && (
          <button
            onClick={() => onToggleSelect(index)}
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
  );
}

/* 自定义比较函数：忽略回调函数引用，只比较数据和状态 */
function areEqual(prev: ChatMessageItemProps, next: ChatMessageItemProps) {
  return (
    prev.msg === next.msg &&
    prev.index === next.index &&
    prev.messagesLength === next.messagesLength &&
    prev.isLoading === next.isLoading &&
    prev.isComplexTask === next.isComplexTask &&
    prev.model?.id === next.model?.id &&
    prev.group?.id === next.group?.id &&
    prev.selectMode === next.selectMode &&
    prev.isSelected === next.isSelected &&
    prev.conversationId === next.conversationId &&
    prev.isFavorited === next.isFavorited
  );
}

export const ChatMessageItem = memo(ChatMessageItemRaw, areEqual);
