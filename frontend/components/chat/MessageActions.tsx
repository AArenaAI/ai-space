"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Check, Copy, MoreHorizontal, RotateCcw, Share2, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type MessageActionsProps = {
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
};

function formatTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const timeStr = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return timeStr;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}月${day}日 ${timeStr}`;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
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
}: MessageActionsProps) {
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
                {onForkCompare && (
                  <button
                    type="button"
                    onClick={() => { setMoreOpen(false); onForkCompare(); }}
                    className="mt-1 rounded-lg px-2 py-1 text-left text-xs text-text-secondary transition-colors hover:bg-surface-card hover:text-text-primary"
                  >
                    分支对比
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(MessageActions);
