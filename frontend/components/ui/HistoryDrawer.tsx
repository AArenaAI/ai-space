"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X,
  MessageSquarePlus,
  Pencil,
  Trash2,
  MessageSquare,
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  Languages,
  Check,
  Pin,
  Clock,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/resolveImageUrl";
import ConfirmDialog from "./ConfirmDialog";
import { useI18n } from "@/lib/i18n";

export interface HistoryItem {
  id: number;
  title: string;
  subtitle?: string;
  active?: boolean;
  pinned?: boolean;
  updated_at: string;
  icon?: "chat" | "image" | "video" | "file" | "language";
  source?: "image" | "video";
  cover_image?: string;
  status?: string;
}

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  items: HistoryItem[];
  onSelect: (id: number, item: HistoryItem) => void;
  onNew?: () => void;
  onRename?: (id: number, title: string) => void;
  onDelete?: (id: number, item: HistoryItem) => void;
  onTogglePin?: (id: number) => void;
  loading?: boolean;
  type?: "chat" | "image";
  emptyText?: string;
  emptyHint?: string;
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  confirmDelete?: boolean;
  deleteConfirmTitle?: string;
  deleteConfirmDescription?: string | ((item: HistoryItem) => string);
  deleteConfirmText?: string;
}

/* 时间分组 */
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

const getGroupOrder = (t: (key: string) => string) => [t("sidebar.time.today"), t("sidebar.time.yesterday"), t("sidebar.time.last7days"), t("sidebar.time.last30days")];

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

function groupItems(items: HistoryItem[], t: (key: string) => string) {
  const groups: Record<string, HistoryItem[]> = {};
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

/* 骨架屏 */
function HistorySkeleton() {
  return (
    <div className="space-y-2 px-2 py-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-2 animate-pulse">
          <div className="w-3.5 h-3.5 rounded-sm bg-surface-border shrink-0" />
          <div className="h-3.5 rounded-sm bg-surface-border w-[70%]" />
        </div>
      ))}
    </div>
  );
}

export default function HistoryDrawer({
  isOpen,
  onClose,
  title,
  items,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onTogglePin,
  loading,
  type = "chat",
  emptyText,
  emptyHint,
  searchValue,
  searchPlaceholder,
  onSearchChange,
  confirmDelete = true,
  deleteConfirmTitle,
  deleteConfirmDescription,
  deleteConfirmText,
}: HistoryDrawerProps) {
  const { t } = useI18n();
  const [deleteTarget, setDeleteTarget] = useState<HistoryItem | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [visible, setVisible] = useState(isOpen);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (onRename && editingId !== null && editValue.trim()) {
        onRename(editingId, editValue.trim());
      }
      setEditingId(null);
    } else if (e.key === "Escape") {
      setEditingId(null);
    }
  };

  const startRename = (item: HistoryItem) => {
    setEditingId(item.id);
    setEditValue(item.title);
  };

  const handleDelete = (item: HistoryItem) => {
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

  const pinned = items.filter((i) => i.pinned);
  const unpinned = items.filter((i) => !i.pinned);
  const groups = groupItems(unpinned, t);
  const sortedLabels = sortGroupLabels(Object.keys(groups), t);

  const renderItem = (item: HistoryItem) => {
    const isActive = item.active;
    const isEditing = editingId === item.id;
    const Icon = item.icon === "file"
      ? FileText
      : item.icon === "language"
        ? Languages
        : item.source === "video" || item.icon === "video"
          ? VideoIcon
          : type === "image" || item.icon === "image"
            ? ImageIcon
            : MessageSquare;
    const hasCover = item.cover_image;
    const isVideo = item.source === "video";

    return (
      <div
        key={`${item.source || type}:${item.id}`}
        className={cn(
          "group rounded-xl transition-all duration-150 cursor-pointer",
          hasCover
            ? "p-0 overflow-hidden border"
            : "flex items-center gap-2 px-3 py-2.5",
          isActive
            ? hasCover
              ? "bg-surface-card border-surface-border text-text-primary shadow-sm"
              : "bg-surface-card border border-surface-border text-text-primary shadow-sm"
            : hasCover
              ? "bg-surface-card border-surface-border hover:border-brand/30 hover:bg-surface-card/80 text-text-secondary"
              : "text-text-secondary hover:bg-surface-card/70 hover:text-text-primary border border-transparent"
        )}
        onClick={() => {
          if (!isEditing) onSelect(item.id, item);
        }}
      >
        {/* 带封面图的图片会话卡片布局 */}
        {hasCover ? (
          <div className="flex flex-col px-3 py-2.5">
            {/* 标题栏 */}
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                {item.pinned && (
                  <Pin className="mt-0.5 w-3 h-3 shrink-0 text-brand rotate-45" />
                )}
                {isEditing ? (
                  <input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => {
                      if (onRename && editValue.trim()) {
                        onRename(item.id, editValue.trim());
                      }
                      setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-surface-card border border-brand/30 rounded-md px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-brand/40"
                  />
                ) : (
                  <span className={cn("line-clamp-2 text-left text-sm leading-5 text-text-primary", isActive && "font-medium")}>
                    {item.title || t("common.newConversation")}
                  </span>
                )}
                {isVideo && (
                  <span className="shrink-0 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] leading-none text-brand">
                    {t("image.tab.video")}
                  </span>
                )}
              </div>
              {!isEditing && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  {onTogglePin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin(item.id);
                      }}
                      className="p-1 rounded-md text-text-tertiary hover:text-brand hover:bg-brand/10 transition-colors"
                      title={item.pinned ? t("common.unpin") : t("common.pin")}
                    >
                      <Pin className={cn("w-3.5 h-3.5", item.pinned && "rotate-45 text-brand")} />
                    </button>
                  )}
                  {onRename && !isVideo && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(item);
                      }}
                      className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
                      title={t("common.rename")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item);
                      }}
                      className="p-1 rounded-md text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      title={t("common.delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
            {/* 首图 + 时间 */}
            <div className="mt-2 flex flex-col items-start gap-1.5">
              <div className="relative size-24 overflow-hidden rounded-lg bg-surface border border-surface-border">
                {isVideo ? (
                  <>
                    <video
                      src={item.cover_image || ""}
                      className="w-full h-full object-cover"
                      muted
                      preload="metadata"
                    />
                    <div className="absolute bottom-1 right-1 flex items-center justify-center w-6 h-6 rounded-full bg-black/60">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </div>
                  </>
                ) : (
                  <img
                    src={resolveImageUrl(item.cover_image || "")}
                    alt={item.title || t("common.cover")}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )}
              </div>
              <span className="text-[11px] leading-none text-text-tertiary">
                {formatHistoryTime(item.updated_at)}
              </span>
            </div>
          </div>
        ) : type === "image" ? (
          /* 图片会话无封面时：仍展示标题与时间 */
          <div className="flex w-full flex-col px-3 py-2.5">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {item.pinned && (
                  <Pin className="w-3 h-3 shrink-0 text-brand rotate-45" />
                )}
                {isEditing ? (
                  <input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => {
                      if (onRename && editValue.trim()) {
                        onRename(item.id, editValue.trim());
                      }
                      setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-surface-card border border-brand/30 rounded-md px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-brand/40"
                  />
                ) : (
                  <span className={cn("line-clamp-2 text-left text-sm leading-5 text-text-primary", isActive && "font-medium")}>
                    {item.title || t("common.newConversation")}
                  </span>
                )}
                {isVideo && (
                  <span className="shrink-0 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] leading-none text-brand">
                    {t("image.tab.video")}
                  </span>
                )}
              </div>
              {!isEditing && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  {onTogglePin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin(item.id);
                      }}
                      className="p-1 rounded-md text-text-tertiary hover:text-brand hover:bg-brand/10 transition-colors"
                      title={item.pinned ? t("common.unpin") : t("common.pin")}
                    >
                      <Pin className={cn("w-3.5 h-3.5", item.pinned && "rotate-45 text-brand")} />
                    </button>
                  )}
                  {onRename && !isVideo && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(item);
                      }}
                      className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
                      title={t("common.rename")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item);
                      }}
                      className="p-1 rounded-md text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      title={t("common.delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
            <span className="mt-1.5 text-[11px] leading-none text-text-tertiary">
              {formatHistoryTime(item.updated_at)}
            </span>
          </div>
        ) : (
          /* 无封面图的默认行布局 */
          <>
            {item.pinned && (
              <Pin className="w-3 h-3 shrink-0 text-brand rotate-45" />
            )}
            <Icon
              className={cn(
                "w-3.5 h-3.5 shrink-0",
                isActive ? "text-text-primary" : "text-text-tertiary group-hover:text-text-secondary"
              )}
            />

            {isEditing ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                  if (onRename && editValue.trim()) {
                    onRename(item.id, editValue.trim());
                  }
                  setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 bg-surface-card border border-brand/30 rounded-md px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-brand/40"
              />
            ) : (
              <span className="min-w-0 flex-1 text-left">
                <span className={cn("block truncate", isActive && "font-medium")}>
                  {item.title || t("common.newConversation")}
                </span>
                {item.subtitle && (
                  <span className="mt-0.5 block truncate text-[11px] leading-4 text-text-tertiary">
                    {item.subtitle}
                  </span>
                )}
              </span>
            )}

            {!isEditing && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {onTogglePin && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePin(item.id);
                    }}
                    className="p-1 rounded-md text-text-tertiary hover:text-brand hover:bg-brand/10 transition-colors"
                    title={item.pinned ? t("common.unpin") : t("common.pin")}
                  >
                    <Pin className={cn("w-3.5 h-3.5", item.pinned && "rotate-45 text-brand")} />
                  </button>
                )}
                {onRename && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(item);
                    }}
                    className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
                    title={t("common.rename")}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(item);
                    }}
                    className="p-1 rounded-md text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                    title={t("common.delete")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const panel = (
    <>
      {/* 遮罩 */}
      <div
        className={cn(
          "fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm transition-opacity duration-[400ms] ease-out",
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* 面板 */}
      <div
        className={cn(
          "fixed top-0 right-0 bottom-0 z-[71] w-[340px] bg-surface-elevated border-l border-surface-border shadow-2xl flex flex-col rounded-l-2xl transition-transform duration-[400ms] ease-out will-change-transform",
          visible ? "translate-x-0" : "translate-x-full"
        )}
        style={{ transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)" }}
      >
        {/* 头部 */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3.5 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-text-tertiary" />
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            <span className="text-[11px] text-text-tertiary bg-surface-card border border-surface-border px-1.5 py-0.5 rounded-md">
              {items.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {onNew && (
              <button
                onClick={onNew}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-brand hover:text-brand-hover hover:bg-brand/10 transition-colors"
                title={t("common.newChat")}
              >
                <MessageSquarePlus className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {onSearchChange && (
          <div className="shrink-0 px-3 py-3 border-b border-surface-border/60">
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

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading ? (
            <HistorySkeleton />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
              <div className="flex size-8 items-center justify-center rounded-full bg-surface-card border border-surface-border">
                <Clock className="w-4 h-4 text-text-tertiary" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-text-secondary">{emptyText || t("common.noHistory")}</p>
                {(emptyHint || !emptyText) && <p className="text-[11px] text-text-tertiary">{emptyHint || t("common.startNewHint")}</p>}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {pinned.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[11px] font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
                    <Pin className="w-3 h-3" />
                    {t("common.pin")}
                  </div>
                  <div className="space-y-0.5">{pinned.map(renderItem)}</div>
                </div>
              )}
              {sortedLabels.map((label) => (
                <div key={label}>
                  <div className="px-2 py-1 text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                    {label}
                  </div>
                  <div className="space-y-0.5">{groups[label].map(renderItem)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 删除确认弹窗 */}
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
