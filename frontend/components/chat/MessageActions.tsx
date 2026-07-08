"use client";

import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Columns3, Copy, MoreHorizontal, Pencil, RotateCcw, Share2, Star, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { emitChatRenderProfileEvent, isChatRenderProfileEnabled } from "@/lib/chatRenderProfile";

export type MessageActionsProps = {
  onCopy: () => void;
  onEdit?: () => void;
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
  onSaveToNote?: () => void;
};

function formatTime(ts: number, language: string) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const timeStr = d.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  if (isToday) return timeStr;
  return `${d.toLocaleDateString(language, { month: "short", day: "numeric" })} ${timeStr}`;
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function MessageActionsProfileProbe({
  align,
  visible,
  showRegenerate,
  hasFavoriteAction,
  isFavorited,
  hasForkCompare,
  moreOpen,
  copied,
  renderStartedAt,
}: {
  align: MessageActionsProps["align"];
  visible: boolean;
  showRegenerate: boolean;
  hasFavoriteAction: boolean;
  isFavorited: boolean;
  hasForkCompare: boolean;
  moreOpen: boolean;
  copied: boolean;
  renderStartedAt: number;
}) {
  useEffect(() => {
    const commitAt = nowMs();
    emitChatRenderProfileEvent("message-actions-commit", {
      align,
      visible,
      showRegenerate,
      hasFavoriteAction,
      isFavorited,
      hasForkCompare,
      moreOpen,
      copied,
      durationMs: commitAt - renderStartedAt,
    });
  });
  return null;
}

function MessageActions({
  onCopy,
  onEdit,
  onRegenerate,
  onShareSelectMode,
  onFavoriteSelectMode,
  isFavorited,
  showRegenerate,
  align,
  visible,
  createdAt,
  onForkCompare,
  onSaveToNote,
}: MessageActionsProps) {
  const profileEnabled = isChatRenderProfileEnabled();
  const renderStartedAt = profileEnabled ? nowMs() : 0;
  const { t, language } = useI18n();
  const [copied, setCopied] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreMenuPosition, setMoreMenuPosition] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) setMoreMenuPosition(null);
  }, [moreOpen]);

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

  const openMoreMenu = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    const top = rect.bottom + 4;
    const margin = 12;
    const menuWidth = 160;
    if (align === "right") {
      setMoreMenuPosition({ top, right: Math.max(margin, window.innerWidth - rect.right) });
    } else {
      setMoreMenuPosition({ top, left: Math.min(Math.max(margin, rect.left), window.innerWidth - menuWidth - margin) });
    }
    setMoreOpen(true);
  };

  return (
    <div data-message-actions="true" className={cn(
      "inline-flex items-center gap-0.5 rounded-xl bg-surface-card/80 transition-opacity duration-200",
      align === "right" ? "justify-end" : "justify-start -ml-[9px]",
      visible
        ? "mt-1 px-1 py-0.5 opacity-100"
        : "mt-1 px-1 py-0.5 opacity-0 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100"
    )}>
      {profileEnabled && (
        <MessageActionsProfileProbe
          align={align}
          visible={visible}
          showRegenerate={Boolean(showRegenerate && onRegenerate)}
          hasFavoriteAction={Boolean(onFavoriteSelectMode)}
          isFavorited={Boolean(isFavorited)}
          hasForkCompare={Boolean(onForkCompare)}
          moreOpen={moreOpen}
          copied={copied}
          renderStartedAt={renderStartedAt}
        />
      )}
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
      {onEdit && (
        <button
          onClick={onEdit}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
          title={t("chat.action.edit")}
          data-testid="chat-user-message-edit-action"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      {onForkCompare && (
        <button
          onClick={onForkCompare}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
          title={t("chat.action.compare")}
        >
          <Columns3 className="w-3.5 h-3.5" />
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
      <div className="relative" ref={moreRef}>
        <button
          onClick={(event) => {
            if (moreOpen) {
              setMoreOpen(false);
              return;
            }
            openMoreMenu(event.currentTarget);
          }}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
          title={t("chat.action.more")}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        {moreOpen && moreMenuPosition && createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setMoreOpen(false)} />
            <div
              className="fixed w-40 rounded-xl border border-surface-border bg-surface-elevated shadow-xl z-[100] py-2 px-3 animate-fade-in"
              style={moreMenuPosition}
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-tertiary">{t("chat.action.startTime")}</span>
                  <span className="text-text-secondary">{formatTime(createdAt, language)}</span>
                </div>
                {onSaveToNote && (
                  <button
                    type="button"
                    onClick={() => { onSaveToNote(); setMoreOpen(false); }}
                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
                  >
                    <StickyNote className="h-3.5 w-3.5" />
                    保存到笔记
                  </button>
                )}
              </div>
            </div>
          </>,
          document.body
        )}
      </div>
    </div>
  );
}

export default memo(MessageActions);
