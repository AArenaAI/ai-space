"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, BookOpen, FileText, Globe, Loader2, MoreVertical, Plus, Search, Zap, AlertCircle, CheckCircle2, Clock3, Check, ImageIcon, Upload, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import ChatInterface from "@/components/chat/ChatInterface";
import { NotebookSourcePreviewDrawer } from "@/components/notebook/NotebookSourcePreviewDrawer";
import { NotebookStudioPanel, type NotebookStudioActionId, type NotebookStudioArtifact, type NotebookStudioFlashcard, type NotebookStudioQuizQuestion, type NotebookStudioMindmapEdge, type NotebookStudioMindmapNode, type NotebookStudioReportSection, type NotebookStudioReportTable, type NotebookStudioSource, type NotebookStudioTableRow, type NotebookStudioTextSection } from "@/components/notebook/NotebookStudioPanel";
import { NotebookUrlSourceDialog } from "@/components/notebook/NotebookUrlSourceDialog";
import { MODELS } from "@/hooks/useChat";
import { addNotebookFile, addNotebookUrlSource, deleteNotebookArtifact, fetchNotebook, fetchNotebookArtifacts, fetchNotebookFileContent, generateNotebookArtifact, removeNotebookFile, suggestNotebookReportFormats, updateNotebook, updateNotebookArtifact, updateNotebookFile, type NotebookReportFormatSuggestion } from "@/lib/notebookApi";
import { normalizeNotebookError, showNotebookError, uploadNotebookSourceFile } from "@/lib/notebookErrors";
import type { Notebook, NotebookArtifact as PersistedNotebookArtifact, NotebookFile, NotebookFileContent } from "@/lib/notebookTypes";
import { useI18n, type LanguageCode } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function currentWorkspaceId(): string | null {
  return localStorage.getItem("current-workspace");
}

function formatSize(bytes?: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function notebookSelectionStorageKey(notebookId: number) {
  return `notebook:${notebookId}:selected-file-ids`;
}

function notebookAutoSummaryStorageKey(notebookId: number, fileId: number) {
  return `notebook:${notebookId}:auto-summary-file:${fileId}`;
}

const NOTEBOOK_COVER_PRESETS = [
  { id: "book-open", icon: "🚀", className: "bg-gradient-to-br from-violet-100 via-indigo-50 to-slate-100 text-slate-950" },
  { id: "aurora", icon: "✨", className: "bg-gradient-to-br from-cyan-100 via-sky-100 to-indigo-100 text-slate-950" },
  { id: "sunset", icon: "🌅", className: "bg-gradient-to-br from-amber-100 via-orange-100 to-rose-100 text-slate-950" },
  { id: "forest", icon: "🌿", className: "bg-gradient-to-br from-emerald-100 via-teal-100 to-lime-100 text-slate-950" },
  { id: "ink", icon: "📘", className: "bg-gradient-to-br from-slate-800 via-indigo-900 to-violet-900 text-white" },
];

function notebookCoverPreset(coverIcon?: string) {
  return NOTEBOOK_COVER_PRESETS.find((preset) => preset.id === coverIcon) || NOTEBOOK_COVER_PRESETS[0];
}

function stripFileExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

function buildAutoNotebookTitle(file?: NotebookFile) {
  if (!file?.file?.filename) return "未命名笔记本";
  return stripFileExtension(file.file.filename).slice(0, 90) || file.file.filename;
}

function buildNotebookAutoSummaryPrompt(file: NotebookFile, title: string) {
  return [
    `请根据我刚导入的第一个资料《${file.file.filename}》自动生成一份笔记本分析摘要。`,
    "要求：",
    `1. 用“${title}”作为摘要的大标题，不要说你正在生成摘要。`,
    "2. 先用一段 120-180 字概括资料核心内容、对象、用途和关键结论。",
    "3. 再给出 3 个可继续追问的问题，问题要具体、贴合资料内容。",
    "4. 如果资料解析尚未完成，就基于当前可用信息先给出简短摘要，并提示稍后可继续追问。",
  ].join("\n");
}

function readStoredSelectedFileIds(notebookId: number) {
  try {
    const raw = localStorage.getItem(notebookSelectionStorageKey(notebookId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === "number") : null;
  } catch {
    return null;
  }
}

function reconcileSelectedFileIds(previous: number[], files: NotebookFile[]) {
  const available = new Set(files.map((file) => file.file_id));
  return previous.filter((id) => available.has(id));
}

function saveNotebookUploadedCover(dataUrl: string) {
  const key = `uploaded:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    localStorage.setItem(`notebook-cover:${key}`, dataUrl);
  } catch {
    toast.error("底图过大，无法保存到本地浏览器");
  }
  return key;
}

function readNotebookUploadedCover(key: string) {
  if (!key.startsWith("uploaded:")) return "";
  try {
    return localStorage.getItem(`notebook-cover:${key}`) || "";
  } catch {
    return "";
  }
}

function SourcePdfIcon() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] bg-red-500 text-[8px] font-bold leading-none tracking-[-0.02em] text-white shadow-sm">
      PDF
    </span>
  );
}

type Translate = (key: string, params?: Record<string, string>) => string;

function isNotebookFileReady(file: NotebookFile) {
  const parse = file.file.parse_status;
  const embed = file.file.embedding_status;
  return parse === "done" && (embed === "done" || embed === "skipped");
}

function isNotebookFileProcessing(file: NotebookFile) {
  const parse = file.file.parse_status;
  const embed = file.file.embedding_status;
  if (parse === "error" || parse === "unsupported" || embed === "error") return false;
  return !isNotebookFileReady(file);
}

function statusMeta(file: NotebookFile, t: Translate) {
  const parse = file.file.parse_status;
  const embed = file.file.embedding_status;
  if (parse === "error") return { label: t("notebook.statusParseFailed"), icon: AlertCircle, className: "text-red-500 bg-red-500/10 border-red-500/20" };
  if (parse === "unsupported") return { label: t("notebook.statusUnsupported"), icon: AlertCircle, className: "text-text-tertiary bg-surface-hover border-surface-border" };
  if (parse === "done" && embed === "error") return { label: t("notebook.statusIndexFailed"), icon: AlertCircle, className: "text-amber-600 bg-amber-500/10 border-amber-500/20 dark:text-amber-300" };
  if (isNotebookFileReady(file)) return { label: t("notebook.statusReady"), icon: CheckCircle2, className: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" };
  if (parse === "done") return { label: t("notebook.statusIndexing"), icon: Clock3, className: "text-amber-500 bg-amber-500/10 border-amber-500/20" };
  return { label: t("notebook.statusProcessing"), icon: Clock3, className: "text-amber-500 bg-amber-500/10 border-amber-500/20" };
}

function statusDetail(file: NotebookFile, t: Translate) {
  const parse = file.file.parse_status;
  const embed = file.file.embedding_status;
  if (parse === "error") return file.file.error_message || t("notebook.parseFailureHint");
  if (parse === "done" && embed === "error") return t("notebook.indexFailureHint");
  return null;
}

function normalizeFlashcardArtifactTitle(title: string) {
  const trimmed = title.trim();
  if (trimmed === "摘要") return "闪卡";
  return trimmed.replace(/([·•]\s*)摘要$/, "$1闪卡");
}

function toStudioArtifact(artifact: PersistedNotebookArtifact): NotebookStudioArtifact | null {
  const content = artifact.content as { rows?: NotebookStudioTableRow[]; sections?: NotebookStudioTextSection[] | NotebookStudioReportSection[]; nodes?: NotebookStudioMindmapNode[]; edges?: NotebookStudioMindmapEdge[]; cards?: NotebookStudioFlashcard[]; questions?: NotebookStudioQuizQuestion[]; format_id?: string; format_title?: string; executive_summary?: string; tables?: NotebookStudioReportTable[]; orientation?: string; style?: string; detail_level?: string; prompt?: string; image_url?: string; color_scheme?: Record<string, string> } | null;
  const base = {
    id: String(artifact.id),
    title: artifact.type === "flashcards" ? normalizeFlashcardArtifactTitle(artifact.title) : artifact.title,
    subtitle: artifact.subtitle || "",
    createdAt: artifact.created_at,
    sourceCount: artifact.source_count || 0,
  };
  if (artifact.type === "data-table") {
    return { ...base, type: "table", rows: Array.isArray(content?.rows) ? content.rows : [] };
  }
  if (artifact.type === "summary" || artifact.type === "faq" || artifact.type === "briefing") {
    return { ...base, type: artifact.type, sections: Array.isArray(content?.sections) ? content.sections : [] };
  }
  if (artifact.type === "mindmap") {
    return {
      ...base,
      type: "mindmap",
      nodes: Array.isArray(content?.nodes) ? content.nodes : [],
      edges: Array.isArray(content?.edges) ? content.edges : [],
    };
  }
  if (artifact.type === "flashcards") {
    return { ...base, type: "flashcards", cards: Array.isArray(content?.cards) ? content.cards : [] };
  }
  if (artifact.type === "quiz") {
    return { ...base, type: "quiz", questions: Array.isArray(content?.questions) ? content.questions : [] };
  }
  if (artifact.type === "report") {
    return {
      ...base,
      type: "report",
      formatId: typeof content?.format_id === "string" ? content.format_id : "briefing-document",
      formatTitle: typeof content?.format_title === "string" ? content.format_title : "Report",
      executiveSummary: typeof content?.executive_summary === "string" ? content.executive_summary : "",
      sections: Array.isArray(content?.sections) ? content.sections as NotebookStudioReportSection[] : [],
      tables: Array.isArray(content?.tables) ? content.tables : [],
    };
  }
  if (artifact.type === "infographic") {
    return {
      ...base,
      type: "infographic",
      orientation: typeof content?.orientation === "string" ? content.orientation : "landscape",
      style: typeof content?.style === "string" ? content.style : "auto",
      detail_level: typeof content?.detail_level === "string" ? content.detail_level : "standard",
      prompt: typeof content?.prompt === "string" ? content.prompt : "",
      image_url: typeof content?.image_url === "string" ? content.image_url : "",
      color_scheme: typeof content?.color_scheme === "object" && content?.color_scheme ? content.color_scheme : undefined,
    };
  }
  return null;
}

function safeFilename(value: string) {
  return (value || "notebook-output").replace(/[\\/:*?\"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "notebook-output";
}

function artifactToMarkdown(artifact: NotebookStudioArtifact) {
  const lines = [`# ${artifact.title}`, "", artifact.subtitle, ""].filter((line) => line !== undefined);
  switch (artifact.type) {
    case "table":
      lines.push("| 功能模块 / 来源 | 具体能力 / 内容摘要 | 状态 | 核心技术 / 处理方式 | 业务价值 | 来源 |");
      lines.push("| --- | --- | --- | --- | --- | --- |");
      artifact.rows.forEach((row) => {
        lines.push(`| ${row.module} | ${row.capability} | ${row.status} | ${row.implementation} | ${row.value} | ${row.source} |`);
      });
      break;
    case "mindmap":
      lines.push("## 节点", "");
      artifact.nodes.forEach((node) => {
        lines.push(`- ${node.label}${node.source ? ` ${node.source}` : ""}${node.summary ? `：${node.summary}` : ""}`);
      });
      if (artifact.edges.length) {
        lines.push("", "## 关系", "");
        artifact.edges.forEach((edge) => lines.push(`- ${edge.from} → ${edge.to}${edge.label ? `：${edge.label}` : ""}`));
      }
      break;
    case "flashcards":
      artifact.cards.forEach((card, index) => {
        lines.push(`## ${index + 1}. ${card.front}`, "", card.back);
        if (card.source) lines.push("", card.source);
        lines.push("");
      });
      break;
    case "quiz":
      artifact.questions.forEach((question, index) => {
        lines.push(`## ${index + 1}. ${question.question}`, "");
        question.options.forEach((option) => lines.push(`- ${option.id}. ${option.text}`));
        lines.push("", `正确答案：${question.correct_option_id}`, question.explanation, "");
      });
      break;
    case "report":
      lines.push(`_Format: ${artifact.formatTitle}_`, "", "## Executive Summary", "", artifact.executiveSummary, "");
      artifact.sections.forEach((section) => {
        lines.push(`## ${section.number ? `${section.number}. ` : ""}${section.heading}`);
        if (section.body) lines.push("", section.body);
        if (section.bullets?.length) {
          lines.push("");
          section.bullets.forEach((bullet) => lines.push(`- ${bullet}`));
        }
        lines.push("");
      });
      artifact.tables.forEach((table) => {
        lines.push(`## ${table.title}`, "");
        if (table.headers.length) {
          lines.push(`| ${table.headers.join(" | ")} |`);
          lines.push(`| ${table.headers.map(() => "---").join(" | ")} |`);
          table.rows.forEach((row) => lines.push(`| ${row.join(" | ")} |`));
          lines.push("");
        }
      });
      break;
    case "summary":
    case "faq":
    case "briefing":
      artifact.sections.forEach((section) => {
        lines.push(`## ${section.heading}`);
        if (section.body) lines.push("", section.body);
        if (section.bullets?.length) {
          lines.push("");
          section.bullets.forEach((bullet) => lines.push(`- ${bullet}`));
        }
        lines.push("");
      });
      break;
    case "infographic":
      lines.push("## Infographic", "", `- Orientation: ${artifact.orientation}`, `- Style: ${artifact.style}`, `- Detail level: ${artifact.detail_level}`, "");
      if (artifact.prompt) lines.push("## Custom prompt", "", artifact.prompt, "");
      if (artifact.image_url) lines.push("## Image", "", artifact.image_url, "");
      break;
  }
  return lines.join("\n").trim() + "\n";
}

function artifactToCsv(artifact: NotebookStudioArtifact) {
  if (artifact.type !== "table") return artifactToMarkdown(artifact);
  const escape = (value: string) => `"${String(value || "").replace(/"/g, '""')}"`;
  const rows = [
    ["功能模块 / 来源", "具体能力 / 内容摘要", "状态", "核心技术 / 处理方式", "业务价值", "来源"],
    ...artifact.rows.map((row) => [row.module, row.capability, row.status, row.implementation, row.value, row.source]),
  ];
  return rows.map((row) => row.map(escape).join(",")).join("\n") + "\n";
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const FIXED_REPORT_FORMATS: NotebookReportFormatSuggestion[] = [
  { id: "custom", title: "自制格式", description: "从空白结构开始，适合自由定义报告章节和语气。" },
  { id: "briefing-document", title: "简报文档", description: "执行摘要、章节编号、表格和要点，适合正式汇报。" },
  { id: "study-guide", title: "学习指南", description: "把资料转成便于复习的概念、问题和知识点结构。" },
  { id: "blog-post", title: "博文", description: "改写成面向读者的文章、观点和传播型内容。" },
];

function ReportFormatDialog({
  open,
  selectedId,
  suggestions,
  loadingSuggestions,
  generating,
  onSelect,
  onClose,
  onGenerate,
  t,
}: {
  open: boolean;
  selectedId: string;
  suggestions: NotebookReportFormatSuggestion[];
  loadingSuggestions: boolean;
  generating: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  onGenerate: () => void;
  t: Translate;
}) {
  if (!open) return null;
  const renderOption = (format: NotebookReportFormatSuggestion, recommended = false) => {
    const selected = selectedId === format.id;
    return (
      <button
        key={format.id}
        type="button"
        onClick={() => onSelect(format.id)}
        className={cn(
          "group flex min-h-[116px] w-full flex-col justify-between rounded-xl border px-4 py-4 text-left transition duration-150",
          selected
            ? "border-brand bg-brand-muted/40 shadow-sm ring-1 ring-brand/20"
            : "border-transparent bg-surface-elevated hover:border-surface-border hover:bg-surface-hover"
        )}
      >
        <span className="block">
          <span className="flex items-start justify-between gap-3">
            <span className="text-sm font-semibold leading-5 text-text-primary">{format.title}</span>
            <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition", selected ? "border-brand bg-brand text-white" : "border-surface-border bg-surface-card text-transparent group-hover:border-brand")}>{selected && <Check className="h-3.5 w-3.5" />}</span>
          </span>
          <span className="mt-2 block text-xs leading-5 text-text-tertiary">{format.description}</span>
        </span>
        {recommended && <span className="mt-3 inline-flex w-fit rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300">{t("notebook.studio.reportSuggestedBadge")}</span>}
      </button>
    );
  };
  const renderSuggestionBody = () => {
    if (loadingSuggestions) {
      return Array.from({ length: 4 }).map((_, index) => (
        <div key={`suggestion-loading-${index}`} className="min-h-[116px] rounded-xl bg-surface-elevated px-4 py-4">
          <div className="h-4 w-24 animate-pulse rounded bg-surface-hover" />
          <div className="mt-4 space-y-2">
            <div className="h-3 w-full animate-pulse rounded bg-surface-hover" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-surface-hover" />
          </div>
        </div>
      ));
    }
    if (suggestions.length > 0) {
      return suggestions.slice(0, 4).map((format) => renderOption(format, true));
    }
    return (
      <div className="col-span-full rounded-xl border border-dashed border-surface-border bg-surface-elevated px-4 py-5 text-sm text-text-tertiary">
        {t("notebook.studio.reportSuggestionEmpty")}
      </div>
    );
  };
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex max-h-[88vh] w-[min(1040px,94vw)] flex-col overflow-hidden rounded-[22px] border border-surface-border bg-surface-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-elevated text-text-secondary">
              <FileText className="h-5 w-5" />
            </span>
            <h3 className="text-xl font-semibold tracking-[-0.02em] text-text-primary">{t("notebook.studio.reportDialogTitle")}</h3>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-elevated text-lg leading-none text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary" aria-label="Close">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <section>
            <h4 className="mb-3 text-sm font-semibold text-text-primary">{t("notebook.studio.reportFixedFormats")}</h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{FIXED_REPORT_FORMATS.map((format) => renderOption(format))}</div>
          </section>
          <section className="mt-7">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-text-primary">✨ {t("notebook.studio.reportSuggestedFormats")}</h4>
              {loadingSuggestions && <span className="inline-flex items-center gap-1.5 text-xs text-text-tertiary"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("notebook.studio.reportAnalyzing")}</span>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{renderSuggestionBody()}</div>
          </section>
        </div>
        <div className="flex items-center justify-between border-t border-surface-border px-6 py-4">
          <div className="text-xs text-text-tertiary">{t("notebook.studio.reportSelectedHint")}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-hover">{t("common.cancel")}</button>
            <button type="button" onClick={onGenerate} disabled={generating} className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-70">
              {generating && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("notebook.studio.createReport")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmRemoveSourceDialog({
  open,
  source,
  removing,
  onClose,
  onConfirm,
}: {
  open: boolean;
  source: NotebookFile | null;
  removing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open || !source) return null;
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-[min(420px,94vw)] rounded-[24px] border border-surface-border bg-surface-card p-6 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
            <Trash2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-text-primary">移除来源？</h3>
            <p className="mt-1 text-sm leading-6 text-text-secondary">确定要移除“{source.file.filename}”吗？移除后它将不再参与这个笔记本的回答。</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={removing} className="rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-hover disabled:opacity-60">取消</button>
          <button type="button" onClick={onConfirm} disabled={removing} className="inline-flex items-center gap-2 rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-60">
            {removing && <Loader2 className="h-4 w-4 animate-spin" />}
            移除来源
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameSourceDialog({
  open,
  source,
  value,
  saving,
  onChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  source: NotebookFile | null;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open || !source) return null;
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-[min(460px,94vw)] rounded-[24px] border border-surface-border bg-surface-card p-6 shadow-2xl">
        <div className="mb-5 flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Pencil className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-text-primary">重命名来源</h3>
            <p className="mt-1 text-sm leading-6 text-text-secondary">修改这个来源在笔记本中的显示名称。</p>
          </div>
        </div>
        <label className="mb-2 block text-sm font-semibold text-text-primary">来源名称</label>
        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && value.trim()) onConfirm(); }}
          className="mb-5 h-11 w-full rounded-xl border border-surface-border bg-surface-elevated px-3 text-sm text-text-primary outline-none transition focus:border-brand focus:bg-surface-card"
          placeholder="输入来源名称"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-hover disabled:opacity-60">取消</button>
          <button type="button" onClick={onConfirm} disabled={saving || !value.trim()} className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            确认修改
          </button>
        </div>
      </div>
    </div>
  );
}

function NotebookCustomizeDialog({
  open,
  notebook,
  coverIcon,
  saving,
  onCoverChange,
  onClose,
  onSave,
}: {
  open: boolean;
  notebook: Notebook | null;
  coverIcon: string;
  saving: boolean;
  onCoverChange: (coverIcon: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  if (!open || !notebook) return null;
  const activePreset = notebookCoverPreset(coverIcon);
  const uploadedImage = coverIcon.startsWith("uploaded:") ? readNotebookUploadedCover(coverIcon) : "";
  const handleUpload = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) return;
      const key = saveNotebookUploadedCover(dataUrl);
      onCoverChange(key);
    };
    reader.onerror = () => toast.error("底图读取失败");
    reader.readAsDataURL(file);
  };
  return (
    <div className="fixed inset-0 z-[135] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex max-h-[88vh] w-[min(640px,94vw)] flex-col overflow-hidden rounded-[26px] border border-surface-border bg-surface-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <h3 className="text-lg font-semibold leading-7 tracking-[-0.02em] text-text-primary">更换笔记本底图</h3>
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-lg leading-none text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary" aria-label="Close">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
          <div className={cn("relative mb-5 flex h-40 items-center justify-center overflow-hidden rounded-[22px]", uploadedImage ? "bg-slate-900" : activePreset.className)}>
            {uploadedImage ? (
              <img src={uploadedImage} alt="笔记本底图预览" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <>
                <div className="pointer-events-none absolute -right-8 -bottom-16 text-[150px] font-black leading-none text-white/35 opacity-80">M</div>
                <div className="relative z-10 text-[46px] leading-none">{activePreset.icon}</div>
              </>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => handleUpload(event.target.files?.[0])}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="absolute right-4 top-4 inline-flex h-8 items-center gap-1.5 rounded-full bg-white/90 px-3 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-black/5 transition hover:bg-white">
              <Upload className="h-3.5 w-3.5" />上传
            </button>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary"><ImageIcon className="h-4 w-4 text-text-tertiary" />更换底图</div>
            <div className="grid grid-cols-5 gap-2">
              {NOTEBOOK_COVER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onCoverChange(preset.id)}
                  className={cn("flex h-16 items-center justify-center rounded-2xl border text-2xl transition", preset.className, coverIcon === preset.id ? "border-brand ring-2 ring-brand/25" : "border-surface-border hover:border-brand/50")}
                  aria-label={preset.id}
                >
                  {preset.icon}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-surface-border px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-hover">取消</button>
          <button type="button" onClick={onSave} disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function NotebookDetailContent() {
  const { t, language } = useI18n();
  const searchParams = useSearchParams();
  const notebookId = Number(searchParams.get("notebook_id") || searchParams.get("id"));
  const conversationId = searchParams.get("conversation_id") ? Number(searchParams.get("conversation_id")) : undefined;
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [files, setFiles] = useState<NotebookFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [addingUrl, setAddingUrl] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [sourcesWidth, setSourcesWidth] = useState(340);
  const [studioWidth, setStudioWidth] = useState(390);
  const [previewSource, setPreviewSource] = useState<NotebookFile | null>(null);
  const [previewData, setPreviewData] = useState<NotebookFileContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [studioArtifacts, setStudioArtifacts] = useState<NotebookStudioArtifact[]>([]);
  const [activeStudioArtifactId, setActiveStudioArtifactId] = useState<string | null>(null);
  const [generatingStudioType, setGeneratingStudioType] = useState<NotebookStudioActionId | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [selectedReportFormatId, setSelectedReportFormatId] = useState("briefing-document");
  const [reportFormatSuggestions, setReportFormatSuggestions] = useState<NotebookReportFormatSuggestion[]>([]);
  const [loadingReportSuggestions, setLoadingReportSuggestions] = useState(false);
  const [externalChatSendRequest, setExternalChatSendRequest] = useState<{ id: number; content: string; hidden?: boolean } | null>(null);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  const [customCoverIcon, setCustomCoverIcon] = useState("book-open");
  const [savingNotebookCustom, setSavingNotebookCustom] = useState(false);
  const [sourceMenuFileId, setSourceMenuFileId] = useState<number | null>(null);
  const [sourceToRemove, setSourceToRemove] = useState<NotebookFile | null>(null);
  const [removingSource, setRemovingSource] = useState(false);
  const [sourceToRename, setSourceToRename] = useState<NotebookFile | null>(null);
  const [sourceRenameValue, setSourceRenameValue] = useState("");
  const [renamingSource, setRenamingSource] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectionInitializedRef = useRef(false);
  const loadStudioArtifacts = async () => {
    if (!notebookId) return;
    try {
      const persisted = await fetchNotebookArtifacts(notebookId);
      const next = persisted.map(toStudioArtifact).filter((item): item is NotebookStudioArtifact => Boolean(item));
      setStudioArtifacts(next);
      setActiveStudioArtifactId((prev) => (prev && next.some((item) => item.id === prev) ? prev : null));
    } catch (error) {
      showNotebookError(error, t("notebook.studio.loadFailed"));
    }
  };

  const load = async () => {
    if (!notebookId) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await fetchNotebook(notebookId);
      setNotebook(data.notebook);
      const nextFiles = data.files || [];
      setFiles(nextFiles);
      setSelectedFileIds((prev) => {
        const baseline = selectionInitializedRef.current ? prev : (readStoredSelectedFileIds(notebookId) || []);
        selectionInitializedRef.current = true;
        return reconcileSelectedFileIds(baseline, nextFiles);
      });
      setPageError(null);
    } catch (error) {
      const normalized = showNotebookError(error, t("notebook.loadFailed"));
      setPageError(normalized.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    selectionInitializedRef.current = false;
    setSelectedFileIds([]);
    load();
    loadStudioArtifacts();
  }, [notebookId]);

  useEffect(() => {
    if (!notebookId || !selectionInitializedRef.current) return;
    localStorage.setItem(notebookSelectionStorageKey(notebookId), JSON.stringify(selectedFileIds));
  }, [notebookId, selectedFileIds]);

  useEffect(() => {
    if (!notebook) return;
    setCustomCoverIcon(notebook.cover_icon || "book-open");
  }, [notebook?.id, notebook?.cover_icon]);

  useEffect(() => {
    if (!notebookId || !notebook || files.length !== 1) return;
    const firstFile = files[0];
    if (!firstFile || !isNotebookFileReady(firstFile)) return;
    const storageKey = notebookAutoSummaryStorageKey(notebookId, firstFile.file_id);
    if (localStorage.getItem(storageKey) === "done") return;
    localStorage.setItem(storageKey, "done");
    const autoTitle = buildAutoNotebookTitle(firstFile);
    if (!notebook.title || notebook.title === "未命名笔记本") {
      updateNotebook(notebookId, { title: autoTitle }).then((updated) => {
        setNotebook(updated);
      }).catch((error) => {
        showNotebookError(error, "自动更新笔记本标题失败");
      });
    }
    setSelectedFileIds([firstFile.file_id]);
    setExternalChatSendRequest({
      id: Date.now(),
      content: buildNotebookAutoSummaryPrompt(firstFile, autoTitle),
      hidden: true,
    });
  }, [notebookId, notebook, files]);

  const readyCount = useMemo(() => files.filter(isNotebookFileReady).length, [files]);

  const firstFile = files[0];
  const heroTitle = notebook?.title && notebook.title !== "未命名笔记本" ? notebook.title : buildAutoNotebookTitle(firstFile);
  const heroCoverIcon = notebook?.cover_icon || "book-open";
  const heroCover = notebookCoverPreset(heroCoverIcon);
  const heroCoverImageUrl = heroCoverIcon.startsWith("uploaded:") ? readNotebookUploadedCover(heroCoverIcon) : "";

  const studioSourceFiles = useMemo<NotebookStudioSource[]>(() => files.map((file) => ({
    id: file.file_id,
    filename: file.file.filename,
    mimeType: file.file.mime_type,
  })), [files]);

  const hasProcessingFiles = useMemo(() => files.some(isNotebookFileProcessing), [files]);

  const allSourcesSelected = useMemo(() => (
    files.length > 0 && files.every((file) => selectedFileIds.includes(file.file_id))
  ), [files, selectedFileIds]);

  const startPaneResize = (pane: "sources" | "studio", event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startSourcesWidth = sourcesWidth;
    const startStudioWidth = studioWidth;
    const containerWidth = layoutRef.current?.clientWidth || window.innerWidth;
    const minSourcesWidth = 260;
    const maxSourcesWidth = 560;
    const minStudioWidth = 300;
    const maxStudioWidth = 760;
    const minCenterWidth = 420;
    const handleSpace = 16;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      if (pane === "sources") {
        const maxByCenter = containerWidth - startStudioWidth - minCenterWidth - handleSpace;
        setSourcesWidth(clamp(startSourcesWidth + deltaX, minSourcesWidth, Math.min(maxSourcesWidth, maxByCenter)));
        return;
      }
      const maxByCenter = containerWidth - startSourcesWidth - minCenterWidth - handleSpace;
      setStudioWidth(clamp(startStudioWidth - deltaX, minStudioWidth, Math.min(maxStudioWidth, maxByCenter)));
    };

    const stopResize = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  const toggleSource = (fileId: number) => {
    setSelectedFileIds((prev) => {
      if (prev.includes(fileId)) return prev.filter((id) => id !== fileId);
      return [...prev, fileId];
    });
  };

  const selectAllSources = () => {
    if (allSourcesSelected) {
      setSelectedFileIds([]);
      return;
    }
    setSelectedFileIds(files.map((file) => file.file_id));
  };

  const openCustomizeDialog = () => {
    setCustomCoverIcon(notebook?.cover_icon || "book-open");
    setCustomizeDialogOpen(true);
  };

  const saveNotebookCustom = async () => {
    if (!notebookId) return;
    setSavingNotebookCustom(true);
    try {
      const updated = await updateNotebook(notebookId, {
        cover_icon: customCoverIcon,
      });
      setNotebook(updated);
      setCustomizeDialogOpen(false);
      toast.success("笔记本外观已更新");
    } catch (error) {
      showNotebookError(error, "更新笔记本外观失败");
    } finally {
      setSavingNotebookCustom(false);
    }
  };

  useEffect(() => {
    if (!hasProcessingFiles || !notebookId) return;
    const timer = window.setInterval(() => {
      fetchNotebook(notebookId)
        .then((data) => {
          setNotebook(data.notebook);
          const nextFiles = data.files || [];
          setFiles(nextFiles);
          setSelectedFileIds((prev) => reconcileSelectedFileIds(prev, nextFiles));
        })
        .catch((error) => {
          const normalized = normalizeNotebookError(error, t("notebook.loadFailed"));
          setPageError(normalized.message);
        });
    }, 3500);
    return () => window.clearInterval(timer);
  }, [hasProcessingFiles, notebookId, t]);

  const handleUpload = async (selected: FileList | File[] | null) => {
    const selectedFiles = Array.from(selected || []);
    if (!selectedFiles.length || !notebookId) return;
    setUploading(true);
    setPageError(null);
    try {
      const next: NotebookFile[] = [];
      const failures: string[] = [];
      for (const file of selectedFiles) {
        try {
          const publicId = await uploadNotebookSourceFile(file, currentWorkspaceId());
          next.push(await addNotebookFile(notebookId, publicId));
        } catch (error) {
          const normalized = normalizeNotebookError(error, `${file.name} ${t("notebook.uploadFailed")}`);
          failures.push(`${file.name}: ${normalized.message}`);
        }
      }
      if (next.length > 0) {
        setFiles((prev) => [...next, ...prev.filter((old) => !next.some((item) => item.file_id === old.file_id))]);
        setSelectedFileIds((prev) => reconcileSelectedFileIds(prev, [...next, ...files.filter((old) => !next.some((item) => item.file_id === old.file_id))]));
        toast.success(t("notebook.uploadSuccess"));
        window.setTimeout(load, 1200);
      }
      if (failures.length > 0) {
        const message = failures[0];
        const failureMessage = failures.length > 1
          ? t("notebook.uploadAdditionalFailures", { message, count: String(failures.length - 1) })
          : message;
        setPageError(failureMessage);
        toast.error(failureMessage);
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleAddUrlSource = async (url: string) => {
    if (!notebookId) return;
    setAddingUrl(true);
    setPageError(null);
    try {
      const next = await addNotebookUrlSource(notebookId, url);
      const nextFiles = [next, ...files.filter((old) => old.file_id !== next.file_id)];
      setFiles(nextFiles);
      setSelectedFileIds((prev) => reconcileSelectedFileIds(prev, nextFiles));
      setUrlDialogOpen(false);
      toast.success(t("notebook.addUrlSuccess"));
      window.setTimeout(load, 1200);
    } catch (error) {
      const normalized = showNotebookError(error, t("notebook.addUrlFailed"));
      setPageError(normalized.message);
    } finally {
      setAddingUrl(false);
    }
  };

  const openPreview = async (file: NotebookFile) => {
    if (!notebookId) return;
    setPreviewSource(file);
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const data = await fetchNotebookFileContent(notebookId, file.file_id);
      setPreviewData(data);
      if (data.file) {
        setPreviewSource((current) => current && current.file_id === file.file_id ? { ...current, file: data.file } : current);
        setFiles((prev) => prev.map((item) => item.file_id === file.file_id ? { ...item, file: data.file } : item));
      }
    } catch (error) {
      const normalized = normalizeNotebookError(error, t("notebook.previewLoadFailed"));
      setPreviewError(normalized.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewSource(null);
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(false);
  };

  const openRemoveSourceDialog = (file: NotebookFile) => {
    setSourceMenuFileId(null);
    setSourceToRemove(file);
  };

  const openRenameSourceDialog = (file: NotebookFile) => {
    setSourceMenuFileId(null);
    setSourceToRename(file);
    setSourceRenameValue(file.file.filename || "");
  };

  const confirmRemoveSource = async () => {
    if (!notebookId || !sourceToRemove) return;
    const file = sourceToRemove;
    setRemovingSource(true);
    try {
      await removeNotebookFile(notebookId, file.file_id);
      setFiles((prev) => prev.filter((item) => item.id !== file.id));
      setSelectedFileIds((prev) => prev.filter((id) => id !== file.file_id));
      if (previewSource?.id === file.id) closePreview();
      setSourceToRemove(null);
      toast.success(t("notebook.removeSuccess"));
    } catch (error) {
      showNotebookError(error, t("notebook.removeFailed"));
    } finally {
      setRemovingSource(false);
    }
  };

  const confirmRenameSource = async () => {
    if (!notebookId || !sourceToRename) return;
    const filename = sourceRenameValue.trim();
    if (!filename) return;
    setRenamingSource(true);
    try {
      const updated = await updateNotebookFile(notebookId, sourceToRename.file_id, { filename });
      setFiles((prev) => prev.map((item) => item.file_id === updated.file_id ? updated : item));
      setPreviewSource((current) => current?.file_id === updated.file_id ? updated : current);
      setSourceToRename(null);
      toast.success("来源已重命名");
    } catch (error) {
      showNotebookError(error, "重命名来源失败");
    } finally {
      setRenamingSource(false);
    }
  };

  const buildStudioTableRows = (): NotebookStudioTableRow[] => {
    const selected = files.filter((file) => selectedFileIds.includes(file.file_id));
    const scopedFiles = selected.length > 0 ? selected : files;
    if (scopedFiles.length === 0) {
      return [{
        module: t("notebook.studio.tableEmptyModule"),
        capability: t("notebook.studio.tableEmptyCapability"),
        status: t("notebook.studio.tableEmptyStatus"),
        implementation: t("notebook.studio.tableEmptyImplementation"),
        value: t("notebook.studio.tableEmptyValue"),
        source: "—",
      }];
    }

    return scopedFiles.map((file, index) => {
      const ready = isNotebookFileReady(file);
      const parseStatus = file.file.parse_status || "—";
      const embeddingStatus = file.file.embedding_status || "—";
      const details = [
        file.file.mime_type || "file",
        formatSize(file.file.size),
        file.file.page_count ? t("notebook.studio.tablePages", { count: String(file.file.page_count) }) : null,
        file.file.token_count ? t("notebook.studio.tableTokens", { count: String(file.file.token_count) }) : null,
      ].filter(Boolean).join(" · ");
      return {
        module: file.file.filename,
        capability: file.file.summary || details || t("notebook.studio.tableCapabilityFallback"),
        status: ready ? t("notebook.statusReady") : `${parseStatus} / ${embeddingStatus}`,
        implementation: t("notebook.studio.tableImplementation", { parse: parseStatus, embedding: embeddingStatus }),
        value: ready ? t("notebook.studio.tableReadyValue") : t("notebook.studio.tablePendingValue"),
        source: `[${index + 1}]`,
      };
    });
  };

  const scopedStudioFiles = () => {
    const selected = files.filter((file) => selectedFileIds.includes(file.file_id));
    return selected.length > 0 ? selected : files;
  };

  const sourceRef = (index: number) => `[${index + 1}]`;

  const buildStudioTextSections = (type: "summary" | "faq" | "briefing"): NotebookStudioTextSection[] => {
    const scopedFiles = scopedStudioFiles();
    if (scopedFiles.length === 0) {
      return [{ heading: t("notebook.studio.noSourcesHeading"), body: t("notebook.studio.noSourcesBody") }];
    }
    const readyFiles = scopedFiles.filter(isNotebookFileReady);
    const sourceBullets = scopedFiles.map((file, index) => {
      const summary = file.file.summary || [file.file.mime_type || "file", formatSize(file.file.size)].filter(Boolean).join(" · ");
      return `${sourceRef(index)} ${file.file.filename}: ${summary || t("notebook.studio.sourceNoSummary")}`;
    });
    if (type === "summary") {
      return [
        {
          heading: t("notebook.studio.summarySectionOverview"),
          body: t("notebook.studio.summaryOverviewBody", { count: String(scopedFiles.length), ready: String(readyFiles.length) }),
        },
        { heading: t("notebook.studio.summarySectionSources"), bullets: sourceBullets },
        {
          heading: t("notebook.studio.summarySectionNext"),
          bullets: [
            t("notebook.studio.summaryNextVerify"),
            t("notebook.studio.summaryNextAsk"),
            t("notebook.studio.summaryNextTable"),
          ],
        },
      ];
    }
    if (type === "faq") {
      return [
        {
          heading: t("notebook.studio.faqQuestionScope"),
          body: t("notebook.studio.faqAnswerScope", { count: String(scopedFiles.length), ready: String(readyFiles.length) }),
        },
        {
          heading: t("notebook.studio.faqQuestionSources"),
          bullets: sourceBullets,
        },
        {
          heading: t("notebook.studio.faqQuestionFollowup"),
          bullets: [
            t("notebook.studio.faqFollowupCompare"),
            t("notebook.studio.faqFollowupRisks"),
            t("notebook.studio.faqFollowupTimeline"),
          ],
        },
      ];
    }
    return [
      {
        heading: t("notebook.studio.briefingSectionSituation"),
        body: t("notebook.studio.briefingSituationBody", { title: notebook?.title || t("notebook.untitled"), count: String(scopedFiles.length) }),
      },
      {
        heading: t("notebook.studio.briefingSectionSignals"),
        bullets: sourceBullets.slice(0, 6),
      },
      {
        heading: t("notebook.studio.briefingSectionActions"),
        bullets: [
          t("notebook.studio.briefingActionValidate"),
          t("notebook.studio.briefingActionDeepDive"),
          t("notebook.studio.briefingActionExport"),
        ],
      },
    ];
  };

  const openReportDialog = async () => {
    if (!notebookId) return;
    if (selectedFileIds.length === 0) {
      toast.info(t("notebook.studio.selectSourcesFirst"));
      return;
    }
    setReportDialogOpen(true);
    setSelectedReportFormatId("briefing-document");
    setLoadingReportSuggestions(true);
    try {
      const suggestions = await suggestNotebookReportFormats({
        notebookId,
        file_ids: selectedFileIds,
        language: language as LanguageCode,
      });
      setReportFormatSuggestions(suggestions.slice(0, 4));
    } catch (error) {
      setReportFormatSuggestions([]);
      showNotebookError(error, t("notebook.studio.reportSuggestionFailed"));
    } finally {
      setLoadingReportSuggestions(false);
    }
  };

  const generateStudioArtifactByType = async (type: string, visualType: NotebookStudioActionId, options?: { orientation?: string; style?: string; detail_level?: string; prompt?: string }) => {
    if (!notebookId) return;
    setGeneratingStudioType(visualType);
    try {
      const saved = await generateNotebookArtifact({
        notebookId,
        type,
        file_ids: selectedFileIds,
        language: language as LanguageCode,
        orientation: options?.orientation,
        style: options?.style,
        detail_level: options?.detail_level,
        prompt: options?.prompt,
      });
      const artifact = toStudioArtifact(saved);
      if (artifact) {
        setStudioArtifacts((prev) => [artifact, ...prev.filter((item) => item.id !== artifact.id)]);
        if (artifact.type === "infographic") {
          setActiveStudioArtifactId(null);
        } else {
          setActiveStudioArtifactId(artifact.id);
        }
      }
      toast.success(visualType === "table" ? t("notebook.studio.tableGenerated") : visualType === "quiz" ? t("notebook.studio.quizGenerated") : visualType === "report" ? t("notebook.studio.reportGenerated") : visualType === "infographic" ? t("notebook.studio.infographicGenerated") : t("notebook.studio.textGenerated"));
    } catch (error) {
      showNotebookError(error, t("notebook.studio.saveFailed"));
    } finally {
      setGeneratingStudioType(null);
    }
  };

  const handleCreateReport = () => {
    const reportType = `report:${selectedReportFormatId}`;
    setReportDialogOpen(false);
    void generateStudioArtifactByType(reportType, "report");
  };

  const handleStudioGenerate = async (type: NotebookStudioActionId, options?: { orientation?: string; style?: string; detail_level?: string; prompt?: string }) => {
    if (type === "slides") {
      toast.info(t("notebook.studio.comingSoon"));
      return;
    }
    if (type === "report") {
      await openReportDialog();
      return;
    }
    if (type === "infographic") {
      if (!notebookId) return;
      if (selectedFileIds.length === 0) {
        toast.info(t("notebook.studio.selectSourcesFirst"));
        return;
      }
      await generateStudioArtifactByType("infographic", "infographic", options);
      return;
    }
    if (!notebookId) return;
    if (selectedFileIds.length === 0) {
      toast.info(t("notebook.studio.selectSourcesFirst"));
      return;
    }
    await generateStudioArtifactByType(type, type);
  };

  const handleRenameArtifact = async (artifact: NotebookStudioArtifact) => {
    if (!notebookId) return;
    const title = window.prompt(t("notebook.studio.renamePrompt"), artifact.title)?.trim();
    if (!title || title === artifact.title) return;
    try {
      const updated = await updateNotebookArtifact(notebookId, Number(artifact.id), { title, subtitle: artifact.subtitle });
      const next = toStudioArtifact(updated);
      if (next) {
        setStudioArtifacts((prev) => prev.map((item) => item.id === next.id ? next : item));
        setActiveStudioArtifactId(next.id);
      }
      toast.success(t("notebook.studio.renameSuccess"));
    } catch (error) {
      showNotebookError(error, t("notebook.studio.renameFailed"));
    }
  };

  const handleDeleteArtifact = async (artifact: NotebookStudioArtifact) => {
    if (!notebookId) return;
    if (!window.confirm(t("notebook.studio.deleteConfirm", { title: artifact.title }))) return;
    try {
      await deleteNotebookArtifact(notebookId, Number(artifact.id));
      setStudioArtifacts((prev) => {
        const next = prev.filter((item) => item.id !== artifact.id);
        setActiveStudioArtifactId((current) => current === artifact.id ? next[0]?.id || null : current);
        return next;
      });
      toast.success(t("notebook.studio.deleteSuccess"));
    } catch (error) {
      showNotebookError(error, t("notebook.studio.deleteFailed"));
    }
  };

  const handleCopyArtifact = async (artifact: NotebookStudioArtifact) => {
    try {
      await navigator.clipboard.writeText(artifactToMarkdown(artifact));
      toast.success(t("notebook.studio.copySuccess"));
    } catch {
      toast.error(t("notebook.studio.copyFailed"));
    }
  };

  const handleDownloadArtifact = (artifact: NotebookStudioArtifact) => {
    const base = safeFilename(artifact.title);
    if (artifact.type === "table") {
      downloadTextFile(`${base}.csv`, artifactToCsv(artifact), "text/csv;charset=utf-8");
    } else {
      downloadTextFile(`${base}.md`, artifactToMarkdown(artifact), "text/markdown;charset=utf-8");
    }
    toast.success(t("notebook.studio.downloadSuccess"));
  };

  const handleExportTableToGoogleSheets = (artifact: Extract<NotebookStudioArtifact, { type: "table" }>) => {
    const base = safeFilename(artifact.title);
    downloadTextFile(`${base}.csv`, artifactToCsv(artifact), "text/csv;charset=utf-8");
    toast.success(t("notebook.studio.googleSheetsExportHint"));
  };

  const handleExplainFlashcard = (card: NotebookStudioFlashcard) => {
    const content = t("notebook.studio.flashcardExplainPrompt", { front: card.front, back: card.back });
    setExternalChatSendRequest({ id: Date.now(), content });
  };

  const handleExplainQuiz = (question: NotebookStudioQuizQuestion, selectedOptionId: string | null) => {
    const selectedOption = question.options.find((option) => option.id === selectedOptionId);
    const correctOption = question.options.find((option) => option.id === question.correct_option_id);
    const content = t("notebook.studio.quizExplainPrompt", {
      question: question.question,
      selected: selectedOption ? `${selectedOption.id}. ${selectedOption.text}` : t("notebook.studio.notAnswered"),
      correct: correctOption ? `${correctOption.id}. ${correctOption.text}` : question.correct_option_id,
      explanation: question.explanation,
    });
    setExternalChatSendRequest({ id: Date.now(), content });
  };

  const handleRename = async () => {
    if (!notebook) return;
    const title = window.prompt(t("notebook.renamePrompt"), notebook.title)?.trim();
    if (!title || title === notebook.title) return;
    try {
      const updated = await updateNotebook(notebook.id, { title });
      setNotebook(updated);
      toast.success(t("notebook.renameSuccess"));
    } catch (error) {
      showNotebookError(error, t("notebook.renameFailed"));
    }
  };

  if (loading && !notebook) {
    return <div className="flex h-full items-center justify-center bg-surface"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>;
  }

  if (!notebookId) {
    return <div className="flex h-full items-center justify-center bg-surface text-sm text-text-secondary">{t("notebook.loadFailed")}</div>;
  }

  return (
    <>
    <div ref={layoutRef} className="flex h-full min-h-0 gap-2 overflow-hidden bg-surface-elevated p-3 text-text-primary">
      <aside className="flex h-full shrink-0 flex-col overflow-hidden rounded-[28px] border border-surface-border bg-surface-card shadow-sm" style={{ width: sourcesWidth }}>
        <div className="border-b border-surface-border px-5 py-4">
          <Link href="/notebooks" className="mb-4 inline-flex items-center gap-2 text-xs font-medium text-text-tertiary transition hover:text-text-primary">
            <ArrowLeft className="h-3.5 w-3.5" />{t("notebook.back")}
          </Link>
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-muted text-brand"><BookOpen className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <button onClick={handleRename} className="block max-w-full truncate text-left text-lg font-semibold text-text-primary hover:text-brand">{notebook?.title || t("notebook.untitled")}</button>
              <p className="mt-1 text-xs text-text-tertiary">{t("notebook.readyCount").replace("{ready}", String(readyCount)).replace("{total}", String(files.length))}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-text-primary">{t("notebook.sources")}</h2>
            <p className="mt-1 text-xs text-text-tertiary">{t("notebook.sourcesHint")}</p>
          </div>
          <button
            type="button"
            onClick={() => setUrlDialogOpen(true)}
            disabled={addingUrl}
            className="mb-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-muted text-sm font-semibold text-text-primary transition hover:bg-brand-muted/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {addingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t("notebook.addSource")}
          </button>
          <div className="mb-3 rounded-[22px] border border-surface-border bg-surface-elevated p-3">
            <button type="button" onClick={() => setUrlDialogOpen(true)} className="block w-full rounded-2xl px-2 py-1.5 text-left text-sm font-medium text-text-secondary transition hover:text-text-primary">
              {t("notebook.searchNewSources")}
            </button>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => setUrlDialogOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-2.5 text-xs font-medium text-text-secondary transition hover:text-text-primary">
                <Globe className="h-3.5 w-3.5" />Web
              </button>
              <button type="button" onClick={() => setUrlDialogOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-2.5 text-xs font-medium text-text-secondary transition hover:text-text-primary">
                <Zap className="h-3.5 w-3.5 text-brand" />Fast Research
              </button>
              <button type="button" onClick={() => setUrlDialogOpen(true)} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-card text-text-secondary transition hover:bg-brand hover:text-white">
                <Search className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />

          {pageError && (
            <div className="mb-3 flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs leading-5 text-red-600 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{pageError}</span>
            </div>
          )}

          {files.length > 0 && (
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={selectAllSources} className="inline-flex items-center gap-2 rounded-full px-1.5 py-1 text-sm font-semibold text-text-primary transition hover:text-brand">
                {t("notebook.selectAllSources")}
                <span className={cn("flex h-4 w-4 items-center justify-center rounded border transition", allSourcesSelected ? "border-brand bg-brand text-white" : "border-surface-border text-transparent")}>
                  <Check className="h-3 w-3" />
                </span>
              </button>
            </div>
          )}

          {files.length === 0 ? (
            <div className="flex min-h-[260px] w-full flex-col items-center justify-center px-5 text-center">
              <FileText className="mb-4 h-8 w-8 text-text-tertiary" />
              <div className="text-sm font-medium text-text-primary">已保存的来源将显示在此处</div>
              <p className="mt-3 max-w-[240px] text-xs leading-5 text-text-tertiary">
                点击上方的“添加来源”即可上传文件、添加网页链接，或粘贴文本作为笔记本资料源。
              </p>
            </div>
          ) : (
            <div className="space-y-1 rounded-[24px] border border-transparent p-0 transition">
              {files.map((file) => {
                const selected = selectedFileIds.includes(file.file_id);
                return (
                  <div key={file.id} role="button" tabIndex={0} onClick={() => openPreview(file)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openPreview(file); }} className={cn("group w-full cursor-pointer rounded-md px-2 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800/60", !selected && "opacity-75")}>
                    <div className="flex items-center gap-3">
                      <SourcePdfIcon />
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="truncate text-sm font-medium text-text-primary">{file.file.filename}</div>
                      </div>
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSourceMenuFileId((current) => current === file.file_id ? null : file.file_id);
                          }}
                          className={cn("flex h-6 w-6 items-center justify-center text-text-primary opacity-0 transition group-hover:opacity-100", sourceMenuFileId === file.file_id && "opacity-100")}
                          aria-label={t("common.more") || "More"}
                          aria-expanded={sourceMenuFileId === file.file_id}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {sourceMenuFileId === file.file_id && (
                          <div
                            className="absolute right-0 top-7 z-30 w-40 overflow-hidden rounded-xl border border-surface-border bg-surface-card py-1 shadow-xl"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => openRemoveSourceDialog(file)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-text-primary transition hover:bg-surface-hover"
                            >
                              <Trash2 className="h-4 w-4 text-text-secondary" />
                              移除来源
                            </button>
                            <button
                              type="button"
                              onClick={() => openRenameSourceDialog(file)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-text-primary transition hover:bg-surface-hover"
                            >
                              <Pencil className="h-4 w-4 text-text-secondary" />
                              重命名来源
                            </button>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); toggleSource(file.file_id); }}
                        className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border transition", selected ? "border-brand bg-brand text-white" : "border-surface-border text-transparent group-hover:border-text-tertiary group-hover:text-text-tertiary")}
                        aria-label={selected ? "selected" : "unselected"}
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("notebook.resizeSources")}
        title={t("notebook.resizeSources")}
        onPointerDown={(event) => startPaneResize("sources", event)}
        className="group relative z-10 h-full w-1 shrink-0 cursor-col-resize touch-none bg-transparent"
      >
        <div className="absolute left-1/2 top-4 h-[calc(100%-2rem)] w-px -translate-x-1/2 bg-transparent transition group-hover:bg-surface-border" />
      </div>

      <section className="min-w-[420px] flex-1 overflow-hidden rounded-[28px] border border-surface-border bg-surface-card shadow-sm">
        <ChatInterface
          conversationId={conversationId}
          notebookId={notebookId}
          notebookTitle={notebook?.title}
          notebookFileCount={files.length}
          notebookFileIds={selectedFileIds}
          notebookHero={files.length > 0 ? {
            title: heroTitle,
            meta: `${files.length} 个来源`,
            coverClassName: heroCover.className,
            icon: heroCover.icon,
            imageUrl: heroCoverImageUrl,
            onCustomize: openCustomizeDialog,
          } : undefined}
          models={MODELS}
          welcomeTitle="让我们开始制作笔记本..."
          welcomeSubtitle="这是一张专属于您的空白画布，任您尽情探索、挥洒创意，或开启全新篇章。我可以引导您开始，或者您也可以直接添加自己的来源。"
          welcomeExamples={[
            { title: t("notebook.exampleSummary"), desc: t("notebook.exampleSummaryDesc"), prompt: t("notebook.exampleSummaryPrompt") },
            { title: t("notebook.exampleFaq"), desc: t("notebook.exampleFaqDesc"), prompt: t("notebook.exampleFaqPrompt") },
            { title: t("notebook.exampleCompare"), desc: t("notebook.exampleCompareDesc"), prompt: t("notebook.exampleComparePrompt") },
          ]}
          externalSendRequest={externalChatSendRequest}
        />
      </section>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("notebook.resizeStudio")}
        title={t("notebook.resizeStudio")}
        onPointerDown={(event) => startPaneResize("studio", event)}
        className="group relative z-10 h-full w-1 shrink-0 cursor-col-resize touch-none bg-transparent"
      >
        <div className="absolute left-1/2 top-4 h-[calc(100%-2rem)] w-px -translate-x-1/2 bg-transparent transition group-hover:bg-surface-border" />
      </div>
      <NotebookStudioPanel
        width={studioWidth}
        artifacts={studioArtifacts}
        activeArtifactId={activeStudioArtifactId}
        generatingType={generatingStudioType}
        selectedSourceCount={selectedFileIds.length}
        sourceFiles={studioSourceFiles}
        onGenerate={handleStudioGenerate}
        onOpenArtifact={setActiveStudioArtifactId}
        onRenameArtifact={handleRenameArtifact}
        onDeleteArtifact={handleDeleteArtifact}
        onCopyArtifact={handleCopyArtifact}
        onDownloadArtifact={handleDownloadArtifact}
        onExportTableToGoogleSheets={handleExportTableToGoogleSheets}
        onExplainFlashcard={handleExplainFlashcard}
        onExplainQuiz={handleExplainQuiz}
      />
    </div>
    <NotebookUrlSourceDialog
      open={urlDialogOpen}
      loading={addingUrl}
      uploading={uploading}
      sourceCount={files.length}
      sourceLimit={50}
      onClose={() => setUrlDialogOpen(false)}
      onSubmit={handleAddUrlSource}
      onUploadFiles={handleUpload}
    />
    <NotebookSourcePreviewDrawer
      open={Boolean(previewSource)}
      source={previewSource}
      data={previewData}
      loading={previewLoading}
      error={previewError}
      onClose={closePreview}
    />
    <ReportFormatDialog
      open={reportDialogOpen}
      selectedId={selectedReportFormatId}
      suggestions={reportFormatSuggestions}
      loadingSuggestions={loadingReportSuggestions}
      generating={generatingStudioType === "report"}
      onSelect={setSelectedReportFormatId}
      onClose={() => setReportDialogOpen(false)}
      onGenerate={handleCreateReport}
      t={t}
    />
    <NotebookCustomizeDialog
      open={customizeDialogOpen}
      notebook={notebook}
      coverIcon={customCoverIcon}
      saving={savingNotebookCustom}
      onCoverChange={setCustomCoverIcon}
      onClose={() => setCustomizeDialogOpen(false)}
      onSave={saveNotebookCustom}
    />
    <ConfirmRemoveSourceDialog
      open={Boolean(sourceToRemove)}
      source={sourceToRemove}
      removing={removingSource}
      onClose={() => setSourceToRemove(null)}
      onConfirm={confirmRemoveSource}
    />
    <RenameSourceDialog
      open={Boolean(sourceToRename)}
      source={sourceToRename}
      value={sourceRenameValue}
      saving={renamingSource}
      onChange={setSourceRenameValue}
      onClose={() => setSourceToRename(null)}
      onConfirm={confirmRenameSource}
    />
    </>
  );
}

export default function NotebookDetailPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center bg-surface"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>}>
      <NotebookDetailContent />
    </Suspense>
  );
}
