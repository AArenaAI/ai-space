"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, FileText, Globe, Loader2, MoreVertical, Plus, Search, Zap, AlertCircle, CheckCircle2, Clock3, Check, ImageIcon, Upload, Trash2, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import ChatInterface from "@/components/chat/ChatInterface";
import { NotebookSourcePreviewDrawer } from "@/components/notebook/NotebookSourcePreviewDrawer";
import { NotebookStudioPanel, type NotebookSourceOpenTarget, type NotebookStudioActionId, type NotebookStudioArtifact, type NotebookStudioCitation, type NotebookStudioFlashcard, type NotebookStudioMindmapEdge, type NotebookStudioMindmapNode, type NotebookStudioNote, type NotebookStudioQuizQuestion, type NotebookStudioReportSection, type NotebookStudioReportTable, type NotebookStudioSource, type NotebookStudioTableRow, type NotebookStudioTextSection } from "@/components/notebook/NotebookStudioPanel";
import { NotebookUrlSourceDialog } from "@/components/notebook/NotebookUrlSourceDialog";
import { MODELS } from "@/hooks/useChat";
import { addNotebookFile, addNotebookUrlSource, deleteNotebookArtifact, fetchNotebook, fetchNotebookArtifacts, fetchNotebookFileContent, generateNotebookArtifact, reindexNotebookFile, removeNotebookFile, suggestNotebookReportFormats, updateNotebook, updateNotebookArtifact, updateNotebookFile, type NotebookReportFormatSuggestion } from "@/lib/notebookApi";
import { READONLY_NOTEBOOKS, readonlyNotebookFileContent, readonlyNotebookFiles } from "@/lib/notebookDemos";
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

function notebookNotesStorageKey(notebookId: number) {
  return `notebook:${notebookId}:studio-notes`;
}

function readStoredNotebookNotes(notebookId: number): NotebookStudioNote[] {
  try {
    const raw = localStorage.getItem(notebookNotesStorageKey(notebookId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === "string" && typeof item.title === "string") : [];
  } catch {
    return [];
  }
}

function writeStoredNotebookNotes(notebookId: number, notes: NotebookStudioNote[]) {
  try {
    localStorage.setItem(notebookNotesStorageKey(notebookId), JSON.stringify(notes.slice(0, 1000)));
  } catch {
    toast.error("笔记保存到本地失败");
  }
}

const NOTEBOOK_DEFAULT_COVER_LOGO = "/brand-dark-logo.png";

const NOTEBOOK_COVER_PRESETS = [
  { id: "aispace-logo", icon: NOTEBOOK_DEFAULT_COVER_LOGO, className: "bg-gradient-to-br from-[#edf4ff] via-[#eef0ff] to-[#f6efff] text-slate-950" },
];

function notebookCoverPreset(coverIcon?: string) {
  return NOTEBOOK_COVER_PRESETS.find((preset) => preset.id === coverIcon) || NOTEBOOK_COVER_PRESETS[0];
}

function notebookSourceIcon(file?: NotebookFile) {
  if (!file) return "FILE";
  const mime = (file.file.mime_type || "").toLowerCase();
  const filename = (file.file.filename || "").toLowerCase();
  if (mime.includes("pdf") || filename.endsWith(".pdf")) return "PDF";
  if (mime.includes("word") || filename.endsWith(".doc") || filename.endsWith(".docx")) return "DOC";
  if (mime.includes("spreadsheet") || mime.includes("excel") || filename.endsWith(".xls") || filename.endsWith(".xlsx") || filename.endsWith(".csv")) return "XLS";
  if (mime.includes("presentation") || filename.endsWith(".ppt") || filename.endsWith(".pptx")) return "PPT";
  if (mime.includes("image/")) return "IMG";
  if (mime.includes("html") || filename.startsWith("http") || filename.endsWith(".url")) return "WEB";
  if (mime.includes("markdown") || filename.endsWith(".md")) return "MD";
  if (mime.includes("text") || filename.endsWith(".txt")) return "TXT";
  return "FILE";
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

function sourceIconClass(label: string) {
  switch (label) {
    case "PDF": return "bg-red-500 text-white";
    case "DOC": return "bg-blue-500 text-white";
    case "XLS": return "bg-emerald-500 text-white";
    case "PPT": return "bg-orange-500 text-white";
    case "IMG": return "bg-fuchsia-500 text-white";
    case "WEB": return "bg-cyan-500 text-white";
    case "MD": return "bg-slate-700 text-white";
    case "TXT": return "bg-zinc-500 text-white";
    default: return "bg-surface-elevated text-text-secondary ring-1 ring-surface-border";
  }
}

function SourceFileIcon({ file }: { file: NotebookFile }) {
  const label = notebookSourceIcon(file);
  return (
    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-[8px] font-bold leading-none tracking-[-0.02em] shadow-sm", sourceIconClass(label))}>
      {label}
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

function canRetryNotebookIndex(file: NotebookFile) {
  const parse = file.file.parse_status;
  const embed = file.file.embedding_status;
  return parse === "done" && (embed === "error" || embed === "skipped");
}

function retryNotebookIndexLabel(file: NotebookFile, t: Translate) {
  return file.file.embedding_status === "skipped" ? t("notebook.startIndexing") : t("notebook.retryIndexing");
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
    sourceFileIds: Array.isArray(artifact.source_file_ids) ? artifact.source_file_ids.filter((id) => Number.isFinite(id) && id > 0) : [],
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

function escapeMarkdownTableCell(value: string) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function citationMarker(citation: NotebookStudioCitation) {
  return `[${citation.source_index || 1}]`;
}

function citationToExportText(citation: NotebookStudioCitation) {
  const parts = [citationMarker(citation), `file:${citation.file_id}`];
  if (citation.page) parts.push(`page:${citation.page}`);
  if (citation.chunk_index !== undefined && citation.chunk_index !== null) parts.push(`chunk:${citation.chunk_index}`);
  if (citation.quote) parts.push(`quote:${citation.quote}`);
  return parts.join(" ");
}

function citationsToExportText(citations?: NotebookStudioCitation[]) {
  if (!citations?.length) return "";
  return citations.map(citationToExportText).join("; ");
}

function appendCitationBlock(lines: string[], citations?: NotebookStudioCitation[]) {
  if (!citations?.length) return;
  lines.push("", "**引用来源**");
  citations.forEach((citation) => {
    const meta = [`file:${citation.file_id}`];
    if (citation.page) meta.push(`page:${citation.page}`);
    if (citation.chunk_index !== undefined && citation.chunk_index !== null) meta.push(`chunk:${citation.chunk_index}`);
    lines.push(`- ${citationMarker(citation)} ${meta.join(" · ")}${citation.quote ? ` — ${citation.quote}` : ""}`);
  });
}

function tableArtifactToMarkdown(artifact: Extract<NotebookStudioArtifact, { type: "table" }>) {
  const lines = [`# ${artifact.title}`, "", artifact.subtitle, "", "| 功能模块 / 来源 | 具体能力 / 内容摘要 | 状态 | 核心技术 / 处理方式 | 业务价值 | 来源 | 结构化引用 |", "| --- | --- | --- | --- | --- | --- | --- |"];
  artifact.rows.forEach((row) => {
    lines.push(`| ${escapeMarkdownTableCell(row.module)} | ${escapeMarkdownTableCell(row.capability)} | ${escapeMarkdownTableCell(row.status)} | ${escapeMarkdownTableCell(row.implementation)} | ${escapeMarkdownTableCell(row.value)} | ${escapeMarkdownTableCell(row.source)} | ${escapeMarkdownTableCell(citationsToExportText(row.citations))} |`);
  });
  return lines.join("\n").trim() + "\n";
}

function artifactToMarkdown(artifact: NotebookStudioArtifact) {
  if (artifact.type === "table") return tableArtifactToMarkdown(artifact);
  const lines = [`# ${artifact.title}`, "", artifact.subtitle, ""].filter((line) => line !== undefined);
  switch (artifact.type) {
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
    case "report": {
      const appendReportSection = (section: NotebookStudioReportSection, depth = 2) => {
        const prefix = "#".repeat(Math.min(Math.max(depth, 2), 4));
        lines.push(`${prefix} ${section.number ? `${section.number}. ` : ""}${section.heading}`);
        if (section.body) lines.push("", section.body);
        if (section.bullets?.length) {
          lines.push("");
          section.bullets.forEach((bullet) => lines.push(`- ${bullet}`));
        }
        appendCitationBlock(lines, section.citations);
        lines.push("");
        section.subsections?.forEach((subsection) => appendReportSection(subsection, depth + 1));
      };
      lines.push(`_Format: ${artifact.formatTitle}_`, "", "## Executive Summary", "", artifact.executiveSummary, "");
      artifact.sections.forEach((section) => appendReportSection(section));
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
    }
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

function regenerationRequestForArtifact(artifact: NotebookStudioArtifact): { type: string; visualType: NotebookStudioActionId; options?: { orientation?: string; style?: string; detail_level?: string; prompt?: string } } | null {
  switch (artifact.type) {
    case "table":
      return { type: "table", visualType: "table" };
    case "mindmap":
      return { type: "mindmap", visualType: "mindmap" };
    case "flashcards":
      return { type: "flashcards", visualType: "flashcards" };
    case "quiz":
      return { type: "quiz", visualType: "quiz" };
    case "report":
      return { type: `report:${artifact.formatId || "briefing-document"}`, visualType: "report" };
    case "infographic":
      return { type: "infographic", visualType: "infographic", options: { orientation: artifact.orientation, style: artifact.style, detail_level: artifact.detail_level, prompt: artifact.prompt } };
    case "summary":
    case "faq":
    case "briefing":
      return { type: artifact.type, visualType: "summary" };
    default:
      return null;
  }
}

function artifactSourceIdsForRegeneration(artifact: NotebookStudioArtifact, files: NotebookFile[]) {
  if (Array.isArray(artifact.sourceFileIds) && artifact.sourceFileIds.length > 0) return artifact.sourceFileIds;
  return files.slice(0, Math.max(0, artifact.sourceCount || 0)).map((file) => file.file_id);
}

function artifactToCsv(artifact: NotebookStudioArtifact) {
  if (artifact.type !== "table") return artifactToMarkdown(artifact);
  const escape = (value: string) => `"${String(value || "").replace(/"/g, '""')}"`;
  const rows = [
    ["功能模块 / 来源", "具体能力 / 内容摘要", "状态", "核心技术 / 处理方式", "业务价值", "来源", "结构化引用"],
    ...artifact.rows.map((row) => [row.module, row.capability, row.status, row.implementation, row.value, row.source, citationsToExportText(row.citations)]),
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

function escapeHtml(value: string) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function reportArtifactToPrintHtml(artifact: Extract<NotebookStudioArtifact, { type: "report" }>) {
  const sections = artifact.sections.map((section) => `
    <section>
      <h2>${escapeHtml(section.number ? `${section.number}. ${section.heading}` : section.heading)}</h2>
      ${section.body ? `<p>${escapeHtml(section.body).replace(/\n/g, "<br>")}</p>` : ""}
      ${section.bullets?.length ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>` : ""}
    </section>
  `).join("");
  const tables = artifact.tables.map((table) => `
    <section>
      <h2>${escapeHtml(table.title)}</h2>
      <table>
        <thead><tr>${table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </section>
  `).join("");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(artifact.title)}</title>
  <style>
    @page { margin: 18mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; line-height: 1.65; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    .subtitle { color: #6b7280; margin-bottom: 24px; }
    .summary { border-left: 4px solid #6366f1; padding: 12px 16px; background: #f5f7ff; margin: 20px 0 28px; }
    h2 { font-size: 18px; margin: 26px 0 10px; page-break-after: avoid; }
    p { margin: 0 0 12px; }
    ul { margin: 8px 0 14px 22px; padding: 0; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 24px; font-size: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 8px 10px; vertical-align: top; }
    th { background: #f3f4f6; text-align: left; }
  </style>
</head>
<body>
  <h1>${escapeHtml(artifact.title)}</h1>
  <div class="subtitle">${escapeHtml(artifact.subtitle)} · ${escapeHtml(artifact.formatTitle || "Report")}</div>
  <div class="summary"><strong>Executive Summary</strong><br>${escapeHtml(artifact.executiveSummary).replace(/\n/g, "<br>")}</div>
  ${sections}
  ${tables}
</body>
</html>`;
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

function RenameArtifactDialog({
  open,
  artifact,
  value,
  saving,
  onChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  artifact: NotebookStudioArtifact | null;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open || !artifact) return null;
  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-[min(460px,94vw)] rounded-[24px] border border-surface-border bg-surface-card p-6 shadow-2xl">
        <div className="mb-5 flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111827]/10 text-[#111827] dark:bg-white/10 dark:text-white">
            <Pencil className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-text-primary">重命名输出文件</h3>
            <p className="mt-1 text-sm leading-6 text-text-secondary">修改这个 Studio 输出文件在列表中的显示名称。</p>
          </div>
        </div>
        <label className="mb-2 block text-sm font-semibold text-text-primary">输出文件名称</label>
        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && value.trim() && !saving) onConfirm(); }}
          className="mb-5 h-11 w-full rounded-xl border border-surface-border bg-surface-elevated px-3 text-sm text-text-primary outline-none transition focus:border-[#111827] focus:bg-surface-card dark:focus:border-white/70"
          placeholder="输入输出文件名称"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-hover disabled:opacity-60">取消</button>
          <button type="button" onClick={onConfirm} disabled={saving || !value.trim()} className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#1f2937] disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            确认修改
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameNotebookDialog({
  open,
  notebook,
  value,
  saving,
  onChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  notebook: Notebook | null;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open || !notebook) return null;
  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-[min(460px,94vw)] rounded-[24px] border border-surface-border bg-surface-card p-6 shadow-2xl">
        <div className="mb-5 flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111827]/10 text-[#111827] dark:bg-white/10 dark:text-white">
            <Pencil className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-text-primary">重命名 Notebook</h3>
            <p className="mt-1 text-sm leading-6 text-text-secondary">修改这个 Notebook 的标题。</p>
          </div>
        </div>
        <label className="mb-2 block text-sm font-semibold text-text-primary">Notebook 名称</label>
        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && value.trim() && !saving) onConfirm(); }}
          className="mb-5 h-11 w-full rounded-xl border border-surface-border bg-surface-elevated px-3 text-sm text-text-primary outline-none transition focus:border-[#111827] focus:bg-surface-card dark:focus:border-white/70"
          placeholder="输入 Notebook 名称"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-hover disabled:opacity-60">取消</button>
          <button type="button" onClick={onConfirm} disabled={saving || !value.trim()} className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#1f2937] disabled:opacity-60">
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
              <>
                <img src={uploadedImage} alt="笔记本底图预览" className="absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
              </>
            ) : (
              <>
                <div className="pointer-events-none absolute -right-10 -bottom-14 h-36 w-36 rotate-12 rounded-[34px] bg-fuchsia-400/10" />
                <div className="pointer-events-none absolute right-10 bottom-4 h-20 w-28 -rotate-6 rounded-[28px] bg-indigo-300/10" />
                <img src={NOTEBOOK_DEFAULT_COVER_LOGO} alt="AI Space" className="relative z-10 h-14 w-14 object-contain drop-shadow-sm" />
              </>
            )}
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
                  <img src={preset.icon} alt="AI Space" className="h-8 w-8 object-contain drop-shadow-sm" />
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
  const isReadonlyNotebook = notebookId < 0;
  const readonlyNotebook = READONLY_NOTEBOOKS.find((item) => item.id === notebookId) || null;
  const writableNotebookId = isReadonlyNotebook ? 0 : notebookId;
  const conversationId = searchParams.get("conversation_id") ? Number(searchParams.get("conversation_id")) : undefined;
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [files, setFiles] = useState<NotebookFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [addingUrl, setAddingUrl] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [sourcesWidth, setSourcesWidth] = useState(300);
  const [studioWidth, setStudioWidth] = useState(340);
  const [previewSource, setPreviewSource] = useState<NotebookFile | null>(null);
  const [previewData, setPreviewData] = useState<NotebookFileContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<NotebookSourceOpenTarget | null>(null);
  const [studioArtifacts, setStudioArtifacts] = useState<NotebookStudioArtifact[]>([]);
  const [studioNotes, setStudioNotes] = useState<NotebookStudioNote[]>([]);
  const [activeStudioArtifactId, setActiveStudioArtifactId] = useState<string | null>(null);
  const [generatingStudioType, setGeneratingStudioType] = useState<NotebookStudioActionId | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [selectedReportFormatId, setSelectedReportFormatId] = useState("briefing-document");
  const [reportFormatSuggestions, setReportFormatSuggestions] = useState<NotebookReportFormatSuggestion[]>([]);
  const [loadingReportSuggestions, setLoadingReportSuggestions] = useState(false);
  const [externalChatSendRequest, setExternalChatSendRequest] = useState<{ id: number; content: string; hidden?: boolean } | null>(null);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  const [customCoverIcon, setCustomCoverIcon] = useState("aispace-logo");
  const [savingNotebookCustom, setSavingNotebookCustom] = useState(false);
  const [renameNotebookDialogOpen, setRenameNotebookDialogOpen] = useState(false);
  const [notebookRenameValue, setNotebookRenameValue] = useState("");
  const [renamingNotebook, setRenamingNotebook] = useState(false);
  const [sourceMenuFileId, setSourceMenuFileId] = useState<number | null>(null);
  const [sourceToRemove, setSourceToRemove] = useState<NotebookFile | null>(null);
  const [removingSource, setRemovingSource] = useState(false);
  const [sourceToRename, setSourceToRename] = useState<NotebookFile | null>(null);
  const [sourceRenameValue, setSourceRenameValue] = useState("");
  const [renamingSource, setRenamingSource] = useState(false);
  const [artifactToRename, setArtifactToRename] = useState<NotebookStudioArtifact | null>(null);
  const [artifactRenameValue, setArtifactRenameValue] = useState("");
  const [renamingArtifact, setRenamingArtifact] = useState(false);
  const [reindexingSourceFileId, setReindexingSourceFileId] = useState<number | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectionInitializedRef = useRef(false);
  const loadStudioArtifacts = async () => {
    if (!writableNotebookId) return;
    try {
      const persisted = await fetchNotebookArtifacts(writableNotebookId);
      const next = persisted.map(toStudioArtifact).filter((item): item is NotebookStudioArtifact => Boolean(item));
      setStudioArtifacts(next);
      setActiveStudioArtifactId((prev) => (prev && next.some((item) => item.id === prev) ? prev : null));
    } catch (error) {
      showNotebookError(error, t("notebook.studio.loadFailed"));
    }
  };

  const load = async () => {
    if (!notebookId) { setLoading(false); return; }
    if (isReadonlyNotebook) {
      setLoading(true);
      if (readonlyNotebook) {
        const readonlyFiles = readonlyNotebookFiles(readonlyNotebook);
        setNotebook(readonlyNotebook);
        setFiles(readonlyFiles);
        setSelectedFileIds(readonlyFiles.map((file) => file.file_id));
        setStudioArtifacts([]);
        setStudioNotes(readStoredNotebookNotes(readonlyNotebook.id));
        setActiveStudioArtifactId(null);
        setPageError(null);
        selectionInitializedRef.current = true;
      } else {
        setNotebook(null);
        setFiles([]);
        setPageError(t("notebook.loadFailed"));
      }
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchNotebook(writableNotebookId);
      setNotebook(data.notebook);
      setStudioNotes(readStoredNotebookNotes(data.notebook.id));
      const nextFiles = data.files || [];
      setFiles(nextFiles);
      setSelectedFileIds((prev) => {
        const baseline = selectionInitializedRef.current ? prev : (readStoredSelectedFileIds(writableNotebookId) || []);
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
    if (!writableNotebookId || !selectionInitializedRef.current) return;
    localStorage.setItem(notebookSelectionStorageKey(writableNotebookId), JSON.stringify(selectedFileIds));
  }, [writableNotebookId, selectedFileIds]);

  useEffect(() => {
    if (!notebook) return;
    setCustomCoverIcon(notebook.cover_icon || "aispace-logo");
  }, [notebook?.id, notebook?.cover_icon]);

  useEffect(() => {
    if (!writableNotebookId || !notebook || files.length !== 1) return;
    const firstFile = files[0];
    if (!firstFile || !isNotebookFileReady(firstFile)) return;
    const storageKey = notebookAutoSummaryStorageKey(writableNotebookId, firstFile.file_id);
    if (localStorage.getItem(storageKey) === "done") return;
    localStorage.setItem(storageKey, "done");
    const autoTitle = buildAutoNotebookTitle(firstFile);
    if (!notebook.title || notebook.title === "未命名笔记本") {
      updateNotebook(writableNotebookId, { title: autoTitle }).then((updated) => {
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
  }, [writableNotebookId, notebook, files]);

  const readyCount = useMemo(() => files.filter(isNotebookFileReady).length, [files]);

  const firstFile = files[0];
  const heroTitle = notebook?.title && notebook.title !== "未命名笔记本" ? notebook.title : buildAutoNotebookTitle(firstFile);
  const heroCoverIcon = notebook?.cover_icon || "aispace-logo";
  const heroCover = notebookCoverPreset(heroCoverIcon);
  const heroCoverImageUrl = heroCoverIcon.startsWith("uploaded:") ? readNotebookUploadedCover(heroCoverIcon) : "";
  const heroIcon = undefined;

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
    setCustomCoverIcon(notebook?.cover_icon || "aispace-logo");
    setCustomizeDialogOpen(true);
  };

  const saveNotebookCustom = async () => {
    if (!writableNotebookId) return;
    setSavingNotebookCustom(true);
    try {
      const updated = await updateNotebook(writableNotebookId, {
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
    if (!hasProcessingFiles || !writableNotebookId) return;
    const timer = window.setInterval(() => {
      fetchNotebook(writableNotebookId)
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
  }, [hasProcessingFiles, writableNotebookId, t]);

  const handleUpload = async (selected: FileList | File[] | null) => {
    const selectedFiles = Array.from(selected || []);
    if (!selectedFiles.length || !writableNotebookId) return;
    setUploading(true);
    setPageError(null);
    try {
      const next: NotebookFile[] = [];
      const failures: string[] = [];
      for (const file of selectedFiles) {
        try {
          const publicId = await uploadNotebookSourceFile(file, currentWorkspaceId());
          next.push(await addNotebookFile(writableNotebookId, publicId));
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
    if (!writableNotebookId) return;
    setAddingUrl(true);
    setPageError(null);
    try {
      const next = await addNotebookUrlSource(writableNotebookId, url);
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

  const openPreview = async (file: NotebookFile, target?: NotebookSourceOpenTarget) => {
    if (isReadonlyNotebook && readonlyNotebook) {
      setPreviewSource(file);
      setPreviewTarget(target || null);
      setPreviewData(readonlyNotebookFileContent(readonlyNotebook, file.file_id));
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    if (!writableNotebookId) return;
    setPreviewSource(file);
    setPreviewTarget(target || null);
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const data = await fetchNotebookFileContent(writableNotebookId, file.file_id);
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
    setPreviewTarget(null);
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
    if (!writableNotebookId || !sourceToRemove) return;
    const file = sourceToRemove;
    setRemovingSource(true);
    try {
      await removeNotebookFile(writableNotebookId, file.file_id);
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
    if (!writableNotebookId || !sourceToRename) return;
    const filename = sourceRenameValue.trim();
    if (!filename) return;
    setRenamingSource(true);
    try {
      const updated = await updateNotebookFile(writableNotebookId, sourceToRename.file_id, { filename });
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

  const retrySourceIndexing = async (file: NotebookFile) => {
    if (!writableNotebookId || !canRetryNotebookIndex(file)) return;
    setReindexingSourceFileId(file.file_id);
    try {
      const updated = await reindexNotebookFile(writableNotebookId, file.file_id);
      setFiles((prev) => prev.map((item) => item.file_id === updated.file_id ? updated : item));
      setPreviewSource((current) => current?.file_id === updated.file_id ? updated : current);
      toast.success(t("notebook.reindexQueued"));
    } catch (error) {
      showNotebookError(error, t("notebook.reindexFailed"));
    } finally {
      setReindexingSourceFileId(null);
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
    if (!writableNotebookId) return;
    if (selectedFileIds.length === 0) {
      toast.info(t("notebook.studio.selectSourcesFirst"));
      return;
    }
    setReportDialogOpen(true);
    setSelectedReportFormatId("briefing-document");
    setLoadingReportSuggestions(true);
    try {
      const suggestions = await suggestNotebookReportFormats({
        notebookId: writableNotebookId,
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

  const generateStudioArtifactByType = async (type: string, visualType: NotebookStudioActionId, options?: { orientation?: string; style?: string; detail_level?: string; prompt?: string; file_ids?: number[]; successMessage?: string }) => {
    if (!writableNotebookId) return;
    setGeneratingStudioType(visualType);
    try {
      const saved = await generateNotebookArtifact({
        notebookId: writableNotebookId,
        type,
        file_ids: options?.file_ids || selectedFileIds,
        language: language as LanguageCode,
        orientation: options?.orientation,
        style: options?.style,
        detail_level: options?.detail_level,
        prompt: options?.prompt,
      });
      const artifact = toStudioArtifact(saved);
      if (artifact) {
        setStudioArtifacts((prev) => [artifact, ...prev.filter((item) => item.id !== artifact.id)]);
        setActiveStudioArtifactId(null);
      }
      toast.success(options?.successMessage || (visualType === "table" ? t("notebook.studio.tableGenerated") : visualType === "quiz" ? t("notebook.studio.quizGenerated") : visualType === "report" ? t("notebook.studio.reportGenerated") : visualType === "infographic" ? t("notebook.studio.infographicGenerated") : t("notebook.studio.textGenerated")));
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
      if (!writableNotebookId) return;
      if (selectedFileIds.length === 0) {
        toast.info(t("notebook.studio.selectSourcesFirst"));
        return;
      }
      await generateStudioArtifactByType("infographic", "infographic", options);
      return;
    }
    if (!writableNotebookId) return;
    if (selectedFileIds.length === 0) {
      toast.info(t("notebook.studio.selectSourcesFirst"));
      return;
    }
    await generateStudioArtifactByType(type, type);
  };

  const handleCreateStudioNote = (input: { title: string; content: string }) => {
    if (!notebook) return;
    const note: NotebookStudioNote = {
      id: `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title: input.title.trim() || "未命名笔记",
      content: input.content.trim(),
      createdAt: new Date().toISOString(),
      origin: "manual",
    };
    setStudioNotes((prev) => {
      const next = [note, ...prev].slice(0, 1000);
      writeStoredNotebookNotes(notebook.id, next);
      return next;
    });
    toast.success("笔记已添加");
  };

  const handleUpdateStudioNote = (noteId: string, input: { title: string; content: string }) => {
    if (!notebook) return;
    setStudioNotes((prev) => {
      const next = prev.map((note) => note.id === noteId ? { ...note, title: input.title.trim() || "未命名笔记", content: input.content.trim() } : note);
      writeStoredNotebookNotes(notebook.id, next);
      return next;
    });
    toast.success("笔记已更新");
  };

  const handleRegenerateArtifact = async (artifact: NotebookStudioArtifact) => {
    if (!writableNotebookId) return;
    const request = regenerationRequestForArtifact(artifact);
    if (!request) {
      toast.error(t("notebook.studio.regenerateFailed"));
      return;
    }
    const fileIds = artifactSourceIdsForRegeneration(artifact, files);
    if (fileIds.length === 0) {
      toast.info(t("notebook.studio.selectSourcesFirst"));
      return;
    }
    await generateStudioArtifactByType(request.type, request.visualType, {
      ...request.options,
      file_ids: fileIds,
      successMessage: t("notebook.studio.regenerateSuccess"),
    });
  };

  const handleRenameArtifact = (artifact: NotebookStudioArtifact) => {
    setArtifactToRename(artifact);
    setArtifactRenameValue(artifact.title);
  };

  const closeRenameArtifactDialog = () => {
    if (renamingArtifact) return;
    setArtifactToRename(null);
    setArtifactRenameValue("");
  };

  const confirmRenameArtifact = async () => {
    if (!writableNotebookId || !artifactToRename) return;
    const title = artifactRenameValue.trim();
    if (!title) return;
    if (title === artifactToRename.title) {
      closeRenameArtifactDialog();
      return;
    }
    setRenamingArtifact(true);
    try {
      const updated = await updateNotebookArtifact(writableNotebookId, Number(artifactToRename.id), { title, subtitle: artifactToRename.subtitle });
      const next = toStudioArtifact(updated);
      if (next) {
        setStudioArtifacts((prev) => prev.map((item) => item.id === next.id ? next : item));
        setActiveStudioArtifactId(next.id);
      }
      setArtifactToRename(null);
      setArtifactRenameValue("");
      toast.success(t("notebook.studio.renameSuccess"));
    } catch (error) {
      showNotebookError(error, t("notebook.studio.renameFailed"));
    } finally {
      setRenamingArtifact(false);
    }
  };

  const handleDeleteArtifact = async (artifact: NotebookStudioArtifact) => {
    if (!writableNotebookId) return;
    if (!window.confirm(t("notebook.studio.deleteConfirm", { title: artifact.title }))) return;
    try {
      await deleteNotebookArtifact(writableNotebookId, Number(artifact.id));
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

  const handleDownloadArtifact = async (artifact: NotebookStudioArtifact) => {
    const base = safeFilename(artifact.title);
    if (artifact.type === "table") {
      downloadTextFile(`${base}.csv`, artifactToCsv(artifact), "text/csv;charset=utf-8");
      toast.success(t("notebook.studio.downloadSuccess"));
      return;
    }
    if (artifact.type === "infographic" && artifact.image_url) {
      try {
        const imageUrl = artifact.image_url.startsWith("http") || artifact.image_url.startsWith("/") ? artifact.image_url : `/${artifact.image_url}`;
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error("image download failed");
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const ext = blob.type?.includes("jpeg") || blob.type?.includes("jpg") ? "jpg" : "png";
        link.href = objectUrl;
        link.download = `${base}.${ext}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
        toast.success(t("notebook.studio.downloadSuccess"));
        return;
      } catch {
        downloadTextFile(`${base}.md`, artifactToMarkdown(artifact), "text/markdown;charset=utf-8");
        toast.error(t("notebook.studio.infographicDownloadImageFailed"));
        return;
      }
    }
    downloadTextFile(`${base}.md`, artifactToMarkdown(artifact), "text/markdown;charset=utf-8");
    toast.success(t("notebook.studio.downloadSuccess"));
  };

  const handleCopyTableMarkdown = async (artifact: Extract<NotebookStudioArtifact, { type: "table" }>) => {
    try {
      await navigator.clipboard.writeText(tableArtifactToMarkdown(artifact));
      toast.success(t("notebook.studio.copyMarkdownTableSuccess"));
    } catch {
      toast.error(t("notebook.studio.copyFailed"));
    }
  };

  const handlePrintArtifact = (artifact: NotebookStudioArtifact) => {
    if (artifact.type !== "report") return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=960,height=720");
    if (!printWindow) {
      toast.error(t("notebook.studio.printBlocked"));
      return;
    }
    printWindow.document.open();
    printWindow.document.write(reportArtifactToPrintHtml(artifact));
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
    toast.success(t("notebook.studio.printReady"));
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

  const handleRename = () => {
    if (!notebook || !writableNotebookId) return;
    setNotebookRenameValue(notebook.title);
    setRenameNotebookDialogOpen(true);
  };

  const closeRenameNotebookDialog = () => {
    if (renamingNotebook) return;
    setRenameNotebookDialogOpen(false);
    setNotebookRenameValue("");
  };

  const confirmRenameNotebook = async () => {
    if (!notebook || !writableNotebookId) return;
    const title = notebookRenameValue.trim();
    if (!title) return;
    if (title === notebook.title) {
      closeRenameNotebookDialog();
      return;
    }
    setRenamingNotebook(true);
    try {
      const updated = await updateNotebook(writableNotebookId, { title });
      setNotebook(updated);
      setRenameNotebookDialogOpen(false);
      setNotebookRenameValue("");
      toast.success(t("notebook.renameSuccess"));
    } catch (error) {
      showNotebookError(error, t("notebook.renameFailed"));
    } finally {
      setRenamingNotebook(false);
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
          <div className="min-w-0">
            <button onClick={handleRename} disabled={!writableNotebookId} className="block max-w-full truncate text-left text-[15px] font-medium leading-5 text-text-primary hover:text-brand disabled:cursor-default disabled:hover:text-text-primary">{notebook?.title || t("notebook.untitled")}</button>
            <p className="mt-1 text-xs text-text-tertiary">{t("notebook.readyCount").replace("{ready}", String(readyCount)).replace("{total}", String(files.length))}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-text-primary">{t("notebook.sources")}</h2>
            <p className="mt-1 text-xs text-text-tertiary">{t("notebook.sourcesHint")}</p>
          </div>
          <button
            type="button"
            onClick={() => writableNotebookId && setUrlDialogOpen(true)}
            disabled={addingUrl || !writableNotebookId}
            className="mb-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#111827] text-sm font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)] transition hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {addingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t("notebook.addSource")}
          </button>
          <div className="mb-3 rounded-[22px] border border-surface-border bg-surface-elevated p-3">
            <button type="button" onClick={() => writableNotebookId && setUrlDialogOpen(true)} className="block w-full rounded-2xl px-2 py-1.5 text-left text-sm font-medium text-text-secondary transition hover:text-text-primary">
              {t("notebook.searchNewSources")}
            </button>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => writableNotebookId && setUrlDialogOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-2.5 text-xs font-medium text-text-secondary transition hover:text-text-primary">
                <Globe className="h-3.5 w-3.5" />Web
              </button>
              <button type="button" onClick={() => writableNotebookId && setUrlDialogOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-2.5 text-xs font-medium text-text-secondary transition hover:text-text-primary">
                <Zap className="h-3.5 w-3.5 text-brand" />Fast Research
              </button>
              <button type="button" onClick={() => writableNotebookId && setUrlDialogOpen(true)} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-card text-text-secondary transition hover:bg-brand hover:text-white">
                <Search className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <input ref={inputRef} type="file" multiple disabled={!writableNotebookId} className="hidden" onChange={(e) => handleUpload(e.target.files)} />

          {pageError && (
            <div className="mb-3 flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs leading-5 text-red-600 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{pageError}</span>
            </div>
          )}
          {isReadonlyNotebook && (
            <div className="mb-3 rounded-2xl border border-brand/20 bg-brand-muted/60 px-3 py-2.5 text-xs leading-5 text-text-secondary">
              精选/Demo 笔记本为只读示例。要上传来源或生成 Studio 内容，请新建自己的笔记本。
            </div>
          )}

          {files.length > 0 && (
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={selectAllSources} className="inline-flex items-center gap-2 rounded-full px-1.5 py-1 text-sm font-semibold text-[#111827] transition hover:text-[#111827]">
                {t("notebook.selectAllSources")}
                <span className={cn("flex h-4 w-4 items-center justify-center rounded border transition", allSourcesSelected ? "border-[#111827] bg-[#111827] text-white" : "border-surface-border text-transparent")}>
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
                const meta = statusMeta(file, t);
                const StatusIcon = meta.icon;
                const detail = statusDetail(file, t);
                const canRetryIndex = canRetryNotebookIndex(file);
                const retryingIndex = reindexingSourceFileId === file.file_id;
                return (
                  <div key={file.id} role="button" tabIndex={0} onClick={() => openPreview(file)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openPreview(file); }} className={cn("group w-full cursor-pointer rounded-md px-2 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800/60", !selected && "opacity-75")}>
                    <div className="flex items-center gap-3">
                      <SourceFileIcon file={file} />
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="truncate text-sm font-medium text-text-primary">{file.file.filename}</div>
                        <div className="mt-1.5 flex min-w-0 items-center gap-2">
                          <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium", meta.className)} title={detail || meta.label}>
                            <StatusIcon className={cn("h-3 w-3", isNotebookFileProcessing(file) && "animate-spin")} />
                            {meta.label}
                          </span>
                          {detail && <span className="truncate text-[11px] leading-4 text-text-tertiary" title={detail}>{detail}</span>}
                          {canRetryIndex && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                retrySourceIndexing(file);
                              }}
                              disabled={retryingIndex}
                              className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-surface-border bg-surface-elevated px-2 text-[11px] font-medium text-text-secondary transition hover:border-brand/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
                              title={retryNotebookIndexLabel(file, t)}
                            >
                              {retryingIndex ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                              {retryNotebookIndexLabel(file, t)}
                            </button>
                          )}
                        </div>
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
                        className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border transition", selected ? "border-[#111827] bg-[#111827] text-white" : "border-surface-border text-transparent group-hover:border-text-tertiary group-hover:text-text-tertiary")}
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
          notebookId={writableNotebookId || undefined}
          notebookTitle={notebook?.title}
          notebookFileCount={files.length}
          notebookFileIds={selectedFileIds}
          notebookHero={notebook ? {
            title: heroTitle,
            meta: `${files.length} 个来源`,
            coverClassName: heroCover.className,
            icon: heroIcon,
            imageUrl: heroCoverImageUrl,
            onCustomize: writableNotebookId ? openCustomizeDialog : undefined,
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
          modelSelectionOptions={{ storageKey: "notebook-selected-model", defaultModelId: "gpt-5.5" }}
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
        notes={studioNotes}
        activeArtifactId={activeStudioArtifactId}
        generatingType={generatingStudioType}
        selectedSourceCount={selectedFileIds.length}
        sourceFiles={studioSourceFiles}
        onGenerate={handleStudioGenerate}
        onCreateNote={handleCreateStudioNote}
        onUpdateNote={handleUpdateStudioNote}
        onOpenArtifact={setActiveStudioArtifactId}
        onRenameArtifact={handleRenameArtifact}
        onRegenerateArtifact={handleRegenerateArtifact}
        onDeleteArtifact={handleDeleteArtifact}
        onCopyArtifact={handleCopyArtifact}
        onDownloadArtifact={handleDownloadArtifact}
        onCopyTableMarkdown={handleCopyTableMarkdown}
        onPrintArtifact={handlePrintArtifact}
        onExportTableToGoogleSheets={handleExportTableToGoogleSheets}
        onExplainFlashcard={handleExplainFlashcard}
        onExplainQuiz={handleExplainQuiz}
        onOpenSource={(sourceId, target) => {
          const source = files.find((file) => file.file_id === sourceId);
          if (source) openPreview(source, target);
        }}
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
      target={previewTarget}
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
    <RenameArtifactDialog
      open={Boolean(artifactToRename)}
      artifact={artifactToRename}
      value={artifactRenameValue}
      saving={renamingArtifact}
      onChange={setArtifactRenameValue}
      onClose={closeRenameArtifactDialog}
      onConfirm={confirmRenameArtifact}
    />
    <RenameNotebookDialog
      open={renameNotebookDialogOpen}
      notebook={notebook}
      value={notebookRenameValue}
      saving={renamingNotebook}
      onChange={setNotebookRenameValue}
      onClose={closeRenameNotebookDialog}
      onConfirm={confirmRenameNotebook}
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
