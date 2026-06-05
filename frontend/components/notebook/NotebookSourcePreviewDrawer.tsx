"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { NotebookFile, NotebookFileContent } from "@/lib/notebookTypes";
import { cn } from "@/lib/utils";

interface NotebookSourcePreviewDrawerProps {
  open: boolean;
  source: NotebookFile | null;
  data: NotebookFileContent | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusLabel(t: (key: string, params?: Record<string, string>) => string, status?: string) {
  if (status === "done") return t("notebook.statusDone");
  if (status === "error") return t("notebook.statusError");
  if (status === "unsupported") return t("notebook.statusUnsupported");
  if (status === "parsing" || status === "indexing") return t("notebook.statusProcessing");
  if (status === "skipped") return t("notebook.statusSkipped");
  return t("notebook.statusPending");
}

function highlightText(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-amber-200/70 px-0.5 text-amber-950">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function NotebookSourcePreviewDrawer({ open, source, data, loading, error, onClose }: NotebookSourcePreviewDrawerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const file = data?.file || source?.file || null;
  const content = data?.content || "";

  const contentMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !content) return [] as string[];
    const lines = content.split("\n").filter((line) => line.toLowerCase().includes(q));
    return lines.slice(0, 20);
  }, [content, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-3xl flex-col overflow-hidden border-l border-border bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-text-secondary">
              <FileText className="h-3.5 w-3.5" />
              {t("notebook.previewTitle")}
            </div>
            <h2 className="truncate text-xl font-semibold text-text-primary">{file?.filename || t("notebook.source")}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
              <span>{file?.mime_type || "—"}</span>
              <span>·</span>
              <span>{formatBytes(file?.size)}</span>
              {file?.page_count ? <><span>·</span><span>{t("notebook.previewPages", { count: String(file.page_count) })}</span></> : null}
              {file?.token_count ? <><span>·</span><span>{t("notebook.previewTokens", { count: String(file.token_count) })}</span></> : null}
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-text-secondary transition hover:bg-surface-muted hover:text-text-primary" aria-label={t("common.close") || "Close"}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-border px-6 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface-muted p-4">
              <div className="mb-1 text-xs text-text-tertiary">{t("notebook.parseStatus")}</div>
              <div className="inline-flex items-center gap-2 text-sm font-medium text-text-primary">
                {file?.parse_status === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Loader2 className={cn("h-4 w-4 text-text-tertiary", file?.parse_status === "parsing" && "animate-spin")} />}
                {statusLabel(t, file?.parse_status)}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-surface-muted p-4">
              <div className="mb-1 text-xs text-text-tertiary">{t("notebook.embeddingStatus")}</div>
              <div className="inline-flex items-center gap-2 text-sm font-medium text-text-primary">
                {file?.embedding_status === "done" || file?.embedding_status === "skipped" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Loader2 className={cn("h-4 w-4 text-text-tertiary", file?.embedding_status === "indexing" && "animate-spin")} />}
                {statusLabel(t, file?.embedding_status)}
              </div>
            </div>
          </div>
          {file?.error_message ? (
            <div className="mt-3 flex gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{file.error_message}</span>
            </div>
          ) : null}
          {data?.has_more ? <p className="mt-3 text-xs text-text-tertiary">{t("notebook.previewTruncated")}</p> : null}
        </div>

        <div className="border-b border-border px-6 py-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("notebook.previewSearchPlaceholder")}
              className="h-11 w-full rounded-2xl border border-border bg-surface-muted pl-10 pr-4 text-sm outline-none transition focus:border-brand focus:bg-surface"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-text-secondary">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("notebook.previewLoading")}
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{error}</div>
          ) : !data ? (
            <div className="rounded-2xl border border-border bg-surface-muted p-4 text-sm text-text-secondary">{t("notebook.previewEmpty")}</div>
          ) : (
            <div className="space-y-5">
              {query.trim() && contentMatches.length > 0 ? (
                <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                  <h3 className="mb-3 text-sm font-semibold text-amber-900 dark:text-amber-200">{t("notebook.previewMatches", { count: String(contentMatches.length) })}</h3>
                  <div className="space-y-2 text-sm leading-6 text-amber-950 dark:text-amber-100">
                    {contentMatches.map((line, index) => <p key={`${index}-${line.slice(0, 20)}`}>{highlightText(line, query)}</p>)}
                  </div>
                </section>
              ) : null}

              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary">{t("notebook.previewContent")}</h3>
                </div>
                {content ? (
                  <pre className="whitespace-pre-wrap rounded-2xl border border-border bg-surface-muted p-4 text-sm leading-7 text-text-secondary">{highlightText(content, query)}</pre>
                ) : (
                  <div className="rounded-2xl border border-border bg-surface-muted p-4 text-sm text-text-secondary">{t("notebook.previewNoContent")}</div>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
