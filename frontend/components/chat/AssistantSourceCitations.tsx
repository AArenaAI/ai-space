"use client";

import { useState } from "react";
import { ChevronDown, FileText, Globe2 } from "lucide-react";
import type { SearchSource } from "@/lib/chatTypes";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

type AssistantSourceCitationsProps = {
  sources?: SearchSource[];
};

function safeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isNotebookSource(source: SearchSource): boolean {
  return source.type === "notebook_file" || safeText(source.url).startsWith("notebook://");
}

function sourceLabel(source: SearchSource, t: (key: string, params?: Record<string, string>) => string): string {
  const parts: string[] = [];
  if (typeof source.page === "number" && source.page > 0) parts.push(t("chat.sources.page", { page: String(source.page) }));
  if (typeof source.slide === "number" && source.slide > 0) parts.push(t("chat.sources.slide", { slide: String(source.slide) }));
  if (source.sheet_name) parts.push(t("chat.sources.sheet", { sheet: String(source.sheet_name) }));
  if (parts.length > 0) return parts.join(" · ");
  return safeText(source.description) || (isNotebookSource(source) ? t("chat.sources.notebookSnippet") : t("chat.sources.webPage"));
}

export default function AssistantSourceCitations({ sources }: AssistantSourceCitationsProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const safeSources = (sources || [])
    .map((source) => ({
      ...source,
      title: safeText(source.title),
      description: safeText(source.description),
      url: safeText(source.url),
      snippet: safeText(source.snippet),
    }))
    .filter((source) => source.title || source.description || source.url || source.snippet)
    .slice(0, 6);

  if (safeSources.length === 0) return null;

  return (
    <div className="mt-3 w-full max-w-[min(620px,calc(100vw-6rem))] rounded-2xl border border-surface-border/70 bg-surface-elevated/55 p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-secondary">
        <FileText className="h-3.5 w-3.5" />
        {t("chat.sources.source")}
        <span className="text-text-tertiary">{safeSources.length}</span>
      </div>
      <div className="space-y-2">
        {safeSources.map((source, index) => {
          const notebook = isNotebookSource(source);
          const snippet = source.snippet || source.description;
          const isExpanded = Boolean(expanded[index]);
          const title = source.title || t("chat.sources.sourceWithIndex", { index: String(index + 1) });
          const content = (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                    notebook ? "bg-brand/10 text-brand" : "bg-blue-500/10 text-blue-600"
                  )}
                >
                  {index + 1}
                </span>
                <span className="truncate text-sm font-medium text-text-primary">{title}</span>
                {snippet && (
                  <ChevronDown
                    className={cn("ml-auto h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform", isExpanded && "rotate-180")}
                  />
                )}
              </div>
              <div className="mt-1 text-xs text-text-tertiary">{sourceLabel(source, t)}</div>
              {snippet && (
                <div className={cn("mt-1 text-xs leading-relaxed text-text-secondary", isExpanded ? "whitespace-pre-wrap" : "line-clamp-3")}>
                  “{snippet}”
                </div>
              )}
            </>
          );

          if (!notebook && source.url) {
            return (
              <a
                key={`${title}-${index}`}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl border border-surface-border/60 bg-surface-card/70 px-3 py-2 transition-colors hover:border-brand/30 hover:bg-surface-card"
              >
                <div className="flex items-start gap-2">
                  <Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
                  <div className="min-w-0 flex-1">{content}</div>
                </div>
              </a>
            );
          }

          return (
            <button
              key={`${title}-${index}`}
              type="button"
              onClick={() => snippet && setExpanded((prev) => ({ ...prev, [index]: !prev[index] }))}
              className="w-full rounded-xl border border-surface-border/60 bg-surface-card/70 px-3 py-2 text-left transition-colors hover:border-brand/30 hover:bg-surface-card"
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}
