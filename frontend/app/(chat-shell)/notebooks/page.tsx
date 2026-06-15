"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Check, ChevronDown, Clock, Grid3X3, List, Loader2, MoreHorizontal, Plus, Search } from "lucide-react";
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
  const [viewMode, setViewMode] = useState<NotebookViewMode>("grid");
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
        <header className="mb-9 flex flex-col gap-0">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 text-[15px] font-medium text-slate-600">
              <button type="button" className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-slate-950 shadow-sm">全部</button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" aria-label={t("notebook.searchPlaceholder")}>
                <Search className="h-5 w-5" />
              </button>
              <div className="relative flex h-10 w-[92px] items-center rounded-full border border-slate-200 bg-white p-1 shadow-sm">
                <span
                  className={cn(
                    "absolute left-1 top-1 h-8 w-10 rounded-full bg-[#eef4ff] shadow-sm ring-1 ring-blue-100 transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)]",
                    viewMode === "list" && "translate-x-10"
                  )}
                />
                <button
                  type="button"
                  aria-pressed={viewMode === "grid"}
                  onClick={() => setViewMode("grid")}
                  className={cn(
                    "relative z-10 inline-flex h-8 w-10 items-center justify-center gap-1 rounded-full text-slate-500 transition-colors duration-200",
                    viewMode === "grid" ? "text-blue-600" : "hover:text-slate-900"
                  )}
                >
                  {viewMode === "grid" && <Check className="h-3.5 w-3.5" />}
                  <Grid3X3 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === "list"}
                  onClick={() => setViewMode("list")}
                  className={cn(
                    "relative z-10 inline-flex h-8 w-10 items-center justify-center gap-1 rounded-full text-slate-500 transition-colors duration-200",
                    viewMode === "list" ? "text-blue-600" : "hover:text-slate-900"
                  )}
                >
                  {viewMode === "list" && <Check className="h-3.5 w-3.5" />}
                  <List className="h-4 w-4" />
                </button>
              </div>
              <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                最近
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </button>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                {t("notebook.new")}
              </button>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          </div>
        ) : filtered.length === 0 ? (
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
          <div>
            <section>
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-[24px] font-medium tracking-[-0.025em] text-slate-950">全部</h2>
                <div className="text-sm text-slate-500">{t("notebook.count").replace("{count}", String(filtered.length))}</div>
              </div>
              {viewMode === "grid" ? (
                <div className="grid gap-6 lg:grid-cols-3">
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

                  {filtered.map((notebook) => {
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
                <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
                  <div className="grid grid-cols-[minmax(320px,1fr)_130px_180px_110px_44px] border-b border-slate-200 px-5 py-3 text-xs font-medium text-slate-400">
                    <span>标题</span>
                    <span>来源</span>
                    <span>创建日期</span>
                    <span>角色</span>
                    <span />
                  </div>
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className="grid w-full grid-cols-[minmax(320px,1fr)_130px_180px_110px_44px] items-center border-b border-slate-100 px-5 py-4 text-left transition hover:bg-slate-50"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                        <Plus className="h-5 w-5" />
                      </span>
                      <span className="text-sm font-medium text-slate-950">{t("notebook.new")}</span>
                    </span>
                    <span className="text-sm text-slate-500">—</span>
                    <span className="text-sm text-slate-500">—</span>
                    <span className="text-sm text-slate-500">Owner</span>
                    <span />
                  </button>
                  {filtered.map((notebook) => (
                    <Link
                      key={notebook.id}
                      href={`/notebooks/detail?notebook_id=${notebook.id}`}
                      className="grid grid-cols-[minmax(320px,1fr)_130px_180px_110px_44px] items-center border-b border-slate-100 px-5 py-4 last:border-b-0 transition hover:bg-slate-50"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
                          <BookOpen className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 text-sm font-medium leading-6 text-slate-950">{notebook.title || t("notebook.untitled")}</span>
                      </span>
                      <span className="text-sm text-slate-600">{t("notebook.fileCount").replace("{count}", String(notebook.file_count || 0))}</span>
                      <span className="text-sm text-slate-600">{formatFullDate(notebook.created_at || notebook.updated_at)}</span>
                      <span className="text-sm text-slate-600">Owner</span>
                      <span className="flex justify-end text-slate-400">
                        <MoreHorizontal className="h-4 w-4" />
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