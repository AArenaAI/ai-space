"use client";

import { type SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { BookOpen, Check, Clock, Grid3X3, List, Loader2, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import InputDialog from "@/components/ui/InputDialog";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { createNotebook, deleteNotebook, fetchNotebooks, updateNotebook } from "@/lib/notebookApi";
import { NOTEBOOK_DEMOS } from "@/lib/notebookDemos";
import { showNotebookError } from "@/lib/notebookErrors";
import type { Notebook } from "@/lib/notebookTypes";

function getCurrentWorkspaceId(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = localStorage.getItem("current-workspace");
  const id = raw ? Number(raw) : 0;
  return id > 0 ? id : undefined;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatFullDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}

const NOTEBOOK_DEFAULT_COVER_LOGO = "/brand-dark-logo.png";
const PINNED_NOTEBOOKS_STORAGE_KEY = "notebook-pinned-ids-v1";

type NotebookViewMode = "grid" | "list";

const NOTEBOOK_COVER_PRESETS = [
  { id: "aispace-logo", icon: NOTEBOOK_DEFAULT_COVER_LOGO, className: "bg-gradient-to-br from-[#edf4ff] via-[#eef0ff] to-[#f6efff] text-slate-950" },
];

function notebookCoverPreset(coverIcon?: string) {
  return NOTEBOOK_COVER_PRESETS.find((item) => item.id === coverIcon) || NOTEBOOK_COVER_PRESETS[0];
}

function readNotebookUploadedCover(coverIcon?: string) {
  if (coverIcon?.startsWith("uploaded:")) {
    try {
      return localStorage.getItem(`notebook-cover:${coverIcon}`) || "";
    } catch {
      return "";
    }
  }
  return "";
}

function readPinnedNotebookIds() {
  if (typeof window === "undefined") return new Set<number>();
  try {
    const raw = localStorage.getItem(PINNED_NOTEBOOKS_STORAGE_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(ids)) return new Set<number>();
    return new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id)));
  } catch {
    return new Set<number>();
  }
}

function writePinnedNotebookIds(ids: Set<number>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PINNED_NOTEBOOKS_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Pinning should still update the current UI even if browser storage is unavailable.
  }
}

function isReadonlyNotebook(notebook: Notebook) {
  return notebook.id < 0;
}

function NotebookActionsMenu({
  notebook,
  isPinned,
  open,
  onToggleOpen,
  onRename,
  onDelete,
  onTogglePin,
  align = "right",
  variant = "light",
}: {
  notebook: Notebook;
  isPinned: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  align?: "left" | "right";
  variant?: "light" | "dark";
}) {
  const { t } = useI18n();
  const readonly = isReadonlyNotebook(notebook);
  const iconClass = variant === "dark" ? "text-text-primary/80 hover:bg-surface-card/15 hover:text-text-primary" : "text-slate-500 hover:bg-surface-card/80 hover:text-slate-950";
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  const stop = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const updateMenuPosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 152;
    const rawLeft = align === "right" ? rect.right - menuWidth : rect.left;
    const left = Math.max(8, Math.min(rawLeft, window.innerWidth - menuWidth - 8));
    setMenuPosition({ top: rect.bottom + 4, left });
  };

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, align]);

  const triggerPin = (event: SyntheticEvent) => {
    stop(event);
    onTogglePin();
  };

  const menu = open && menuPosition ? createPortal(
    <div
      className="fixed z-[9999] w-[152px] overflow-hidden rounded-xl border border-surface-border bg-surface-card py-1.5 shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
      style={{ top: menuPosition.top, left: menuPosition.left }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      role="menu"
    >
          <button
            type="button"
            disabled={readonly}
            onClick={(event) => {
              stop(event);
              onDelete();
            }}
            className="flex h-10 w-full items-center gap-3 px-3 text-left text-[14px] font-normal text-text-primary transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
            {t("common.delete")}
          </button>
          <button
            type="button"
            disabled={readonly}
            onClick={(event) => {
              stop(event);
              onRename();
            }}
            className="flex h-10 w-full items-center gap-3 px-3 text-left text-[14px] font-normal text-text-primary transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Pencil className="h-4 w-4" />
            {t("notebook.renameTitle")}
          </button>
          <button
            type="button"
            onPointerDown={triggerPin}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                triggerPin(event);
              }
            }}
            className="flex h-10 w-full cursor-pointer items-center gap-3 px-3 text-left text-[14px] font-normal text-text-primary transition hover:bg-surface-hover"
          >
            {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {isPinned ? t("notebook.unpin") : t("notebook.pin")}
          </button>
    </div>,
    document.body
  ) : null;

  return (
    <div className="relative z-30">
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          stop(event);
          updateMenuPosition();
          onToggleOpen();
        }}
        className={cn("flex h-8 w-8 items-center justify-center rounded-full transition", iconClass)}
        aria-label={t("notebook.moreActions")}
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menu}
    </div>
  );
}

export default function NotebooksPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<NotebookViewMode>("grid");
  const isGridView = viewMode === "grid";
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(() => new Set());
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [renameTarget, setRenameTarget] = useState<Notebook | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Notebook | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setNotebooks(await fetchNotebooks(getCurrentWorkspaceId()));
    } catch (error) {
      showNotebookError(error, t("notebook.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    setPinnedIds(readPinnedNotebookIds());
    const handler = () => load();
    window.addEventListener("workspace-changed", handler);
    return () => window.removeEventListener("workspace-changed", handler);
  }, []);

  useEffect(() => {
    if (openMenuId === null) return;
    const close = () => setOpenMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuId]);

  const notebooksWithDemo = useMemo(() => [...notebooks, ...NOTEBOOK_DEMOS], [notebooks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notebooksWithDemo;
    return notebooksWithDemo.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(q));
  }, [notebooksWithDemo, query]);

  const pinnedNotebooks = useMemo(() => filtered.filter((item) => pinnedIds.has(item.id)), [filtered, pinnedIds]);
  const regularNotebooks = useMemo(() => filtered.filter((item) => !pinnedIds.has(item.id)), [filtered, pinnedIds]);
  const visibleCount = filtered.length;

  const trimmedQuery = query.trim();
  const isSearching = searchOpen || Boolean(trimmedQuery);

  useEffect(() => {
    if (!searchOpen) return;
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 40);
    return () => window.clearTimeout(id);
  }, [searchOpen]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const handleCreate = async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const notebook = await createNotebook({ title: trimmed, workspace_id: getCurrentWorkspaceId() });
      toast.success(t("notebook.createSuccess"));
      setCreateOpen(false);
      window.dispatchEvent(new CustomEvent("notebook-created", { detail: { id: notebook.id, title: notebook.title } }));
      router.push(`/notebooks/detail?notebook_id=${notebook.id}`);
    } catch (error) {
      showNotebookError(error, t("notebook.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const togglePin = (notebook: Notebook) => {
    const next = new Set(pinnedIds);
    const willPin = !next.has(notebook.id);
    if (willPin) {
      next.add(notebook.id);
    } else {
      next.delete(notebook.id);
    }
    setPinnedIds(next);
    writePinnedNotebookIds(next);
    setOpenMenuId(null);
    toast.success(willPin ? t("notebook.pinned") : t("notebook.unpinned"));
  };

  const handleRename = async (title: string) => {
    if (!renameTarget) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === renameTarget.title) {
      setRenameTarget(null);
      return;
    }
    setRenaming(true);
    try {
      const updated = await updateNotebook(renameTarget.id, { title: trimmed });
      setNotebooks((items) => items.map((item) => (item.id === updated.id ? { ...item, title: updated.title, updated_at: updated.updated_at } : item)));
      setRenameTarget(null);
      toast.success(t("notebook.renameTitleSuccess"));
    } catch (error) {
      showNotebookError(error, t("notebook.renameTitleFailed"));
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteNotebook(deleteTarget.id);
      setNotebooks((items) => items.filter((item) => item.id !== deleteTarget.id));
      setPinnedIds((current) => {
        const next = new Set(current);
        next.delete(deleteTarget.id);
        writePinnedNotebookIds(next);
        return next;
      });
      setDeleteTarget(null);
      toast.success(t("notebook.deleteNotebookSuccess"));
    } catch (error) {
      showNotebookError(error, t("notebook.deleteNotebookFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const openRenameDialog = (notebook: Notebook) => {
    setOpenMenuId(null);
    if (isReadonlyNotebook(notebook)) return;
    setRenameTarget(notebook);
  };

  const openDeleteDialog = (notebook: Notebook) => {
    setOpenMenuId(null);
    if (isReadonlyNotebook(notebook)) return;
    setDeleteTarget(notebook);
  };

  const renderActions = (notebook: Notebook, variant: "light" | "dark" = "light") => (
    <NotebookActionsMenu
      notebook={notebook}
      isPinned={pinnedIds.has(notebook.id)}
      open={openMenuId === notebook.id}
      onToggleOpen={() => setOpenMenuId((current) => (current === notebook.id ? null : notebook.id))}
      onRename={() => openRenameDialog(notebook)}
      onDelete={() => openDeleteDialog(notebook)}
      onTogglePin={() => togglePin(notebook)}
      variant={variant}
    />
  );

  const renderGridCard = (notebook: Notebook) => {
    const uploadedCover = readNotebookUploadedCover(notebook.cover_icon);
    const coverPreset = notebookCoverPreset(notebook.cover_icon);
    const hasImage = Boolean(uploadedCover);
    const pinned = pinnedIds.has(notebook.id);
    return (
      <div
        key={notebook.id}
        role="link"
        tabIndex={0}
        onClick={() => router.push(`/notebooks/detail?notebook_id=${notebook.id}`)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            router.push(`/notebooks/detail?notebook_id=${notebook.id}`);
          }
        }}
        className={cn(
          "group relative flex aspect-[1.62] cursor-pointer flex-col overflow-visible rounded-[20px] p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
          openMenuId === notebook.id ? "z-[180]" : "z-0",
          hasImage ? "bg-slate-900 text-text-primary" : "bg-surface-elevated text-slate-950"
        )}
      >
        <div className="absolute inset-0 overflow-hidden rounded-[20px]">
          {hasImage ? (
            <>
              <img src={uploadedCover} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/76 via-black/30 to-black/5" />
            </>
          ) : (
            <>
              <div className={cn("absolute inset-0", coverPreset.className)} />
              <img src={NOTEBOOK_DEFAULT_COVER_LOGO} alt="AI Space" className="pointer-events-none absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 object-contain opacity-90" />
            </>
          )}
        </div>
        <div className="relative z-10 flex items-start justify-end gap-1">
          {pinned && (
            <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", hasImage ? "text-text-primary/85" : "text-slate-600")}>
              <Pin className="h-4 w-4 fill-current" />
            </span>
          )}
          {renderActions(notebook, hasImage ? "dark" : "light")}
        </div>
        <div className="relative z-10 mt-auto">
          <h3 className={cn("line-clamp-2 text-[20px] font-semibold leading-6 tracking-[-0.02em]", hasImage ? "text-text-primary" : "text-slate-950")}>{notebook.title || t("notebook.untitled")}</h3>
          <div className={cn("mt-3 flex items-center justify-between text-xs font-medium", hasImage ? "text-text-primary/75" : "text-slate-500")}>
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{formatDate(notebook.updated_at)}</span>
            <span>{t("notebook.fileCount").replace("{count}", String(notebook.file_count || 0))}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderListHeader = () => (
    <div className="grid grid-cols-[minmax(520px,1fr)_140px_190px_110px_48px] border-b border-surface-border bg-surface-card px-0 pb-3 text-[14px] font-medium leading-5 text-text-tertiary">
      <span>{t("notebook.tableHeader.title")}</span>
      <span>{t("notebook.tableHeader.sources")}</span>
      <span>{t("notebook.tableHeader.created")}</span>
      <span>{t("notebook.tableHeader.role")}</span>
      <span />
    </div>
  );

  const renderListRow = (notebook: Notebook) => {
    const pinned = pinnedIds.has(notebook.id);
    return (
      <div
        key={notebook.id}
        role="link"
        tabIndex={0}
        onClick={() => router.push(`/notebooks/detail?notebook_id=${notebook.id}`)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            router.push(`/notebooks/detail?notebook_id=${notebook.id}`);
          }
        }}
        className={cn(
          "relative grid min-h-[58px] cursor-pointer grid-cols-[minmax(520px,1fr)_140px_190px_110px_48px] items-center border-b border-surface-border bg-surface-card px-0 py-3.5 transition-colors duration-100 hover:bg-surface-hover",
          openMenuId === notebook.id ? "z-[180]" : "z-0"
        )}
      >
        <span className="flex min-w-0 items-center gap-2 pr-8 text-[14px] font-normal leading-6 text-text-primary">
          {pinned && <Pin className="h-4 w-4 shrink-0 fill-current text-text-tertiary" />}
          <span className="truncate">{notebook.title || t("notebook.untitled")}</span>
        </span>
        <span className="text-[14px] font-normal leading-6 text-text-secondary">{t("notebook.fileCount").replace("{count}", String(notebook.file_count || 0))}</span>
        <span className="text-[14px] font-normal leading-6 text-text-secondary">{formatFullDate(notebook.created_at || notebook.updated_at)}</span>
        <span className="text-[14px] font-normal leading-6 text-text-secondary">Owner</span>
        <span className="flex justify-end text-text-tertiary">{renderActions(notebook)}</span>
      </div>
    );
  };

  return (
    <div className="min-h-full bg-surface-card text-text-primary">
      <main className="mx-auto flex w-full max-w-[1180px] flex-col px-8 pb-12 pt-7">
        <header className="mb-8 flex flex-col gap-0">
          <div className={cn("flex flex-col gap-4 lg:flex-row lg:items-center", isSearching ? "lg:justify-end" : "lg:justify-between")}>
            {!isSearching && (
              <div className="flex items-center gap-2.5">
                <img src={NOTEBOOK_DEFAULT_COVER_LOGO} alt="AI Space" className="h-[26px] w-[26px] shrink-0 object-contain" />
                <span className="text-[22px] font-semibold leading-none tracking-[-0.03em] text-text-primary">Notebook</span>
              </div>
            )}

            <div className={cn("flex flex-wrap items-center gap-2", isSearching && "w-full")}>
              {isSearching ? (
                <div className="relative h-10 min-w-0 flex-1 transition-all duration-200 ease-out">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                  <input
                    ref={searchInputRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("notebook.searchByTitle")}
                    className="h-10 w-full rounded-full border-2 border-brand bg-surface-card pl-11 pr-10 text-[14px] font-normal text-text-primary outline-none placeholder:text-text-tertiary"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary"
                      aria-label={t("notebook.clearSearch")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-transparent bg-surface-elevated text-text-secondary transition hover:bg-surface-hover"
                  aria-label={t("notebook.searchPlaceholder")}
                >
                  <Search className="h-4 w-4" />
                </button>
              )}
              {isSearching && (
                <button
                  type="button"
                  onClick={closeSearch}
                  className="h-8 shrink-0 px-2 text-[14px] font-medium text-brand transition hover:text-brand/80"
                >
                  {t("common.cancel")}
                </button>
              )}
              <div className="flex h-8 items-center rounded-[9px] border border-surface-border bg-surface-card p-[2px] shadow-[0_1px_1px_rgba(15,23,42,0.04)]">
                <button
                  type="button"
                  aria-pressed={viewMode === "grid"}
                  onClick={() => setViewMode("grid")}
                  className={cn(
                    "inline-flex h-7 w-[52px] items-center justify-center gap-1 rounded-[7px] px-2 text-text-secondary transition-colors duration-150 ease-out",
                    isGridView ? "bg-surface-hover text-text-primary shadow-[inset_0_0_0_1px_rgba(148,163,184,0.16)]" : "hover:bg-surface-hover hover:text-text-primary"
                  )}
                >
                  <Check className={cn("h-3.5 w-3.5 stroke-[2.4] transition-opacity duration-150", isGridView ? "opacity-100" : "opacity-0")} />
                  <Grid3X3 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === "list"}
                  onClick={() => setViewMode("list")}
                  className={cn(
                    "inline-flex h-7 w-[52px] items-center justify-center gap-1 rounded-[7px] px-2 text-text-secondary transition-colors duration-150 ease-out",
                    !isGridView ? "bg-surface-hover text-text-primary shadow-[inset_0_0_0_1px_rgba(148,163,184,0.16)]" : "hover:bg-surface-hover hover:text-text-primary"
                  )}
                >
                  <Check className={cn("h-3.5 w-3.5 stroke-[2.4] transition-opacity duration-150", !isGridView ? "opacity-100" : "opacity-0")} />
                  <List className="h-4 w-4" />
                </button>
              </div>
              {!isSearching && (
                <>
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[8px] bg-surface-elevated px-3.5 text-[13px] font-medium text-text-primary shadow-[0_1px_2px_rgba(15,23,42,0.12)] transition hover:bg-surface-hover"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("notebook.new")}
                  </button>
                </>
              )}
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-slate-200 bg-surface-card">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          </div>
        ) : filtered.length === 0 && !isSearching ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-surface-card px-6 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-600">
              <BookOpen className="h-8 w-8" />
            </div>
            <h2 className="text-lg font-semibold text-slate-950">{query ? t("notebook.emptySearchTitle") : t("notebook.emptyTitle")}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{query ? t("notebook.emptySearchDesc") : t("notebook.emptyDesc")}</p>
            {!query && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="mt-6 inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-text-primary transition hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                {t("notebook.new")}
              </button>
            )}
          </div>
        ) : (
          <div className="min-h-[420px] bg-surface-card">
            <section className="space-y-9 bg-surface-card">
              {pinnedNotebooks.length > 0 && (
                <div>
                  <div className="mb-5 flex items-center gap-2 text-[24px] font-medium tracking-[-0.025em] text-text-primary">
                    <Pin className="h-5 w-5 fill-current text-text-secondary" />
                    <h2>{t("notebook.fixedSection")}</h2>
                  </div>
                  {viewMode === "grid" ? (
                    <div className="grid gap-6 lg:grid-cols-3">{pinnedNotebooks.map(renderGridCard)}</div>
                  ) : (
                    <div className="relative isolate bg-surface-card">
                      <div className="absolute inset-0 -z-10 bg-surface-card" aria-hidden="true" />
                      {renderListHeader()}
                      {pinnedNotebooks.map(renderListRow)}
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="mb-5">
                  {trimmedQuery && (
                    <div className="mb-1.5 text-[13px] font-normal text-text-tertiary">{t("notebook.searchResults", { count: String(visibleCount) })}</div>
                  )}
                  <div className="flex items-center justify-between">
                    <h2 className="text-[24px] font-medium tracking-[-0.025em] text-text-primary">{t("notebook.allSection")}</h2>
                    {!trimmedQuery && <div className="text-sm text-text-secondary">{t("notebook.count").replace("{count}", String(visibleCount))}</div>}
                  </div>
                </div>
                {viewMode === "grid" ? (
                  <div className="grid gap-6 lg:grid-cols-3">
                    {!trimmedQuery && (
                      <button
                        type="button"
                        onClick={() => setCreateOpen(true)}
                        className="flex aspect-[1.62] flex-col items-center justify-center rounded-[20px] border border-surface-border bg-surface-card text-center shadow-sm transition hover:-translate-y-0.5 hover:border-surface-border hover:bg-surface-hover hover:shadow-md"
                      >
                        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                          <Plus className="h-6 w-6" />
                        </span>
                        <span className="text-sm font-medium text-text-secondary">{t("notebook.new")}</span>
                      </button>
                    )}
                    {regularNotebooks.length === 0 && trimmedQuery ? (
                      <div className="col-span-full flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-surface-border bg-surface-card px-6 text-center">
                        <BookOpen className="mb-4 h-8 w-8 text-text-tertiary" />
                        <h3 className="text-base font-medium text-text-primary">{t("notebook.emptySearchTitle")}</h3>
                        <p className="mt-2 text-sm text-text-secondary">{t("notebook.emptySearchDesc")}</p>
                      </div>
                    ) : regularNotebooks.map(renderGridCard)}
                  </div>
                ) : (
                  <div className="relative isolate bg-surface-card">
                    <div className="absolute inset-0 -z-10 bg-surface-card" aria-hidden="true" />
                    {renderListHeader()}
                    {regularNotebooks.length === 0 && trimmedQuery ? (
                      <div className="flex min-h-[180px] flex-col items-center justify-center border-b border-surface-border px-6 text-center">
                        <BookOpen className="mb-4 h-8 w-8 text-text-tertiary" />
                        <h3 className="text-base font-medium text-text-primary">{t("notebook.emptySearchTitle")}</h3>
                        <p className="mt-2 text-sm text-text-secondary">{t("notebook.emptySearchDesc")}</p>
                      </div>
                    ) : regularNotebooks.map(renderListRow)}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      <InputDialog
        isOpen={createOpen}
        title={t("notebook.createTitle")}
        placeholder={t("notebook.createPlaceholder")}
        defaultValue=""
        confirmText={creating ? t("common.processing") : t("common.confirm")}
        cancelText={t("common.cancel")}
        onConfirm={handleCreate}
        onCancel={() => setCreateOpen(false)}
      />

      <InputDialog
        isOpen={Boolean(renameTarget)}
        title={t("notebook.renameTitle")}
        placeholder={t("notebook.enterNewTitle")}
        defaultValue={renameTarget?.title || ""}
        confirmText={renaming ? t("common.processing") : t("common.confirm")}
        cancelText={t("common.cancel")}
        onConfirm={handleRename}
        onCancel={() => setRenameTarget(null)}
      />

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setDeleteTarget(null)} />
          <div className="relative mx-4 w-full max-w-[360px] rounded-2xl border border-surface-border bg-surface-elevated p-6 shadow-2xl animate-dialog-appear">
            <h3 className="mb-2 text-base font-semibold text-text-primary">{t("notebook.deleteConfirmTitle")}</h3>
            <p className="mb-5 text-sm leading-relaxed text-text-secondary">
              删除后将无法在当前列表中恢复：<span className="font-medium text-text-primary">{deleteTarget.title || t("notebook.untitled")}</span>
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-surface-border bg-surface-card px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-elevated disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? t("common.processing") : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}