"use client";

import { useEffect, useMemo } from "react";
import { ChevronDown, ExternalLink, FileText, Loader2, Plus, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { NotebookFile, NotebookFileContent } from "@/lib/notebookTypes";
import type { NotebookSourceOpenTarget } from "@/components/notebook/NotebookStudioPanel";
import { cn } from "@/lib/utils";

interface NotebookSourcePreviewDrawerProps {
  open: boolean;
  source: NotebookFile | null;
  data: NotebookFileContent | null;
  loading: boolean;
  error: string | null;
  target?: NotebookSourceOpenTarget | null;
  onClose: () => void;
  onAddSource?: () => void;
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function chunkAnchorId(index: number) {
  return `notebook-source-chunk-${index}`;
}

function plainSummary(file: NotebookFile["file"] | null, content: string) {
  const summary = file?.summary?.trim();
  if (summary) return summary;
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "来源内容解析完成后，会在这里显示这份资料的核心摘要。";
  return text.slice(0, 260) + (text.length > 260 ? "…" : "");
}

function splitPreviewLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, 80);
}

function renderSourceLine(line: string, key: string, highlight?: boolean) {
  const trimmed = line.trim();
  if (/^#{1,3}\s+/.test(trimmed)) {
    const level = trimmed.match(/^#+/)?.[0].length || 1;
    const text = trimmed.replace(/^#{1,3}\s+/, "");
    if (level === 1) return <h2 key={key} className={cn("mb-3 mt-6 text-[22px] font-semibold leading-tight tracking-[-0.03em] text-text-primary", highlight && "bg-brand/10 px-1 rounded")}>{text}</h2>;
    return <h3 key={key} className={cn("mb-2 mt-5 text-[17px] font-semibold leading-snug text-text-primary", highlight && "bg-brand/10 px-1 rounded")}>{text}</h3>;
  }
  if (/^[-*•]\s+/.test(trimmed)) {
    return <li key={key} className={cn("ml-5 list-disc text-[14px] leading-7 text-text-secondary", highlight && "bg-brand/10 px-1 rounded")}>{trimmed.replace(/^[-*•]\s+/, "")}</li>;
  }
  if (/^\d+[.)]\s+/.test(trimmed)) {
    return <p key={key} className={cn("mt-3 text-[15px] font-semibold leading-7 text-text-primary", highlight && "bg-brand/10 px-1 rounded")}>{trimmed}</p>;
  }
  return <p key={key} className={cn("mb-3 text-[14px] leading-7 text-text-secondary", highlight && "bg-brand/10 px-1 rounded")}>{trimmed}</p>;
}

export function NotebookSourcePreviewDrawer({ open, source, data, loading, error, target, onClose, onAddSource }: NotebookSourcePreviewDrawerProps) {
  const { t } = useI18n();
  const file = data?.file || source?.file || null;
  const content = data?.content || "";
  const sourceUrl = content.match(/https?:\/\/[^\s]+/)?.[0] || "";

  const targetChunk = useMemo(() => {
    if (!data?.chunks?.length || !target) return null;
    if (Number.isFinite(target.chunkIndex)) {
      const byIndex = data.chunks.find((chunk) => chunk.index === target.chunkIndex);
      if (byIndex) return byIndex;
    }
    const quote = target.quote?.trim().toLowerCase();
    if (quote) return data.chunks.find((chunk) => chunk.content.toLowerCase().includes(quote)) || null;
    if (Number.isFinite(target.page)) return data.chunks.find((chunk) => chunk.page === target.page) || null;
    return null;
  }, [data?.chunks, target]);

  useEffect(() => {
    if (!open || !targetChunk || loading) return;
    const timer = window.setTimeout(() => {
      document.getElementById(chunkAnchorId(targetChunk.index))?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [open, targetChunk, loading]);

  const guideTags = [
    file?.mime_type,
    file?.page_count ? `${file.page_count} 页` : null,
    file?.token_count ? `${file.token_count.toLocaleString()} tokens` : null,
    file?.size ? formatBytes(file.size) : null,
  ].filter(Boolean) as string[];



  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-[760px] flex-col overflow-hidden border-l border-surface-border bg-[#f8f9fb] shadow-2xl dark:bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-16 items-center justify-between border-b border-surface-border bg-[#f8f9fb] px-7 dark:bg-surface">
          <div className="text-[15px] font-semibold text-text-primary">来源</div>
          <div className="flex items-center gap-1.5">
            {onAddSource && (
              <button type="button" onClick={onAddSource} className="rounded-full p-2 text-text-secondary transition hover:bg-surface-hover hover:text-text-primary" title="添加来源">
                <Plus className="h-5 w-5" />
              </button>
            )}
            <button onClick={onClose} className="rounded-full p-2 text-text-secondary transition hover:bg-surface-hover hover:text-text-primary" aria-label={t("common.close") || "Close"}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-10 pt-6">
          <h1 className="mb-5 break-words text-[28px] font-semibold leading-tight tracking-[-0.04em] text-text-primary">
            {file?.filename || t("notebook.source")}
          </h1>

          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noreferrer" className="mb-4 inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-surface-border bg-white px-3 py-1.5 text-xs font-medium text-brand shadow-sm transition hover:bg-surface-hover dark:bg-surface-card">
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Open original source</span>
            </a>
          ) : null}

          <section className="mb-7 rounded-[22px] bg-[#edf2f8] px-5 py-4 shadow-sm dark:bg-surface-elevated">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-text-primary">
                <Sparkles className="h-4 w-4 text-text-secondary" />
                来源指南
              </div>
              <ChevronDown className="h-4 w-4 text-text-tertiary" />
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("notebook.previewLoading")}
              </div>
            ) : error ? (
              <p className="text-sm leading-6 text-red-600 dark:text-red-300">{error}</p>
            ) : (
              <>
                <p className="text-[14px] leading-7 text-text-secondary">
                  {plainSummary(file, content)}
                </p>
                {file?.error_message ? <p className="mt-3 text-sm leading-6 text-red-600 dark:text-red-300">{file.error_message}</p> : null}
                {guideTags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {guideTags.map((tag) => (
                      <span key={tag} className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-medium text-text-secondary shadow-sm dark:bg-surface-card">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {target ? (
                  <div className="mt-4 rounded-2xl bg-white/70 px-3 py-2 text-xs text-text-secondary dark:bg-surface-card">
                    引用定位：{Number.isFinite(target.page) && target.page ? `第 ${target.page} 页` : "当前匹配内容"}
                    {target.quote ? <span className="ml-2 text-text-tertiary">“{target.quote}”</span> : null}
                  </div>
                ) : null}
                {data?.has_more ? <p className="mt-3 text-xs text-text-tertiary">{t("notebook.previewTruncated")}</p> : null}
              </>
            )}
          </section>

          {loading ? null : error ? null : !data ? (
            <div className="rounded-2xl bg-white p-4 text-sm text-text-secondary shadow-sm dark:bg-surface-card">{t("notebook.previewEmpty")}</div>
          ) : (
            <article className="mx-auto max-w-none pb-8">
              {(() => {
                const raw = data.content || data.chunks?.map((c) => c.content).join("\n") || "";
                const lines = splitPreviewLines(raw);
                return lines.map((line, index) => renderSourceLine(line, `${index}-${line.slice(0, 12)}`));
              })()}
            </article>
          )}
        </div>
      </aside>
    </div>
  );
}
