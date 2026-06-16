"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Check, ChevronDown, Clock, Grid3X3, List, Loader2, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import InputDialog from "@/components/ui/InputDialog";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { createNotebook, fetchNotebooks } from "@/lib/notebookApi";
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
    const handler = () => load();
    window.addEventListener("workspace-changed", handler);
    return () => window.removeEventListener("workspace-changed", handler);
  }, []);

  const notebooksWithDemo = useMemo(() => [...notebooks, ...NOTEBOOK_DEMOS], [notebooks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notebooksWithDemo;
    return notebooksWithDemo.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(q));
  }, [notebooksWithDemo, query]);

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

  return (
    <div className="min-h-full bg-white text-slate-950">
      <main className="mx-auto flex w-full max-w-[1180px] flex-col px-8 pb-12 pt-7">
        <header className="mb-8 flex flex-col gap-0">
          <div className={cn("flex flex-col gap-4 lg:flex-row lg:items-center", isSearching ? "lg:justify-end" : "lg:justify-between")}>
            {!isSearching && (
              <div className="flex items-center gap-2.5">
                <img src={NOTEBOOK_DEFAULT_COVER_LOGO} alt="AI Space" className="h-[26px] w-[26px] shrink-0 object-contain" />
                <span className="text-[22px] font-semibold leading-none tracking-[-0.03em] text-[#111827]">Notebook</span>
              </div>
            )}

            <div className={cn("flex flex-wrap items-center gap-2", isSearching && "w-full")}>
              {isSearching ? (
                <div className="relative h-10 min-w-0 flex-1 transition-all duration-200 ease-out">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5f6368]" />
                  <input
                    ref={searchInputRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="按笔记本标题搜索"
                    className="h-10 w-full rounded-full border-2 border-[#1a73e8] bg-white pl-11 pr-10 text-[14px] font-normal text-[#202124] outline-none placeholder:text-[#5f6368]"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#202124]"
                      aria-label="清空搜索"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-transparent bg-[#f1f3f4] text-[#3c4043] transition hover:bg-[#e8eaed]"
                  aria-label={t("notebook.searchPlaceholder")}
                >
                  <Search className="h-4 w-4" />
                </button>
              )}
              {isSearching && (
                <button
                  type="button"
                  onClick={closeSearch}
                  className="h-8 shrink-0 px-2 text-[14px] font-medium text-[#1a73e8] transition hover:text-[#1558b0]"
                >
                  取消
                </button>
              )}
              <div className="flex h-8 items-center rounded-[9px] border border-[#d9dde5] bg-white p-[2px] shadow-[0_1px_1px_rgba(15,23,42,0.04)]">
                <button
                  type="button"
                  aria-pressed={viewMode === "grid"}
                  onClick={() => setViewMode("grid")}
                  className={cn(
                    "inline-flex h-7 w-[52px] items-center justify-center gap-1 rounded-[7px] px-2 text-[#4b5563] transition-colors duration-150 ease-out",
                    isGridView ? "bg-[#e8edf5] text-[#111827] shadow-[inset_0_0_0_1px_rgba(148,163,184,0.16)]" : "hover:bg-[#f6f7f9] hover:text-[#111827]"
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
                    "inline-flex h-7 w-[52px] items-center justify-center gap-1 rounded-[7px] px-2 text-[#4b5563] transition-colors duration-150 ease-out",
                    !isGridView ? "bg-[#e8edf5] text-[#111827] shadow-[inset_0_0_0_1px_rgba(148,163,184,0.16)]" : "hover:bg-[#f6f7f9] hover:text-[#111827]"
                  )}
                >
                  <Check className={cn("h-3.5 w-3.5 stroke-[2.4] transition-opacity duration-150", !isGridView ? "opacity-100" : "opacity-0")} />
                  <List className="h-4 w-4" />
                </button>
              </div>
              {!isSearching && (
                <>
                  <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#d9dde5] bg-white px-3 text-[13px] font-medium text-[#374151] shadow-[0_1px_1px_rgba(15,23,42,0.04)] transition hover:bg-[#f6f7f9]">
                    最近
                    <ChevronDown className="h-3.5 w-3.5 text-[#6b7280]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[8px] bg-[#111827] px-3.5 text-[13px] font-medium text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)] transition hover:bg-[#1f2937]"
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
          <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          </div>
        ) : filtered.length === 0 && !isSearching ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-600">
              <BookOpen className="h-8 w-8" />
            </div>
            <h2 className="text-lg font-semibold text-slate-950">{query ? t("notebook.emptySearchTitle") : t("notebook.emptyTitle")}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{query ? t("notebook.emptySearchDesc") : t("notebook.emptyDesc")}</p>
            {!query && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="mt-6 inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                {t("notebook.new")}
              </button>
            )}
          </div>
        ) : (
          <div className="min-h-[420px] bg-white">
            <section className="bg-white">
              <div className="mb-5">
                {trimmedQuery && (
                  <div className="mb-1.5 text-[13px] font-normal text-[#5f6368]">搜索结果（{filtered.length}条）</div>
                )}
                <div className="flex items-center justify-between">
                  <h2 className="text-[24px] font-medium tracking-[-0.025em] text-slate-950">全部</h2>
                  {!trimmedQuery && <div className="text-sm text-slate-500">{t("notebook.count").replace("{count}", String(filtered.length))}</div>}
                </div>
              </div>
              {viewMode === "grid" ? (
                <div className="grid gap-6 lg:grid-cols-3">
                  {!trimmedQuery && (
                    <button
                      type="button"
                      onClick={() => setCreateOpen(true)}
                      className="flex aspect-[1.62] flex-col items-center justify-center rounded-[20px] border border-slate-200 bg-white text-center shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md"
                    >
                      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                        <Plus className="h-6 w-6" />
                      </span>
                      <span className="text-sm font-medium text-slate-700">{t("notebook.new")}</span>
                    </button>
                  )}

                  {filtered.length === 0 && trimmedQuery ? (
                    <div className="col-span-full flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 text-center">
                      <BookOpen className="mb-4 h-8 w-8 text-slate-400" />
                      <h3 className="text-base font-medium text-slate-950">{t("notebook.emptySearchTitle")}</h3>
                      <p className="mt-2 text-sm text-slate-500">{t("notebook.emptySearchDesc")}</p>
                    </div>
                  ) : filtered.map((notebook) => {
                    const uploadedCover = readNotebookUploadedCover(notebook.cover_icon);
                    const coverPreset = notebookCoverPreset(notebook.cover_icon);
                    const hasImage = Boolean(uploadedCover);
                    return (
                      <Link
                        key={notebook.id}
                        href={`/notebooks/detail?notebook_id=${notebook.id}`}
                        className={cn(
                          "group relative flex aspect-[1.62] flex-col overflow-hidden rounded-[20px] p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
                          hasImage ? "bg-slate-900 text-white" : "bg-[#eef4ff] text-slate-950"
                        )}
                      >
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
                        <div className="relative z-10 flex justify-end">
                          <span className={cn("flex h-8 w-8 items-center justify-center rounded-full transition", hasImage ? "text-white/80 hover:bg-white/15" : "text-slate-500 hover:bg-white/70 hover:text-slate-900")}>
                            <MoreHorizontal className="h-4 w-4" />
                          </span>
                        </div>
                        <div className="relative z-10 mt-auto">
                          <h3 className={cn("line-clamp-2 text-[20px] font-semibold leading-6 tracking-[-0.02em]", hasImage ? "text-white" : "text-slate-950")}>{notebook.title || t("notebook.untitled")}</h3>
                          <div className={cn("mt-3 flex items-center justify-between text-xs font-medium", hasImage ? "text-white/75" : "text-slate-500")}>
                            <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{formatDate(notebook.updated_at)}</span>
                            <span>{t("notebook.fileCount").replace("{count}", String(notebook.file_count || 0))}</span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="relative isolate bg-white">
                  <div className="absolute inset-0 -z-10 bg-white" aria-hidden="true" />
                  <div className="grid grid-cols-[minmax(520px,1fr)_140px_190px_110px_40px] border-b border-[#e5e7eb] bg-white px-0 pb-3 text-[14px] font-medium leading-5 text-[#6b7280]">
                    <span>标题</span>
                    <span>来源</span>
                    <span>创建日期</span>
                    <span>角色</span>
                    <span />
                  </div>
                  {filtered.length === 0 && trimmedQuery ? (
                    <div className="flex min-h-[180px] flex-col items-center justify-center border-b border-[#e5e7eb] px-6 text-center">
                      <BookOpen className="mb-4 h-8 w-8 text-slate-400" />
                      <h3 className="text-base font-medium text-slate-950">{t("notebook.emptySearchTitle")}</h3>
                      <p className="mt-2 text-sm text-slate-500">{t("notebook.emptySearchDesc")}</p>
                    </div>
                  ) : filtered.map((notebook) => (
                    <Link
                      key={notebook.id}
                      href={`/notebooks/detail?notebook_id=${notebook.id}`}
                      className="grid min-h-[58px] grid-cols-[minmax(520px,1fr)_140px_190px_110px_40px] items-center border-b border-[#e5e7eb] bg-white px-0 py-3.5 transition-colors duration-100 hover:bg-[#f9fafb]"
                    >
                      <span className="min-w-0 pr-8 text-[14px] font-normal leading-6 text-[#111827]">{notebook.title || t("notebook.untitled")}</span>
                      <span className="text-[14px] font-normal leading-6 text-[#4b5563]">{t("notebook.fileCount").replace("{count}", String(notebook.file_count || 0))}</span>
                      <span className="text-[14px] font-normal leading-6 text-[#4b5563]">{formatFullDate(notebook.created_at || notebook.updated_at)}</span>
                      <span className="text-[14px] font-normal leading-6 text-[#4b5563]">Owner</span>
                      <span className="flex justify-end text-[#6b7280]">
                        <MoreHorizontal className="h-5 w-5" />
                      </span>
                    </Link>
                  ))}
                </div>
              )}
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
    </div>
  );
}