"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, FileText, Plus, Search, Sparkles, Clock, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import InputDialog from "@/components/ui/InputDialog";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { createNotebook, fetchNotebooks } from "@/lib/notebookApi";
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

export default function NotebooksPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notebooks;
    return notebooks.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(q));
  }, [notebooks, query]);

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
    <div className="min-h-full bg-surface text-text-primary">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 lg:px-10">
        <section className="overflow-hidden rounded-[28px] border border-surface-border bg-surface-card shadow-sm shadow-black/[0.03]">
          <div className="relative p-8 sm:p-10">
            <div className="absolute right-8 top-8 h-28 w-28 rounded-full bg-brand-muted blur-2xl" />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-brand-muted px-3 py-1 text-xs font-medium text-brand">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("notebook.badge")}
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">{t("notebook.title")}</h1>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-text-secondary">{t("notebook.subtitle")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-sm font-medium text-white shadow-brand transition hover:bg-brand-hover"
              >
                <Plus className="h-4 w-4" />
                {t("notebook.new")}
              </button>
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("notebook.searchPlaceholder")}
              className="h-11 w-full rounded-2xl border border-surface-border bg-surface-card pl-10 pr-4 text-sm text-text-primary outline-none transition placeholder:text-text-tertiary focus:border-brand-border focus:ring-4 focus:ring-brand-focus"
            />
          </div>
          <div className="text-sm text-text-tertiary">{t("notebook.count").replace("{count}", String(filtered.length))}</div>
        </div>

        {loading ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-[28px] border border-surface-border bg-surface-card">
            <Loader2 className="h-5 w-5 animate-spin text-brand" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[28px] border border-dashed border-surface-border bg-surface-card px-6 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-brand-muted text-brand">
              <BookOpen className="h-8 w-8" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary">{query ? t("notebook.emptySearchTitle") : t("notebook.emptyTitle")}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-text-secondary">{query ? t("notebook.emptySearchDesc") : t("notebook.emptyDesc")}</p>
            {!query && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="mt-6 inline-flex h-10 items-center gap-2 rounded-2xl bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand-hover"
              >
                <Plus className="h-4 w-4" />
                {t("notebook.new")}
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((notebook) => (
              <Link
                key={notebook.id}
                href={`/notebooks/detail?notebook_id=${notebook.id}`}
                className={cn(
                  "group flex min-h-[190px] flex-col rounded-[24px] border border-surface-border bg-surface-card p-5 shadow-sm shadow-black/[0.02] transition-all",
                  "hover:-translate-y-0.5 hover:border-brand-border hover:shadow-lg hover:shadow-brand/10"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-muted text-brand">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-text-tertiary opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                </div>
                <div className="mt-5 flex-1">
                  <h3 className="line-clamp-2 text-base font-semibold text-text-primary">{notebook.title || t("notebook.untitled")}</h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-text-secondary">
                    {notebook.description || t("notebook.cardDefaultDesc")}
                  </p>
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-surface-border/70 pt-4 text-xs text-text-tertiary">
                  <span className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />{t("notebook.fileCount").replace("{count}", String(notebook.file_count || 0))}</span>
                  <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{formatDate(notebook.updated_at)}</span>
                </div>
              </Link>
            ))}
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
