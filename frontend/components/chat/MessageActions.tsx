"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Check, Copy, MoreHorizontal, RotateCcw, Share2, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

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

function formatTime(ts: number, language: string) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const timeStr = d.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  if (isToday) return timeStr;
  return `${d.toLocaleDateString(language, { month: "short", day: "numeric" })} ${timeStr}`;
}

function formatDuration(ms: number, t: (key: string, params?: Record<string, string>) => string) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return t("time.duration.minutesSeconds", { minutes: String(minutes), seconds: String(seconds) });
  return t("time.duration.seconds", { seconds: String(seconds) });
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

  const durationMs = completedAt ? completedAt - createdAt : 0;

  return (
    <div data-message-actions="true" className={cn(
      "mt-1 inline-flex items-center gap-0.5 rounded-xl bg-surface-card/80 px-1 py-0.5 transition-opacity duration-200",
      align === "right" ? "justify-end" : "justify-start",
      visible ? "opacity-100" : "opacity-0 group-hover:opacity-100"
    )}>
      <button
        onClick={() => { onCopy(); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
        title={t("chat.action.copy")}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>

      {showRegenerate && onRegenerate && (
        <button
          onClick={onRegenerate}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
          title={t("chat.action.regenerate")}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        onClick={onShareSelectMode}
        className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
        title={t("chat.action.shareSelect")}
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
          title={isFavorited ? t("chat.action.unfavorite") : t("chat.action.favorite")}
        >
          <Star className={cn("w-3.5 h-3.5", isFavorited && "fill-amber-400")} />
        </button>
      )}
      <button
        onClick={onDelete}
        className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
        title={t("chat.action.delete")}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <div className="relative" ref={moreRef}>
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
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
                  <span className="text-text-secondary">{formatTime(createdAt, language)}</span>
                </div>
                {completedAt && durationMs >= 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-tertiary">{t("chat.action.duration")}</span>
                    <span className="text-text-secondary">{formatDuration(durationMs, t)}</span>
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

export default memo(MessageActions);
