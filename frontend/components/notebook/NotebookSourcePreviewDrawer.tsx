"use client";

import { useEffect, useMemo } from "react";
import { ChevronDown, ExternalLink, FileText, Loader2, Search, Sparkles, X } from "lucide-react";
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

function isWebSource(file: NotebookFile["file"] | null) {
  const mime = (file?.mime_type || "").toLowerCase();
  const filename = (file?.filename || "").toLowerCase();
  return mime.includes("uri-list") || mime.includes("html") || filename.startsWith("http") || filename.endsWith(".url");
}

function displaySourceTitle(filename?: string) {
  const name = (filename || "").trim();
  if (!name) return "";
  return name.replace(/\.url$/i, "");
}

function extractSourceUrl(content: string) {
  return content.split(/\n+/).map((line) => line.trim()).find((line) => /^https?:\/\//i.test(line)) || content.match(/https?:\/\/[^\s]+/)?.[0] || "";
}

function sourceHostname(rawUrl: string) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function webSourceBody(content: string, rawUrl: string) {
  let text = rawUrl ? content.replace(rawUrl, "") : content;
  text = text.replace(/^\s*来源[:：]\s*/m, "").trim();
  return normalizeWebSourceReadingText(text);
}

function normalizeWebSourceReadingText(text: string) {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return "";
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const hasStructure = lines.length >= 4 || /(^|\n)#{1,3}\s/.test(normalized) || /(^|\n)[-*•]\s/.test(normalized);
  if (hasStructure) {
    return lines
      .filter((line) => !isWebChromeLine(line))
      .join("\n\n");
  }

  let compact = normalized.replace(/\s+/g, " ");
  const headingPhrases = [
    "创建新笔记",
    "撰写新笔记",
    "将对话回答保存到笔记",
    "将笔记转换为来源",
    "使用快速操作转换所选笔记",
    "将笔记导出为 Google 文档或 Google 表格",
    "添加来源",
    "相关资源",
  ];
  for (const phrase of headingPhrases) {
    compact = compact.replace(new RegExp(`\\s*${escapeRegExp(phrase)}\\s*`, "g"), `\n\n## ${phrase}\n\n`);
  }
  compact = compact
    .replace(/\s+(重要提示[:：])/g, "\n\n$1")
    .replace(/\s+(提示[:：])/g, "\n\n$1")
    .replace(/\s+(了解 NotebookLM\s+\d+\s*\/\s*\d+)/g, "\n\n$1")
    .replace(/([。！？!?])\s+(?=[\u4e00-\u9fa5A-Z])/g, "$1\n\n")
    .replace(/\s+(\d+[.)、]\s*)/g, "\n$1");

  return compact
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !isWebChromeLine(line))
    .join("\n\n");
}

function isWebChromeLine(line: string) {
  const text = line.replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (text.length > 180 && /跳到主要内容|Google 帮助|帮助中心|隐私权政策|服务条款|提交反馈/.test(text)) return true;
  return /^(跳到主要内容|Google 帮助|帮助中心|隐私权政策|服务条款|提交反馈|登录|菜单)$/.test(text);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function chunkAnchorId(index: number) {
  return `notebook-source-chunk-${index}`;
}

function plainSummary(file: NotebookFile["file"] | null, content: string, t: (key: string) => string) {
  const summary = file?.summary?.trim();
  if (summary) return summary;
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return t("notebook.sourceGuide");
  return text.slice(0, 260) + (text.length > 260 ? "…" : "");
}

/** Split text into paragraphs by blank lines, preserving inner structure */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function isTableParagraph(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  return lines.length >= 2 && lines.every((l) => l.trim().startsWith("|"));
}

function isUnorderedList(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  return lines.length > 0 && lines.every((l) => /^[-*•]\s/.test(l.trim()));
}

function isOrderedList(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  return lines.length > 0 && lines.every((l) => /^\d+[.)]\s/.test(l.trim()));
}

function renderParagraph(text: string, key: string) {
  // Table: keep raw text with monospace formatting
  if (isTableParagraph(text)) {
    return (
      <div key={key} className="my-4 overflow-x-auto rounded-xl border border-surface-border bg-white p-4 shadow-sm dark:bg-surface-card">
        <pre className="text-[13px] leading-6 text-text-secondary whitespace-pre">{text}</pre>
      </div>
    );
  }

  // Heading
  if (/^#{1,3}\s/.test(text)) {
    const level = text.match(/^#+/)?.[0].length || 1;
    const headingText = text.replace(/^#{1,3}\s+/, "").replace(/\n/g, " ");
    if (level === 1) {
      return <h2 key={key} className="mb-3 mt-6 text-[22px] font-semibold leading-tight tracking-[-0.03em] text-text-primary">{headingText}</h2>;
    }
    return <h3 key={key} className="mb-2 mt-5 text-[17px] font-semibold leading-snug text-text-primary">{headingText}</h3>;
  }

  // Unordered list
  if (isUnorderedList(text)) {
    const items = text.split("\n").filter((l) => l.trim().length > 0);
    return (
      <ul key={key} className="my-3 ml-5 list-disc space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-[14px] leading-7 text-text-secondary">{item.trim().replace(/^[-*•]\s+/, "")}</li>
        ))}
      </ul>
    );
  }

  // Ordered list
  if (isOrderedList(text)) {
    const items = text.split("\n").filter((l) => l.trim().length > 0);
    return (
      <ol key={key} className="my-3 ml-5 list-decimal space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-[14px] leading-7 text-text-secondary">{item.trim().replace(/^\d+[.)]\s+/, "")}</li>
        ))}
      </ol>
    );
  }

  // Normal paragraph: merge soft line breaks into a single paragraph
  const paragraph = text.replace(/\n\s*/g, " ");
  return <p key={key} className="mb-3 text-[14px] leading-7 text-text-secondary">{paragraph}</p>;
}

export function NotebookSourcePreviewDrawer({ open, source, data, loading, error, target, onClose, onAddSource }: NotebookSourcePreviewDrawerProps) {
  const { t } = useI18n();
  const file = data?.file || source?.file || null;
  const content = data?.content || "";
  const webSource = isWebSource(file);
  const sourceUrl = extractSourceUrl(content);
  const hostname = sourceHostname(sourceUrl);
  const previewTitle = displaySourceTitle(file?.filename) || t("notebook.source");
  const previewContent = webSource ? webSourceBody(content, sourceUrl) : content;

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
    file?.page_count ? t("notebook.pageCount", { count: String(file.page_count) }) : null,
    file?.token_count ? `${file.token_count.toLocaleString()} tokens` : null,
    file?.size ? formatBytes(file.size) : null,
  ].filter(Boolean) as string[];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-[760px] flex-col overflow-hidden border-l border-surface-border bg-surface shadow-2xl dark:bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-16 items-center justify-between border-b border-surface-border bg-surface px-7 dark:bg-surface">
          <div className="text-[15px] font-semibold text-text-primary">{t("notebook.source")}</div>
          <div className="flex items-center gap-1.5">
            <button onClick={onClose} className="rounded-full p-2 text-text-secondary transition hover:bg-surface-hover hover:text-text-primary" aria-label={t("common.close") || "Close"}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-10 pt-6">
          <h1 className="mb-5 break-words text-[28px] font-semibold leading-tight tracking-[-0.04em] text-text-primary">
            {previewTitle}
          </h1>

          {webSource && sourceUrl ? (
            <section className="mb-5 overflow-hidden rounded-[22px] border border-surface-border bg-surface-card shadow-sm">
              <div className="flex items-start gap-3 border-b border-surface-border bg-surface-elevated/70 px-5 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-500 text-xs font-bold text-white shadow-sm">WEB</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-text-primary">{hostname || t("notebook.website")}</div>
                  <a href={sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1.5 text-xs font-medium text-brand hover:underline">
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{sourceUrl}</span>
                  </a>
                </div>
              </div>
              <div className="px-5 py-3 text-xs leading-5 text-text-tertiary">
                {t("notebook.webSourceCaptured")}
              </div>
            </section>
          ) : sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noreferrer" className="mb-4 inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-surface-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-brand shadow-sm transition hover:bg-surface-hover dark:bg-surface-card">
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Open original source</span>
            </a>
          ) : null}

          <section className="mb-7 rounded-[22px] bg-surface-hover px-5 py-4 shadow-sm dark:bg-surface-elevated">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-text-primary">
                <Sparkles className="h-4 w-4 text-text-secondary" />
                {t("notebook.sourceGuide")}
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
                  {plainSummary(file, previewContent, t)}
                </p>
                {file?.error_message ? <p className="mt-3 text-sm leading-6 text-red-600 dark:text-red-300">{file.error_message}</p> : null}
                {guideTags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {guideTags.map((tag) => (
                      <span key={tag} className="rounded-full bg-surface-elevated/80 px-3 py-1.5 text-xs font-medium text-text-secondary shadow-sm dark:bg-surface-card">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {target ? (
                <div className="mt-4 rounded-2xl bg-surface-elevated/70 px-3 py-2 text-xs text-text-secondary dark:bg-surface-card">
                {t("notebook.quoteLocation")}: {Number.isFinite(target.page) && target.page ? t("notebook.pageLabel", { page: String(target.page) }) : t("notebook.currentMatch")}
                {target.quote ? <span className="ml-2 text-text-tertiary">"{target.quote}"</span> : null}
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
                const raw = previewContent || data.chunks?.map((c) => c.content).join("\n\n") || "";
                const paragraphs = splitParagraphs(raw);
                return paragraphs.map((para, index) => renderParagraph(para, `${index}-${para.slice(0, 12)}`));
              })()}
            </article>
          )}
        </div>
      </aside>
    </div>
  );
}
