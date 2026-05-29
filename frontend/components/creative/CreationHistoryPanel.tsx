"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Clock,
  Image as ImageIcon,
  MessageSquarePlus,
  Pencil,
  Search,
  Trash2,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/resolveImageUrl";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useI18n } from "@/lib/i18n";

export interface CreationHistoryItem {
  id: number;
  title: string;
  subtitle?: string;
  active?: boolean;
  updated_at: string;
  source?: "image" | "video";
  cover_image?: string;
  status?: string;
}

interface CreationHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  items: CreationHistoryItem[];
  onSelect: (id: number, item: CreationHistoryItem) => void;
  onNew?: () => void;
  onRename?: (id: number, title: string) => void;
  onDelete?: (id: number, item: CreationHistoryItem) => void;
  loading?: boolean;
  emptyText?: string;
  emptyHint?: string;
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  confirmDelete?: boolean;
  deleteConfirmTitle?: string;
  deleteConfirmDescription?: string | ((item: CreationHistoryItem) => string);
  deleteConfirmText?: string;
}

function getTimeGroupLabel(dateStr: string, t: (key: string) => string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((nowDate.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return t("sidebar.time.today");
  if (diffDays === 1) return t("sidebar.time.yesterday");
  if (diffDays <= 7) return t("sidebar.time.last7days");
  if (diffDays <= 30) return t("sidebar.time.last30days");
  return `${date.getFullYear()}.${date.getMonth() + 1}`;
}

const getGroupOrder = (t: (key: string) => string) => [
  t("sidebar.time.today"),
  t("sidebar.time.yesterday"),
  t("sidebar.time.last7days"),
  t("sidebar.time.last30days"),
];

function sortGroupLabels(labels: string[], t: (key: string) => string): string[] {
  const groupOrder = getGroupOrder(t);
  const fixed = groupOrder.filter((g) => labels.includes(g));
  const months = labels
    .filter((l) => !groupOrder.includes(l))
    .sort((a, b) => {
      const [ay, am] = a.split(".").map(Number);
      const [by, bm] = b.split(".").map(Number);
      if (ay !== by) return by - ay;
      return bm - am;
    });

  return [...fixed, ...months];
}

function groupItems(items: CreationHistoryItem[], t: (key: string) => string) {
  const groups: Record<string, CreationHistoryItem[]> = {};
  for (const item of items) {
    const label = getTimeGroupLabel(item.updated_at, t);
    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }
  return groups;
}

function formatHistoryTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function CreationHistorySkeleton() {
  return (
    <div className="space-y-3 px-1 py-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-xl border border-surface-border bg-surface-card p-3 animate-pulse">
          <div className="h-4 w-2/3 rounded bg-surface-border" />
          <div className="mt-3 size-24 rounded-lg bg-surface-border" />
          <div className="mt-2 h-3 w-1/3 rounded bg-surface-border" />
        </div>
      ))}
    </div>
  );
}

function HistoryPlaceholderCover({ source, status }: { source?: "image" | "video"; status?: string }) {
  const isGenerating = status === "pending" || status === "running";
  const Icon = source === "video" ? VideoIcon : ImageIcon;
  return (
    <div className="relative flex size-24 items-center justify-center overflow-hidden rounded-lg border border-white/25 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_14px_34px_rgba(0,0,0,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,0.68),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.24),rgba(120,120,120,0.10))] dark:bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,0.14),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.025))]" />
      <div className="absolute inset-0 bg-surface-card/30 backdrop-blur-md" />
      <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(45deg,rgba(255,255,255,0.75)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.75)_50%,rgba(255,255,255,0.75)_75%,transparent_75%,transparent)] [background-size:18px_18px] dark:opacity-[0.08]" />
      <div className="absolute inset-x-2 top-2 h-px bg-white/55 dark:bg-white/12" />
      <div className="relative flex flex-col items-center gap-2 text-center">
        <div className="flex size-10 items-center justify-center rounded-2xl border border-white/35 bg-white/35 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/10">
          <img src="/brand-light-logo.png" alt="AI Space" className="h-6 w-6 opacity-70 grayscale dark:hidden" />
          <img src="/brand-dark-logo.png" alt="AI Space" className="hidden h-6 w-6 opacity-70 grayscale dark:block" />
        </div>
        <div className="flex items-center gap-1 rounded-full border border-white/30 bg-white/25 px-2 py-0.5 text-[10px] text-text-tertiary shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/10">
          <Icon className="h-3 w-3 opacity-60" />
          <span>{isGenerating ? "进行中" : "未完成"}</span>
        </div>
      </div>
    </div>
  );
}

export default function CreationHistoryPanel({
  isOpen,
  onClose,
  title,
  items,
  onSelect,
  onNew,
  onRename,
  onDelete,
  loading,
  emptyText,
  emptyHint,
  searchValue,
  searchPlaceholder,
  onSearchChange,
  confirmDelete = true,
  deleteConfirmTitle,
  deleteConfirmDescription,
  deleteConfirmText,
}: CreationHistoryPanelProps) {
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [visible, setVisible] = useState(isOpen);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CreationHistoryItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      // 确保浏览器先 paint 一次 translate-x-full 状态，再触发过渡
      const timer = window.setTimeout(() => setVisible(true), 10);
      return () => window.clearTimeout(timer);
    }

    setVisible(false);
    setEditingId(null);
    setDeleteTarget(null);
    const timer = window.setTimeout(() => setShouldRender(false), 420);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const groups = groupItems(items, t);
  const sortedLabels = sortGroupLabels(Object.keys(groups), t);

  const startRename = (item: CreationHistoryItem) => {
    setEditingId(item.id);
    setEditValue(item.title);
  };

  const finishRename = () => {
    if (onRename && editingId !== null && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finishRename();
    } else if (e.key === "Escape") {
      setEditingId(null);
    }
  };

  const handleDelete = (item: CreationHistoryItem) => {
    if (!confirmDelete && onDelete) {
      onDelete(item.id, item);
      return;
    }
    setDeleteTarget(item);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget && onDelete) {
      onDelete(deleteTarget.id, deleteTarget);
    }
    setDeleteTarget(null);
  };

  const renderCover = (item: CreationHistoryItem) => {
    const isVideo = item.source === "video";
    if (!item.cover_image) {
      return <HistoryPlaceholderCover source={item.source} status={item.status} />;
    }

    if (isVideo) {
      return (
        <div className="relative size-24 overflow-hidden rounded-lg border border-surface-border bg-surface">
          <video src={item.cover_image} className="h-full w-full object-cover" muted preload="metadata" />
          <div className="absolute bottom-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/60">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="none">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
        </div>
      );
    }

    return (
      <div className="size-24 overflow-hidden rounded-lg border border-surface-border bg-surface">
        <img
          src={resolveImageUrl(item.cover_image)}
          alt={item.title || t("common.cover")}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
    );
  };

  const renderItem = (item: CreationHistoryItem) => {
    const isActive = item.active;
    const isEditing = editingId === item.id;
    const isVideo = item.source === "video";

    return (
      <div
        key={`${item.source || "image"}:${item.id}`}
        className={cn(
          "group cursor-pointer rounded-xl border bg-surface-card p-3 transition-all duration-150",
          isActive
            ? "border-surface-border text-text-primary shadow-sm"
            : "border-surface-border text-text-secondary hover:border-brand/30 hover:bg-surface-card/80 hover:text-text-primary"
        )}
        onClick={() => {
          if (!isEditing) onSelect(item.id, item);
        }}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={finishRename}
                onClick={(e) => e.stopPropagation()}
                className="w-full rounded-md border border-brand/30 bg-surface-card px-2 py-1 text-sm text-text-primary outline-none focus:ring-1 focus:ring-brand/40"
              />
            ) : (
              <div className="flex items-start gap-2">
                <span className={cn("line-clamp-2 flex-1 text-left text-sm leading-5 text-text-primary", isActive && "font-medium")}>
                  {item.title || t("common.newConversation")}
                </span>
                <span className="shrink-0 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] leading-none text-brand">
                  {isVideo ? t("image.tab.video") : t("image.tab.image")}
                </span>
              </div>
            )}
            {item.subtitle && !isEditing && (
              <p className="mt-1 line-clamp-1 text-[11px] leading-4 text-text-tertiary">{item.subtitle}</p>
            )}
          </div>

          {!isEditing && (
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {onRename && !isVideo && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(item);
                  }}
                  className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
                  title={t("common.rename")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(item);
                  }}
                  className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-red-500/10 hover:text-red-500"
                  title={t("common.delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-col items-start gap-1.5">
          {renderCover(item)}
          <span className="text-[11px] leading-none text-text-tertiary">{formatHistoryTime(item.updated_at)}</span>
        </div>
      </div>
    );
  };

  const panel = (
    <>
      <div
        className={cn(
          "fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm transition-opacity duration-[400ms] ease-out",
          visible ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />

      <div
        className={cn(
          "fixed bottom-0 right-0 top-0 z-[71] flex w-[360px] flex-col rounded-l-2xl border-l border-surface-border bg-surface-elevated shadow-2xl transition-transform duration-[400ms] ease-out will-change-transform",
          visible ? "translate-x-0" : "translate-x-full"
        )}
        style={{ transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)" }}
      >
        <div className="flex shrink-0 items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-text-tertiary" />
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            <span className="rounded-md border border-surface-border bg-surface-card px-1.5 py-0.5 text-[11px] text-text-tertiary">
              {items.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {onNew && (
              <button
                onClick={onNew}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-brand transition-colors hover:bg-brand/10 hover:text-brand-hover"
                title={t("common.newChat")}
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {onSearchChange && (
          <div className="shrink-0 px-3 py-3">
            <div className="flex items-center gap-2 rounded-xl border border-surface-border bg-surface px-3 py-2 text-text-tertiary">
              <Search className="h-4 w-4 shrink-0" />
              <input
                value={searchValue || ""}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder || t("common.search")}
                className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading ? (
            <CreationHistorySkeleton />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
              <div className="flex size-8 items-center justify-center rounded-full border border-surface-border bg-surface-card">
                <Clock className="h-4 w-4 text-text-tertiary" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-text-secondary">{emptyText || t("common.noHistory")}</p>
                {(emptyHint || !emptyText) && <p className="text-[11px] text-text-tertiary">{emptyHint || t("common.startNewHint")}</p>}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedLabels.map((label) => (
                <div key={label}>
                  <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
                    {label}
                  </div>
                  <div className="space-y-2">{groups[label].map(renderItem)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={deleteConfirmTitle || t("common.deleteSession")}
        description={
          deleteTarget
            ? typeof deleteConfirmDescription === "function"
              ? deleteConfirmDescription(deleteTarget)
              : deleteConfirmDescription || `${t("common.deleteSessionDesc")}\n${deleteTarget.title}`
            : ""
        }
        confirmText={deleteConfirmText || t("common.delete")}
        cancelText={t("common.cancel")}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="danger"
      />
    </>
  );

  if (!mounted || !shouldRender) return null;
  return createPortal(panel, document.body);
}
