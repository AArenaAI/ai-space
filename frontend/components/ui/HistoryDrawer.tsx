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
  Check,
  Pin,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/resolveImageUrl";
import ConfirmDialog from "./ConfirmDialog";

export interface HistoryItem {
  id: number;
  title: string;
  active?: boolean;
  pinned?: boolean;
  updated_at: string;
  icon?: "chat" | "image";
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
}

/* 时间分组 */
function getTimeGroupLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((nowDate.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays <= 7) return "七天内";
  if (diffDays <= 30) return "30天内";
  return `${date.getFullYear()}.${date.getMonth() + 1}`;
}

const GROUP_ORDER = ["今天", "昨天", "七天内", "30天内"];

function sortGroupLabels(labels: string[]): string[] {
  const fixed = GROUP_ORDER.filter((g) => labels.includes(g));
  const months = labels
    .filter((l) => !GROUP_ORDER.includes(l))
    .sort((a, b) => {
      const [ay, am] = a.split(".").map(Number);
      const [by, bm] = b.split(".").map(Number);
      if (ay !== by) return by - ay;
      return bm - am;
    });
  return [...fixed, ...months];
}

function groupItems(items: HistoryItem[]) {
  const groups: Record<string, HistoryItem[]> = {};
  for (const item of items) {
    const label = getTimeGroupLabel(item.updated_at);
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
}: HistoryDrawerProps) {
  const [deleteTarget, setDeleteTarget] = useState<HistoryItem | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setEditingId(null);
      setDeleteTarget(null);
    }
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
    setDeleteTarget(item);
  };

  const confirmDelete = () => {
    if (deleteTarget && onDelete) {
      onDelete(deleteTarget.id, deleteTarget);
    }
    setDeleteTarget(null);
  };

  const pinned = items.filter((i) => i.pinned);
  const unpinned = items.filter((i) => !i.pinned);
  const groups = groupItems(unpinned);
  const sortedLabels = sortGroupLabels(Object.keys(groups));

  const renderItem = (item: HistoryItem) => {
    const isActive = item.active;
    const isEditing = editingId === item.id;
    const Icon = item.source === "video" ? VideoIcon : type === "image" ? ImageIcon : MessageSquare;
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
                    {item.title || "新对话"}
                  </span>
                )}
                {isVideo && (
                  <span className="shrink-0 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] leading-none text-brand">
                    视频
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
                      title={item.pinned ? "取消置顶" : "置顶"}
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
                      title="重命名"
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
                      title="删除"
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
                    alt={item.title || "封面"}
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
                    {item.title || "新对话"}
                  </span>
                )}
                {isVideo && (
                  <span className="shrink-0 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] leading-none text-brand">
                    视频
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
                      title={item.pinned ? "取消置顶" : "置顶"}
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
                      title="重命名"
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
                      title="删除"
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
              <span className={cn("flex-1 truncate text-left", isActive && "font-medium")}>
                {item.title || "新对话"}
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
                    title={item.pinned ? "取消置顶" : "置顶"}
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
                    title="重命名"
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
                    title="删除"
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
          "fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* 面板 */}
      <div
        className={cn(
          "fixed top-0 right-0 bottom-0 z-[71] w-[340px] bg-surface-elevated border-l border-surface-border shadow-2xl flex flex-col transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
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
                title="新建会话"
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
                <p className="text-xs text-text-secondary">暂无历史记录</p>
                <p className="text-[11px] text-text-tertiary">点击上方 + 开始新对话</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {pinned.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[11px] font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
                    <Pin className="w-3 h-3" />
                    置顶
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
        title="删除会话"
        description="确定要删除此会话吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="danger"
      />
    </>
  );

  if (!mounted) return null;
  return createPortal(panel, document.body);
}
