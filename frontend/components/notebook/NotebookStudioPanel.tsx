"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { BarChart3, CheckCircle2, ChevronLeft, ChevronRight, ChevronsRight, Copy, Download, ExternalLink, FileQuestion, FileText, HelpCircle, Info, Lightbulb, Loader2, Map as MapIcon, Maximize2, MessageCircle, MoreHorizontal, Pencil, Presentation, Printer, RefreshCw, Sparkles, StickyNote, Trash2, X, XCircle, ZoomIn, ZoomOut } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type NotebookStudioActionId = "table" | "summary" | "faq" | "briefing" | "mindmap" | "flashcards" | "quiz" | "report" | "slides" | "infographic";

export type NotebookStudioInfographic = {
  orientation: string;
  style: string;
  detail_level: string;
  prompt: string;
  image_url: string;
  color_scheme?: Record<string, string>;
};

export type NotebookStudioTableRow = {
  module: string;
  capability: string;
  status: string;
  implementation: string;
  value: string;
  source: string;
  citations?: NotebookStudioCitation[];
};

export type NotebookStudioTextSection = {
  heading: string;
  body?: string;
  bullets?: string[];
  citations?: NotebookStudioCitation[];
};

export type NotebookStudioCitation = {
  file_id: number;
  source_index: number;
  quote: string;
  page?: number;
  chunk_index?: number;
};

export type NotebookSourceOpenTarget = {
  quote?: string;
  page?: number;
  chunkIndex?: number;
};

export type NotebookStudioMindmapNode = {
  id: string;
  label: string;
  summary?: string;
  source?: string;
};

export type NotebookStudioMindmapEdge = {
  from: string;
  to: string;
  label?: string;
};

export type NotebookStudioSource = {
  id: number;
  filename: string;
  mimeType?: string;
};

export type NotebookStudioNote = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  readonly?: boolean;
  origin?: "manual" | "chat";
};

export type NotebookStudioFlashcard = {
  front: string;
  back: string;
  source?: string;
};

export type NotebookStudioQuizOption = {
  id: "A" | "B" | "C" | "D" | string;
  text: string;
  reason?: string;
};

export type NotebookStudioQuizQuestion = {
  question: string;
  options: NotebookStudioQuizOption[];
  correct_option_id: string;
  hint: string;
  explanation: string;
  wrong_reason?: string;
};

export type NotebookStudioReportSection = {
  number: string;
  heading: string;
  body?: string;
  bullets?: string[];
  subsections?: NotebookStudioReportSection[];
  citations?: NotebookStudioCitation[];
};

export type NotebookStudioReportTable = {
  title: string;
  headers: string[];
  rows: string[][];
};

type NotebookStudioArtifactBase = {
  id: string;
  title: string;
  subtitle: string;
  createdAt: string;
  sourceCount: number;
  sourceFileIds?: number[];
};

export type NotebookStudioArtifact =
  | {
      type: "table";
      rows: NotebookStudioTableRow[];
    } & NotebookStudioArtifactBase
  | {
      type: "summary" | "faq" | "briefing";
      sections: NotebookStudioTextSection[];
    } & NotebookStudioArtifactBase
  | {
      type: "mindmap";
      nodes: NotebookStudioMindmapNode[];
      edges: NotebookStudioMindmapEdge[];
    } & NotebookStudioArtifactBase
  | {
      type: "flashcards";
      cards: NotebookStudioFlashcard[];
    } & NotebookStudioArtifactBase
  | {
      type: "quiz";
      questions: NotebookStudioQuizQuestion[];
    } & NotebookStudioArtifactBase
  | {
      type: "report";
      formatId: string;
      formatTitle: string;
      executiveSummary: string;
      sections: NotebookStudioReportSection[];
      tables: NotebookStudioReportTable[];
    } & NotebookStudioArtifactBase
  | {
      type: "infographic";
      orientation: string;
      style: string;
      detail_level: string;
      prompt: string;
      image_url: string;
      color_scheme?: Record<string, string>;
    } & NotebookStudioArtifactBase;

type NotebookStudioPanelProps = {
  width?: number;
  artifacts: NotebookStudioArtifact[];
  notes?: NotebookStudioNote[];
  activeArtifactId: string | null;
  generatingType?: NotebookStudioActionId | null;
  selectedSourceCount?: number;
  sourceFiles?: NotebookStudioSource[];
  onGenerate: (type: NotebookStudioActionId, options?: { orientation?: string; style?: string; detail_level?: string; prompt?: string }) => void;
  onCreateNote?: (note: { title: string; content: string }) => void;
  onUpdateNote?: (noteId: string, note: { title: string; content: string }) => void;
  onOpenArtifact: (artifactId: string | null) => void;
  onRenameArtifact?: (artifact: NotebookStudioArtifact) => void;
  onRegenerateArtifact?: (artifact: NotebookStudioArtifact) => void;
  onDeleteArtifact?: (artifact: NotebookStudioArtifact) => void;
  onCopyArtifact?: (artifact: NotebookStudioArtifact) => void;
  onDownloadArtifact?: (artifact: NotebookStudioArtifact) => void;
  onCopyTableMarkdown?: (artifact: Extract<NotebookStudioArtifact, { type: "table" }>) => void;
  onPrintArtifact?: (artifact: NotebookStudioArtifact) => void;
  onExportTableToGoogleSheets?: (artifact: Extract<NotebookStudioArtifact, { type: "table" }>) => void;
  onExplainFlashcard?: (card: NotebookStudioFlashcard) => void;
  onExplainQuiz?: (question: NotebookStudioQuizQuestion, selectedOptionId: string | null) => void;
  onOpenSource?: (sourceId: number, target?: NotebookSourceOpenTarget) => void;
};

type StudioIconProps = { className?: string };

type StudioIcon = ComponentType<StudioIconProps>;

function StudioReportIcon({ className }: StudioIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M6.5 4.5h8.2L18 7.8v11.7H6.5z" />
      <path d="M14.5 4.7v3.5h3.4" />
      <path d="M9 11h5.5" />
      <path d="M9 14h6" />
      <path d="M9 17h3.5" />
      <path d="M19.7 3.3l.55 1.25 1.25.55-1.25.55-.55 1.25-.55-1.25-1.25-.55 1.25-.55z" />
    </svg>
  );
}

function StudioFlashcardIcon({ className }: StudioIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M6.5 5.5h11A2.5 2.5 0 0 1 20 8v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16V8a2.5 2.5 0 0 1 2.5-2.5z" />
      <path d="M7.3 5.7v12.6" />
      <path d="m12 9.2.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 11.3l2-.3z" />
    </svg>
  );
}

function StudioTableIcon({ className }: StudioIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 10h16" />
      <path d="M4 14.5h16" />
      <path d="M9 5v14" />
      <path d="M15 10v9" />
    </svg>
  );
}

function StudioQuizIcon({ className }: StudioIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M6.2 4.8h11.6A2.2 2.2 0 0 1 20 7v10a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 17V7a2.2 2.2 0 0 1 2.2-2.2z" />
      <path d="M8 8.4h8" />
      <path d="M8 12h3.2" />
      <path d="M14.2 11.1a1.8 1.8 0 1 1 1.5 2.8" />
      <path d="M15.7 16h.01" />
      <path d="M8 15.8h3" />
    </svg>
  );
}

function StudioInfographicIcon({ className }: StudioIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="4" y="14" width="4" height="6" rx="1" />
      <rect x="10" y="8" width="4" height="12" rx="1" />
      <rect x="16" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

const actionIconMap: Record<NotebookStudioActionId, StudioIcon> = {
  table: StudioTableIcon,
  summary: FileText,
  faq: FileQuestion,
  briefing: BarChart3,
  mindmap: MapIcon,
  flashcards: StudioFlashcardIcon,
  quiz: StudioQuizIcon,
  report: StudioReportIcon,
  slides: Presentation,
  infographic: StudioInfographicIcon,
};

const artifactIconMap: Record<NotebookStudioArtifact["type"], StudioIcon> = {
  table: StudioTableIcon,
  summary: FileText,
  faq: FileQuestion,
  briefing: BarChart3,
  mindmap: MapIcon,
  flashcards: StudioFlashcardIcon,
  quiz: StudioQuizIcon,
  report: StudioReportIcon,
  infographic: StudioInfographicIcon,
};

const studioActionVisualMap: Record<NotebookStudioActionId, { iconClass: string; surfaceClass: string }> = {
  table: { iconClass: "text-emerald-600 dark:text-emerald-300", surfaceClass: "bg-indigo-50 dark:bg-indigo-950/30" },
  summary: { iconClass: "text-slate-600 dark:text-slate-300", surfaceClass: "bg-slate-50 dark:bg-slate-950/30" },
  faq: { iconClass: "text-indigo-600 dark:text-indigo-300", surfaceClass: "bg-indigo-50 dark:bg-indigo-950/30" },
  briefing: { iconClass: "text-amber-600 dark:text-amber-300", surfaceClass: "bg-amber-50 dark:bg-amber-950/30" },
  mindmap: { iconClass: "text-violet-600 dark:text-violet-300", surfaceClass: "bg-purple-50 dark:bg-purple-950/30" },
  flashcards: { iconClass: "text-pink-600 dark:text-rose-300", surfaceClass: "bg-rose-50 dark:bg-rose-950/30" },
  quiz: { iconClass: "text-purple-700 dark:text-purple-300", surfaceClass: "bg-sky-50 dark:bg-sky-950/30" },
  report: { iconClass: "text-slate-600 dark:text-slate-300", surfaceClass: "bg-yellow-50 dark:bg-yellow-950/30" },
  slides: { iconClass: "text-blue-600 dark:text-blue-300", surfaceClass: "bg-blue-50 dark:bg-blue-950/30" },
  infographic: { iconClass: "text-violet-600 dark:text-violet-300", surfaceClass: "bg-fuchsia-50 dark:bg-fuchsia-950/30" },
};

const artifactVisualMap: Record<NotebookStudioArtifact["type"], { iconClass: string; surfaceClass: string }> = {
  table: studioActionVisualMap.table,
  summary: studioActionVisualMap.summary,
  faq: studioActionVisualMap.faq,
  briefing: studioActionVisualMap.briefing,
  mindmap: studioActionVisualMap.mindmap,
  flashcards: studioActionVisualMap.flashcards,
  quiz: studioActionVisualMap.quiz,
  report: studioActionVisualMap.report,
  infographic: studioActionVisualMap.infographic,
};

const primaryStudioActionIconTone: Partial<Record<NotebookStudioActionId, string>> = {
  table: studioActionVisualMap.table.iconClass,
  flashcards: studioActionVisualMap.flashcards.iconClass,
  quiz: studioActionVisualMap.quiz.iconClass,
  report: studioActionVisualMap.report.iconClass,
  infographic: studioActionVisualMap.infographic.iconClass,
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function sourceAccent(source: NotebookStudioSource) {
  const name = source.filename.toLowerCase();
  const mime = (source.mimeType || "").toLowerCase();
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "bg-red-500/10 text-red-500";
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name)) return "bg-rose-500/10 text-rose-500";
  return "bg-blue-500/10 text-blue-500";
}

function escapeNoteHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function noteContentToHtml(value?: string) {
  const content = value || "";
  if (/<\/?[a-z][\s\S]*>/i.test(content)) return content;
  return escapeNoteHtml(content).replace(/\n/g, "<br />");
}

function noteContentPreview(value?: string) {
  if (!value) return "空笔记";
  if (typeof document === "undefined") return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "空笔记";
  const el = document.createElement("div");
  el.innerHTML = value;
  return (el.textContent || el.innerText || "").replace(/\s+/g, " ").trim() || "空笔记";
}

function NoteEditorDialog({ open, saving, initialTitle, initialContent, onClose, onSave }: { open: boolean; saving?: boolean; initialTitle?: string; initialContent?: string; onClose: () => void; onSave: (note: { title: string; content: string }) => void }) {
  const [title, setTitle] = useState(initialTitle || "新建笔记");
  const [content, setContent] = useState(noteContentToHtml(initialContent));
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const nextContent = noteContentToHtml(initialContent);
    setTitle(initialTitle || "新建笔记");
    setContent(nextContent);
    window.setTimeout(() => {
      if (editorRef.current) editorRef.current.innerHTML = nextContent;
    }, 0);
  }, [initialContent, initialTitle, open]);

  if (!open) return null;

  const syncContent = () => {
    const html = editorRef.current?.innerHTML || "";
    setContent(html);
    return html;
  };

  const runCommand = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncContent();
  };

  const insertDivider = () => {
    editorRef.current?.focus();
    document.execCommand("insertHTML", false, '<hr style="border:0;border-top:1px solid rgba(148,163,184,.45);margin:18px 0;" />');
    syncContent();
  };

  const plainContent = noteContentPreview(content);
  const canSave = title.trim() || plainContent !== "空笔记";
  const toolbarButton = "rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-hover hover:text-text-primary";
  const toolbarDivider = <span className="mx-1 h-5 w-px bg-surface-border" />;

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex h-[min(820px,90vh)] w-[min(860px,94vw)] flex-col overflow-hidden rounded-[28px] border border-surface-border bg-surface-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-border px-5 py-3">
          <div className="text-sm font-medium text-text-tertiary">Studio &gt; 笔记</div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary" title="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-7 py-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="min-w-0 flex-1 border-none bg-transparent text-[30px] font-bold leading-tight tracking-[-0.04em] text-text-primary outline-none placeholder:text-text-tertiary"
              placeholder="新建笔记"
            />
            <Trash2 className="h-5 w-5 shrink-0 text-text-tertiary" />
          </div>
          <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-1.5 rounded-2xl border border-surface-border bg-surface-elevated/95 px-3 py-2 text-xs text-text-secondary shadow-sm backdrop-blur">
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runCommand("undo"); }} className={toolbarButton}>↶</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runCommand("redo"); }} className={toolbarButton}>↷</button>
            {toolbarDivider}
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runCommand("formatBlock", "p"); }} className={toolbarButton}>正文</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runCommand("formatBlock", "h1"); }} className={toolbarButton}>标题 1</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runCommand("formatBlock", "h2"); }} className={toolbarButton}>标题 2</button>
            {toolbarDivider}
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runCommand("bold"); }} className={`${toolbarButton} font-bold`}>B</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runCommand("italic"); }} className={`${toolbarButton} italic`}>I</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runCommand("underline"); }} className={`${toolbarButton} underline`}>U</button>
            {toolbarDivider}
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runCommand("insertUnorderedList"); }} className={toolbarButton}>• 列表</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runCommand("insertOrderedList"); }} className={toolbarButton}>1. 列表</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runCommand("formatBlock", "blockquote"); }} className={toolbarButton}>引用</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); insertDivider(); }} className={toolbarButton}>分割线</button>
            {toolbarDivider}
            <button type="button" onMouseDown={(event) => { event.preventDefault(); runCommand("removeFormat"); }} className={toolbarButton}>清除格式</button>
          </div>
          <div className="relative rounded-3xl border border-surface-border bg-surface px-5 py-5 shadow-inner">
            {plainContent === "空笔记" && (
              <div className="pointer-events-none absolute left-5 top-5 text-[15px] leading-7 text-text-tertiary">
                在此笔记中撰写或粘贴文本。支持标题、列表、引用、加粗等富文本格式。
              </div>
            )}
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={syncContent}
              onBlur={syncContent}
              className="notebook-note-editor min-h-[440px] max-w-none text-[15px] leading-7 text-text-primary outline-none [&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-brand/40 [&_blockquote]:pl-4 [&_blockquote]:text-text-secondary [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-surface-border px-5 py-3">
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <Info className="h-4 w-4" />
            <span>每个笔记本最多可以创建 1,000 条笔记。</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-hover disabled:opacity-60">取消</button>
            <button type="button" onClick={() => canSave && onSave({ title: title.trim() || "未命名笔记", content: syncContent() })} disabled={saving || !canSave} className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#1f2937] disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              保存笔记
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourcePopover({ sources, title, emptyLabel, onOpenSource }: { sources: NotebookStudioSource[]; title: string; emptyLabel: string; onOpenSource?: (sourceId: number, target?: NotebookSourceOpenTarget) => void }) {
  return (
    <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-2xl border border-surface-border bg-surface-card p-3 text-left shadow-2xl">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
        <FileText className="h-4 w-4 text-text-tertiary" />
        <span>{title}</span>
      </div>
      {sources.length ? (
        <div className="space-y-1.5">
          {sources.map((source) => (
            <button key={source.id} type="button" onClick={() => onOpenSource?.(source.id)} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-xs text-text-secondary hover:bg-surface-hover">
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", sourceAccent(source))}><FileText className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{source.filename}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-surface-elevated px-3 py-2 text-xs text-text-tertiary">{emptyLabel}</div>
      )}
    </div>
  );
}

function CitationMarkers({ citations, onOpenSource }: { citations?: NotebookStudioCitation[]; onOpenSource?: (sourceId: number, target?: NotebookSourceOpenTarget) => void }) {
  const clean = (citations || []).filter((citation) => Number.isFinite(citation.file_id) && citation.file_id > 0);
  if (!clean.length) return null;
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-middle">
      {clean.map((citation, index) => (
        <button
          key={`${citation.file_id}-${citation.source_index}-${index}`}
          type="button"
          onClick={() => onOpenSource?.(citation.file_id, { quote: citation.quote, page: citation.page, chunkIndex: citation.chunk_index })}
          title={citation.quote}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-brand/20 bg-brand/10 px-1.5 text-[10px] font-semibold leading-none text-brand transition hover:border-brand/40 hover:bg-brand/15"
        >
          [{citation.source_index || index + 1}]
        </button>
      ))}
    </span>
  );
}

function renderTextArtifact(artifact: Extract<NotebookStudioArtifact, { type: "summary" | "faq" | "briefing" }>, onOpenSource?: (sourceId: number, target?: NotebookSourceOpenTarget) => void) {
  return (
    <div className="space-y-3 p-4">
      {artifact.sections.map((section, index) => (
        <section key={`${section.heading}-${index}`} className="rounded-2xl border border-surface-border bg-surface-elevated/60 p-3">
          <h4 className="text-sm font-semibold text-text-primary">{section.heading}<CitationMarkers citations={section.citations} onOpenSource={onOpenSource} /></h4>
          {section.body && <p className="mt-2 text-xs leading-5 text-text-secondary">{section.body}</p>}
          {section.bullets?.length ? (
            <ul className="mt-2 space-y-1.5 text-xs leading-5 text-text-secondary">
              {section.bullets.map((bullet, bulletIndex) => (
                <li key={bulletIndex} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function renderTableArtifact(artifact: Extract<NotebookStudioArtifact, { type: "table" }>, t: (key: string, params?: Record<string, string>) => string, expanded = false, onOpenSource?: (sourceId: number, target?: NotebookSourceOpenTarget) => void) {
  return (
    <div className={cn("relative overflow-auto border border-surface-border bg-surface-card", expanded ? "min-h-0 flex-1 rounded-lg shadow-none" : "max-h-[460px] rounded-2xl shadow-sm")}>
      <table className={cn("border-separate border-spacing-0 table-fixed text-left", expanded ? "min-w-[1180px] text-[13px]" : "min-w-[980px] text-xs")}>
        <thead className="sticky top-0 z-20 bg-surface-elevated text-text-primary shadow-[0_1px_0_var(--surface-border)]">
          <tr>
            <th className={cn("w-[180px] border-b border-surface-border bg-surface-elevated font-semibold leading-5 align-middle", expanded ? "px-5 py-4 text-[13px]" : "px-4 py-3.5")}>{t("notebook.studio.columnModule")}</th>
            <th className={cn("w-[300px] border-b border-surface-border bg-surface-elevated font-semibold leading-5 align-middle", expanded ? "px-5 py-4 text-[13px]" : "px-4 py-3.5")}>{t("notebook.studio.columnCapability")}</th>
            <th className={cn("w-[72px] border-b border-surface-border bg-surface-elevated text-center font-semibold leading-5 align-middle", expanded ? "px-3 py-4 text-[13px]" : "px-3 py-3.5")}>{t("notebook.studio.columnStatus")}</th>
            <th className={cn("w-[260px] border-b border-surface-border bg-surface-elevated font-semibold leading-5 align-middle", expanded ? "px-5 py-4 text-[13px]" : "px-4 py-3.5")}>{t("notebook.studio.columnImplementation")}</th>
            <th className={cn("w-[240px] border-b border-surface-border bg-surface-elevated font-semibold leading-5 align-middle", expanded ? "px-5 py-4 text-[13px]" : "px-4 py-3.5")}>{t("notebook.studio.columnValue")}</th>
            <th className={cn("w-[128px] border-b border-surface-border bg-surface-elevated font-semibold leading-5 align-middle", expanded ? "px-5 py-4 text-[13px]" : "px-4 py-3.5")}>{t("notebook.studio.columnSource")}</th>
          </tr>
        </thead>
        <tbody>
          {artifact.rows.map((row, index) => (
            <tr key={`${row.module}-${index}`} className="align-top hover:bg-surface-hover/60">
              <td className={cn("break-words border-b border-surface-border bg-surface-card font-semibold text-text-primary align-top", expanded ? "px-5 py-5 leading-6" : "px-4 py-4 leading-5")}>{row.module}</td>
              <td className={cn("break-words border-b border-surface-border bg-surface-card text-text-secondary align-top", expanded ? "px-5 py-5 leading-6" : "px-4 py-4 leading-5")}>{row.capability}</td>
              <td className={cn("break-words border-b border-surface-border bg-surface-card text-center font-medium text-text-secondary align-top", expanded ? "px-3 py-5 leading-6" : "px-3 py-4 leading-5")}>{row.status}</td>
              <td className={cn("break-words border-b border-surface-border bg-surface-card text-text-secondary align-top", expanded ? "px-5 py-5 leading-6" : "px-4 py-4 leading-5")}>{row.implementation}</td>
              <td className={cn("break-words border-b border-surface-border bg-surface-card text-text-secondary align-top", expanded ? "px-5 py-5 leading-6" : "px-4 py-4 leading-5")}>{row.value}</td>
              <td className={cn("break-words border-b border-surface-border bg-surface-card font-medium text-brand align-top", expanded ? "px-5 py-5 leading-6" : "px-4 py-4 leading-5")}>
                {row.citations?.length ? <CitationMarkers citations={row.citations} onOpenSource={onOpenSource} /> : row.source}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderReportArtifact(artifact: Extract<NotebookStudioArtifact, { type: "report" }>, expanded = false, onOpenSource?: (sourceId: number, target?: NotebookSourceOpenTarget) => void) {
  return (
    <div className={cn("mx-auto w-full", expanded ? "max-w-[920px] py-6" : "max-w-[760px] p-4")}>
      <article className="rounded-[28px] border border-slate-200 bg-white px-8 py-9 text-slate-900 shadow-[0_24px_70px_rgba(15,23,42,0.10)] dark:border-surface-border dark:bg-surface-card dark:text-text-primary">
        <div className="mb-8 text-center">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-text-tertiary">{artifact.formatTitle || "Report"}</div>
          <h1 className="text-balance text-3xl font-bold tracking-[-0.035em] text-slate-950 dark:text-text-primary">{artifact.title}</h1>
          {artifact.subtitle && <p className="mt-3 text-sm text-slate-500 dark:text-text-secondary">{artifact.subtitle}</p>}
        </div>
        <section className="mb-7">
          <h2 className="mb-3 text-[15px] font-bold text-slate-950 dark:text-text-primary">Executive Summary</h2>
          <p className="text-[14px] leading-7 text-slate-700 dark:text-text-secondary">{artifact.executiveSummary}</p>
        </section>
        <div className="my-7 border-t border-dashed border-slate-300 dark:border-surface-border" />
        <div className="space-y-7">
          {artifact.sections.map((section, index) => (
            <section key={`${section.number}-${section.heading}-${index}`}>
              <h2 className="mb-2 text-[18px] font-bold tracking-[-0.015em] text-slate-950 dark:text-text-primary">
                {section.number ? `${section.number}. ` : ""}{section.heading}
                <CitationMarkers citations={section.citations} onOpenSource={onOpenSource} />
              </h2>
              {section.body && <p className="text-[14px] leading-7 text-slate-700 dark:text-text-secondary">{section.body}</p>}
              {section.bullets?.length ? (
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[14px] leading-7 text-slate-700 dark:text-text-secondary">
                  {section.bullets.map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}
                </ul>
              ) : null}
              {section.subsections?.length ? (
                <div className="mt-4 space-y-4">
                  {section.subsections.map((subsection, subIndex) => (
                    <div key={`${subsection.number}-${subsection.heading}-${subIndex}`}>
                      <h3 className="mb-1.5 text-[15px] font-bold text-slate-900 dark:text-text-primary">
                        {subsection.number ? `${subsection.number}. ` : ""}{subsection.heading}
                        <CitationMarkers citations={subsection.citations} onOpenSource={onOpenSource} />
                      </h3>
                      {subsection.body && <p className="text-[14px] leading-7 text-slate-700 dark:text-text-secondary">{subsection.body}</p>}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
        {artifact.tables.length ? (
          <div className="mt-8 space-y-6">
            {artifact.tables.map((table, tableIndex) => (
              <section key={`${table.title}-${tableIndex}`}>
                <h2 className="mb-3 text-[17px] font-bold tracking-[-0.015em] text-slate-950 dark:text-text-primary">{table.title}</h2>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-surface-border">
                  <table className="min-w-full border-collapse text-left text-[13px]">
                    <thead className="bg-slate-50 text-slate-900 dark:bg-surface-elevated dark:text-text-primary">
                      <tr>{table.headers.map((header) => <th key={header} className="border-b border-slate-200 px-4 py-3 font-semibold dark:border-surface-border">{header}</th>)}</tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="align-top">
                          {row.map((cell, cellIndex) => <td key={cellIndex} className="border-b border-slate-100 px-4 py-3 leading-6 text-slate-700 last:border-b-0 dark:border-surface-border dark:text-text-secondary">{cell}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </article>
    </div>
  );
}

function cleanFlashcardDisplayText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[\[【]\d+[\]】]\s*/, "")
    .replace(/\s*[\[【]\d+[\]】]\s*/g, " ")
    .replace(/^(?:\d+(?:\.\d+)*|[一二三四五六七八九十]+)[、.)．]?\s*/, "")
    .trim()
    .replace(/^[\-—：:，,。；;·|\[\]【】（）()\s]+|[\-—：:，,。；;·|\[\]【】（）()\s]+$/g, "");
}

function FlashcardsArtifactView({ artifact, t, onExplain }: { artifact: Extract<NotebookStudioArtifact, { type: "flashcards" }>; t: (key: string, params?: Record<string, string>) => string; onExplain?: (card: NotebookStudioFlashcard) => void }) {
  const [index, setIndex] = useState(0);
  const [answerVisible, setAnswerVisible] = useState(false);
  const [known, setKnown] = useState<Record<number, boolean | null>>({});
  const [reviewOnlyWrong, setReviewOnlyWrong] = useState(false);
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState<"wrong" | "right" | null>(null);
  const total = artifact.cards.length;
  const progressStorageKey = `notebook-flashcard-progress:${artifact.id}:${total}`;
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(progressStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Record<string, boolean | null>;
      const next: Record<number, boolean | null> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        const cardIndex = Number(key);
        if (Number.isInteger(cardIndex) && cardIndex >= 0 && cardIndex < total && (value === true || value === false)) {
          next[cardIndex] = value;
        }
      });
      setKnown(next);
    } catch {
      setKnown({});
    }
  }, [progressStorageKey, total]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (Object.keys(known).length === 0) {
        window.localStorage.removeItem(progressStorageKey);
      } else {
        window.localStorage.setItem(progressStorageKey, JSON.stringify(known));
      }
    } catch {}
  }, [known, progressStorageKey]);
  const rawCard = artifact.cards[Math.min(index, Math.max(total - 1, 0))];
  const card = rawCard ? { ...rawCard, front: cleanFlashcardDisplayText(rawCard.front), back: cleanFlashcardDisplayText(rawCard.back), source: "" } : undefined;
  const wrongCount = Object.values(known).filter((value) => value === false).length;
  const rightCount = Object.values(known).filter((value) => value === true).length;
  const reviewedCount = wrongCount + rightCount;
  const reviewQueue = useMemo(() => Array.from({ length: total }, (_, cardIndex) => cardIndex).filter((cardIndex) => known[cardIndex] === false), [known, total]);
  useEffect(() => {
    if (!reviewOnlyWrong) return;
    if (!reviewQueue.length) {
      setReviewOnlyWrong(false);
      return;
    }
    if (!reviewQueue.includes(index)) {
      setIndex(reviewQueue[0]);
      setAnswerVisible(false);
    }
  }, [index, reviewOnlyWrong, reviewQueue]);
  const resetProgress = () => {
    setKnown({});
    setReviewOnlyWrong(false);
    setAnswerVisible(false);
    setReviewFeedback(null);
    setSlideDirection(null);
    setIndex(0);
  };
  const getQueuedIndex = (direction: "left" | "right", candidateQueue = reviewQueue) => {
    if (!candidateQueue.length) return index;
    const queuePosition = candidateQueue.indexOf(index);
    if (queuePosition === -1) return candidateQueue[0];
    const nextPosition = direction === "left" ? queuePosition + 1 : queuePosition - 1;
    return candidateQueue[(nextPosition + candidateQueue.length) % candidateQueue.length];
  };
  const go = (next: number, direction: "left" | "right" = next > index ? "left" : "right") => {
    if (!total) return;
    const targetIndex = reviewOnlyWrong ? getQueuedIndex(direction) : (next + total) % total;
    setReviewFeedback(null);
    setSlideDirection(direction);
    setIndex(targetIndex);
    setAnswerVisible(false);
    window.setTimeout(() => setSlideDirection(null), 260);
  };
  const toggleReviewOnlyWrong = () => {
    if (reviewOnlyWrong) {
      setReviewOnlyWrong(false);
      return;
    }
    if (!reviewQueue.length) return;
    setReviewOnlyWrong(true);
    setIndex(reviewQueue[0]);
    setAnswerVisible(false);
  };
  const review = (value: boolean) => {
    if (!total || reviewFeedback) return;
    const nextKnown = { ...known, [index]: value };
    const nextQueue = Array.from({ length: total }, (_, cardIndex) => cardIndex).filter((cardIndex) => nextKnown[cardIndex] === false);
    const targetIndex = reviewOnlyWrong
      ? (nextQueue.length ? getQueuedIndex("left", nextQueue) : 0)
      : (index + 1) % total;
    setKnown(nextKnown);
    setReviewFeedback(value ? "right" : "wrong");
    setAnswerVisible(false);
    setSlideDirection(value ? "left" : "right");
    window.setTimeout(() => {
      if (reviewOnlyWrong && !nextQueue.length) setReviewOnlyWrong(false);
      setIndex(targetIndex);
      setReviewFeedback(null);
      setSlideDirection(null);
    }, 520);
  };
  if (!card) return <div className="rounded-2xl border border-surface-border bg-surface-elevated p-4 text-sm text-text-tertiary">{t("notebook.studio.flashcardsEmpty")}</div>;
  return (
    <div className="flex min-h-[540px] flex-1 flex-col items-center justify-center gap-5 px-3 py-5">
      <style>{`
        @keyframes notebookFlashcardSlideLeft { from { opacity: 0; transform: translateX(28px) scale(.985); } to { opacity: 1; transform: translateX(0) scale(1); } }
        @keyframes notebookFlashcardSlideRight { from { opacity: 0; transform: translateX(-28px) scale(.985); } to { opacity: 1; transform: translateX(0) scale(1); } }
        @keyframes notebookFlashcardReviewWrong { 0% { opacity: 0; transform: translateX(-22px) rotate(-2deg) scale(.985); } 45% { opacity: 1; transform: translateX(0) rotate(4deg) scale(1); } 100% { opacity: 0; transform: translateX(72px) rotate(9deg) scale(.96); } }
        @keyframes notebookFlashcardReviewRight { 0% { opacity: 0; transform: translateX(22px) rotate(2deg) scale(.985); } 45% { opacity: 1; transform: translateX(0) rotate(-4deg) scale(1); } 100% { opacity: 0; transform: translateX(-72px) rotate(-9deg) scale(.96); } }
        .notebook-flashcard-perspective { perspective: 1200px; }
        .notebook-flashcard-inner { transform-style: preserve-3d; }
        .notebook-flashcard-face { backface-visibility: hidden; -webkit-backface-visibility: hidden; }
        .notebook-flashcard-back { transform: rotateY(180deg); }
      `}</style>
      <div className="flex w-full max-w-[480px] flex-wrap items-center justify-between gap-3 rounded-2xl border border-surface-border bg-surface-card/90 px-4 py-3 text-xs text-text-secondary shadow-sm">
        <span>{t("notebook.studio.flashcardProgress", { reviewed: String(reviewedCount), total: String(total), known: String(rightCount), review: String(wrongCount) })}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleReviewOnlyWrong} disabled={!wrongCount || Boolean(reviewFeedback)} className={cn("rounded-full border px-3 py-1.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50", reviewOnlyWrong ? "border-red-500/30 bg-red-500/10 text-red-500" : "border-surface-border text-text-secondary hover:bg-surface-elevated")}>
            {reviewOnlyWrong ? t("notebook.studio.reviewAllFlashcards") : t("notebook.studio.reviewWrongFlashcards")}
          </button>
          <button type="button" onClick={resetProgress} disabled={!reviewedCount || Boolean(reviewFeedback)} className="rounded-full border border-surface-border px-3 py-1.5 font-semibold text-text-secondary transition hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-50">
            {t("notebook.studio.resetFlashcards")}
          </button>
        </div>
      </div>
      <div className="w-full max-w-[480px] rounded-[34px] border border-surface-border bg-surface-elevated/80 p-3 shadow-sm">
        <div
          key={index}
          className={cn(
            "notebook-flashcard-perspective relative aspect-[1.18/1] min-h-[330px] w-full",
            reviewFeedback === "wrong" && "animate-[notebookFlashcardReviewWrong_520ms_cubic-bezier(.22,1,.36,1)_both]",
            reviewFeedback === "right" && "animate-[notebookFlashcardReviewRight_520ms_cubic-bezier(.22,1,.36,1)_both]",
            !reviewFeedback && slideDirection === "left" && "animate-[notebookFlashcardSlideLeft_260ms_cubic-bezier(.22,1,.36,1)_both]",
            !reviewFeedback && slideDirection === "right" && "animate-[notebookFlashcardSlideRight_260ms_cubic-bezier(.22,1,.36,1)_both]"
          )}
        >
          {reviewFeedback && (
            <div
              className={cn(
                "absolute inset-0 z-10 flex items-center justify-center rounded-[30px] border p-6 text-center shadow-[0_18px_45px_rgba(15,23,42,0.12)]",
                reviewFeedback === "wrong" ? "border-red-500/20 bg-red-500/10 text-red-500" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-500"
              )}
            >
              <div className="text-3xl font-bold tracking-[-0.03em]">{reviewFeedback === "wrong" ? "再接再厉" : "知道了"}</div>
            </div>
          )}
          <div className={cn("notebook-flashcard-inner absolute inset-0 rounded-[30px] transition-all duration-300 ease-[cubic-bezier(.22,1,.36,1)]", answerVisible && "[transform:rotateY(180deg)]", reviewFeedback && "opacity-0")}>
            <div className="notebook-flashcard-face absolute inset-0 flex flex-col rounded-[30px] border border-surface-border bg-surface-card p-6 shadow-[0_18px_45px_rgba(15,23,42,0.10)] dark:shadow-[0_18px_45px_rgba(0,0,0,0.35)]">
              <div className="flex items-center justify-between text-sm font-semibold text-text-tertiary">
                <span>{index + 1}/{total}</span>
                {known[index] != null && <span className={cn("rounded-full px-2 py-0.5 text-[11px]", known[index] ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500")}>{known[index] ? t("notebook.studio.known") : t("notebook.studio.unknown")}</span>}
              </div>
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-6 text-center">
                <div className="max-h-full overflow-y-auto px-1 text-balance text-[22px] font-semibold leading-8 tracking-[-0.02em] text-text-primary [scrollbar-width:thin]">
                  {card.front}
                </div>
              </div>
              <button type="button" onClick={() => setAnswerVisible(true)} className="mx-auto rounded-full bg-brand px-7 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-hover">
                {t("notebook.studio.showAnswer")}
              </button>
            </div>
            <div className="notebook-flashcard-face notebook-flashcard-back absolute inset-0 flex flex-col rounded-[30px] border border-brand/25 bg-brand-muted/25 p-6 shadow-[0_18px_45px_rgba(15,23,42,0.10)] dark:bg-surface-card dark:shadow-[0_18px_45px_rgba(0,0,0,0.35)]">
              <div className="flex items-center justify-between text-sm font-semibold text-text-tertiary">
                <span>{index + 1}/{total}</span>
                <span className="rounded-full bg-brand-muted px-2.5 py-1 text-[11px] font-semibold text-brand">Answer</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-6 text-center">
                <div className="max-h-full overflow-y-auto px-1 text-balance text-xl font-semibold leading-8 tracking-[-0.01em] text-text-primary [scrollbar-width:thin]">
                  {card.back}
                </div>
              </div>
              <div className="flex justify-center gap-2">
                <button type="button" onClick={() => setAnswerVisible(false)} className="rounded-full border border-surface-border bg-surface-card px-4 py-2.5 text-sm font-semibold text-text-secondary transition hover:bg-surface-hover">
                  {t("notebook.studio.hideAnswer")}
                </button>
                <button type="button" onClick={() => onExplain?.(card)} className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover">
                  {t("notebook.studio.explainFlashcard")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-full border border-surface-border bg-surface-card/95 p-2 shadow-sm">
        <button type="button" onClick={() => go(index - 1)} disabled={Boolean(reviewFeedback)} className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface-elevated hover:text-text-primary disabled:opacity-50"><ChevronLeft className="h-5 w-5" /></button>
        <button type="button" onClick={() => review(false)} disabled={Boolean(reviewFeedback)} className="flex h-11 min-w-16 items-center justify-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-4 text-sm font-bold text-red-500 transition hover:bg-red-500/15 disabled:opacity-60">
          <XCircle className="h-5 w-5" />
          <span>{wrongCount}</span>
        </button>
        <button type="button" onClick={() => review(true)} disabled={Boolean(reviewFeedback)} className="flex h-11 min-w-16 items-center justify-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 text-sm font-bold text-emerald-500 transition hover:bg-emerald-500/15 disabled:opacity-60">
          <span>{rightCount}</span>
          <CheckCircle2 className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => go(index + 1)} disabled={Boolean(reviewFeedback)} className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface-elevated hover:text-text-primary disabled:opacity-50"><ChevronRight className="h-5 w-5" /></button>
      </div>
    </div>
  );
}

type MindmapBranch = NotebookStudioMindmapNode & { children: MindmapBranch[] };
type MindmapLayoutNode = MindmapBranch & { depth: number; x: number; y: number; width: number; height: number };
type MindmapConnector = { from: MindmapLayoutNode; to: MindmapLayoutNode };

const MINDMAP_NODE_WIDTH = 236;
const MINDMAP_NODE_HEIGHT = 48;
const MINDMAP_COLUMN_GAP = 170;
const MINDMAP_ROW_GAP = 24;

function buildMindmapTree(artifact: Extract<NotebookStudioArtifact, { type: "mindmap" }>) {
  const nodes = new Map(artifact.nodes.map((node) => [node.id, { ...node, children: [] as MindmapBranch[] }]));
  const root = nodes.get("root") || nodes.values().next().value;
  artifact.edges.forEach((edge) => {
    const parent = nodes.get(edge.from);
    const child = nodes.get(edge.to);
    if (parent && child && parent.id !== child.id) parent.children.push(child);
  });
  return root as MindmapBranch | undefined;
}

function getDefaultExpandedMindmapIds(root: MindmapBranch) {
  return new Set([root.id]);
}

function getVisibleMindmapTree(node: MindmapBranch, expandedIds: Set<string>): MindmapBranch {
  const showChildren = expandedIds.has(node.id);
  return {
    ...node,
    children: showChildren ? node.children.map((child) => getVisibleMindmapTree(child, expandedIds)) : [],
  };
}

function layoutMindmap(root: MindmapBranch) {
  const nodes: MindmapLayoutNode[] = [];
  const connectors: MindmapConnector[] = [];
  const leafCursor = { value: 0 };

  const walk = (node: MindmapBranch, depth: number): MindmapLayoutNode => {
    const layoutNode: MindmapLayoutNode = {
      ...node,
      depth,
      x: depth * (MINDMAP_NODE_WIDTH + MINDMAP_COLUMN_GAP),
      y: 0,
      width: MINDMAP_NODE_WIDTH,
      height: MINDMAP_NODE_HEIGHT,
    };
    if (!node.children.length) {
      layoutNode.y = leafCursor.value * (MINDMAP_NODE_HEIGHT + MINDMAP_ROW_GAP);
      leafCursor.value += 1;
    } else {
      const childLayouts = node.children.map((child) => walk(child, depth + 1));
      childLayouts.forEach((childLayout) => connectors.push({ from: layoutNode, to: childLayout }));
      const firstChild = childLayouts[0];
      const lastChild = childLayouts[childLayouts.length - 1];
      layoutNode.y = firstChild && lastChild ? (firstChild.y + lastChild.y) / 2 : leafCursor.value * (MINDMAP_NODE_HEIGHT + MINDMAP_ROW_GAP);
    }
    nodes.push(layoutNode);
    return layoutNode;
  };

  walk(root, 0);
  const maxX = Math.max(...nodes.map((node) => node.x + node.width), MINDMAP_NODE_WIDTH);
  const maxY = Math.max(...nodes.map((node) => node.y + node.height), MINDMAP_NODE_HEIGHT);
  const padding = { left: 80, top: 72, right: 160, bottom: 80 };
  return {
    nodes,
    connectors,
    width: maxX + padding.left + padding.right,
    height: maxY + padding.top + padding.bottom,
    padding,
  };
}

function MindmapArtifactView({ artifact, onDownload }: { artifact: Extract<NotebookStudioArtifact, { type: "mindmap" }>; onDownload?: (artifact: NotebookStudioArtifact) => void }) {
  const root = useMemo(() => buildMindmapTree(artifact), [artifact]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!root) return;
    setExpandedIds(getDefaultExpandedMindmapIds(root));
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [root?.id]);

  const visibleRoot = useMemo(() => (root ? getVisibleMindmapTree(root, expandedIds) : null), [root, expandedIds]);
  const layout = useMemo(() => (visibleRoot ? layoutMindmap(visibleRoot) : null), [visibleRoot]);
  if (!root || !visibleRoot || !layout) return null;

  const fullNodeById = new Map<string, MindmapBranch>();
  const allExpandableIds: string[] = [];
  const collect = (node: MindmapBranch) => {
    fullNodeById.set(node.id, node);
    if (node.children.length) allExpandableIds.push(node.id);
    node.children.forEach(collect);
  };
  collect(root);

  const toggleNode = (nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const expandAll = () => setExpandedIds(new Set(allExpandableIds));

  const zoomAtViewportPoint = (nextScale: number, anchorX: number, anchorY: number) => {
    const clampedScale = Math.min(1.8, Math.max(0.5, nextScale));
    setPan((currentPan) => {
      const canvasAnchorX = (anchorX - currentPan.x) / scale;
      const canvasAnchorY = (anchorY - currentPan.y) / scale;
      return {
        x: anchorX - canvasAnchorX * clampedScale,
        y: anchorY - canvasAnchorY * clampedScale,
      };
    });
    setScale(clampedScale);
  };

  const zoomAtCenter = (nextScale: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      setScale(Math.min(1.8, Math.max(0.5, nextScale)));
      return;
    }
    const rect = viewport.getBoundingClientRect();
    zoomAtViewportPoint(nextScale, rect.width / 2, rect.height / 2);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const anchorX = event.clientX - rect.left;
    const anchorY = event.clientY - rect.top;
    const zoomStep = Math.max(-0.25, Math.min(0.25, -event.deltaY / 900));
    zoomAtViewportPoint(scale + zoomStep, anchorX, anchorY);
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startPanX: pan.x, startPanY: pan.y };
    setDragging(true);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setPan({ x: drag.startPanX + event.clientX - drag.startX, y: drag.startPanY + event.clientY - drag.startY });
  };

  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
    }
  };

  return (
    <div
      ref={viewportRef}
      className={cn("relative min-h-0 flex-1 overflow-hidden rounded-xl border border-surface-border bg-[#f8fafc] p-0 touch-none select-none dark:bg-surface-card", dragging ? "cursor-grabbing" : "cursor-grab")}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onWheel={handleWheel}
    >
      <style>{`
        @keyframes notebookMindmapNodeEnter {
          from { opacity: 0; transform: translateX(-12px) scale(0.94); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes notebookMindmapConnectorEnter {
          from { opacity: 0; stroke-dasharray: 10 10; stroke-dashoffset: 18; }
          to { opacity: 1; stroke-dasharray: 0 0; stroke-dashoffset: 0; }
        }
        .notebook-mindmap-node-enter { animation: notebookMindmapNodeEnter 260ms ease-out both; }
        .notebook-mindmap-connector-enter { animation: notebookMindmapConnectorEnter 300ms ease-out both; }
      `}</style>
      <div className="absolute left-3 top-3 z-10 flex flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-card/95 shadow-sm ">
        <button className="p-2 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" type="button" onClick={expandAll} title="Expand all"><ChevronsRight className="h-3.5 w-3.5" /></button>
        <button className="border-t border-surface-border p-2 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" type="button" onClick={() => zoomAtCenter(scale + 0.15)} title="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></button>
        <button className="border-t border-surface-border p-2 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" type="button" onClick={() => zoomAtCenter(scale - 0.15)} title="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></button>
        <button className="border-t border-surface-border p-2 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" type="button" onClick={() => onDownload?.(artifact)} title="Download"><Download className="h-3.5 w-3.5" /></button>
      </div>
      <div
        className="absolute left-0 top-0 transition-[width,height] duration-300 ease-out"
        style={{ width: layout.width, height: layout.height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: "0 0" }}
      >
        <svg className="pointer-events-none absolute inset-0" width={layout.width} height={layout.height} aria-hidden="true">
          {layout.connectors.map(({ from, to }) => {
            const startX = layout.padding.left + from.x + from.width;
            const startY = layout.padding.top + from.y + from.height / 2;
            const endX = layout.padding.left + to.x;
            const endY = layout.padding.top + to.y + to.height / 2;
            const mid = Math.max(70, (endX - startX) * 0.48);
            return <path key={`${from.id}-${to.id}`} className="notebook-mindmap-connector-enter transition-all duration-300 ease-out" d={`M ${startX} ${startY} C ${startX + mid} ${startY}, ${endX - mid} ${endY}, ${endX} ${endY}`} fill="none" stroke="rgba(99, 102, 241, 0.28)" strokeWidth="2" />;
          })}
        </svg>
        {layout.nodes.map((node) => {
          const fullNode = fullNodeById.get(node.id);
          return <MindmapCanvasNode key={node.id} node={node} fullNode={fullNode || node} offset={layout.padding} expanded={expandedIds.has(node.id)} onToggle={toggleNode} />;
        })}
      </div>
    </div>
  );
}

function MindmapCanvasNode({ node, fullNode, offset, expanded, onToggle }: { node: MindmapLayoutNode; fullNode: MindmapBranch; offset: { left: number; top: number }; expanded: boolean; onToggle: (nodeId: string) => void }) {
  const hasChildren = fullNode.children.length > 0;
  const palette = node.depth === 0
    ? "border-indigo-200 bg-indigo-100 text-indigo-950"
    : node.depth === 1
      ? "border-sky-200 bg-sky-100 text-sky-950"
      : "border-emerald-200 bg-emerald-100 text-emerald-950";
  const style: CSSProperties = {
    left: offset.left + node.x,
    top: offset.top + node.y,
    width: node.width,
    minHeight: node.height,
  };
  return (
    <div className={cn("notebook-mindmap-node-enter absolute flex items-center justify-center rounded-2xl border px-4 py-2.5 text-center shadow-sm transition-all duration-300 ease-out", palette)} style={style}>
      <div className={cn("font-semibold leading-5", node.depth === 0 ? "text-[15px]" : "text-[13px]")}>{node.label}</div>
      {hasChildren && (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onToggle(node.id); }}
          className="absolute -right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-surface-border bg-surface-card text-indigo-500 shadow-sm transition hover:scale-105 hover:text-indigo-700 "
          aria-label={expanded ? "Collapse mind map branch" : "Expand mind map branch"}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-300", expanded && "rotate-90")} />
        </button>
      )}
    </div>
  );
}

function QuizArtifactView({ artifact, t, onExplain }: { artifact: Extract<NotebookStudioArtifact, { type: "quiz" }>; t: (key: string, params?: Record<string, string>) => string; onExplain?: (question: NotebookStudioQuizQuestion, selectedOptionId: string | null) => void }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [hintOpen, setHintOpen] = useState(false);
  const [retryQueue, setRetryQueue] = useState<number[]>([]);
  const total = artifact.questions.length;
  const progressStorageKey = `notebook-quiz-progress:${artifact.id}:${total}`;
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(progressStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Record<string, string>;
      const next: Record<number, string> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        const questionIndex = Number(key);
        const optionIds = artifact.questions[questionIndex]?.options.map((option) => option.id) || [];
        if (Number.isInteger(questionIndex) && questionIndex >= 0 && questionIndex < total && optionIds.includes(value)) {
          next[questionIndex] = value;
        }
      });
      setAnswers(next);
    } catch {
      setAnswers({});
    }
  }, [artifact.questions, progressStorageKey, total]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (Object.keys(answers).length === 0) {
        window.localStorage.removeItem(progressStorageKey);
      } else {
        window.localStorage.setItem(progressStorageKey, JSON.stringify(answers));
      }
    } catch {}
  }, [answers, progressStorageKey]);
  const question = artifact.questions[Math.min(index, Math.max(total - 1, 0))];
  const selected = answers[index] || null;
  const correctId = question?.correct_option_id;
  const selectedOption = question?.options.find((option) => option.id === selected);
  const correctOption = question?.options.find((option) => option.id === correctId);
  const answered = Boolean(selected);
  const isCorrect = selected === correctId;
  const answeredCount = Object.keys(answers).length;
  const correctCount = Object.entries(answers).filter(([key, value]) => artifact.questions[Number(key)]?.correct_option_id === value).length;
  const wrongIndexes = useMemo(() => Object.entries(answers).flatMap(([key, value]) => {
    const questionIndex = Number(key);
    return artifact.questions[questionIndex]?.correct_option_id && artifact.questions[questionIndex].correct_option_id !== value ? [questionIndex] : [];
  }), [answers, artifact.questions]);
  const wrongCount = wrongIndexes.length;
  const retryMode = retryQueue.length > 0;
  useEffect(() => {
    if (!retryMode) return;
    if (!retryQueue.includes(index)) {
      setIndex(retryQueue[0]);
      setHintOpen(false);
    }
  }, [index, retryMode, retryQueue]);
  const truncateText = (value: string) => (value.length > 95 ? `${value.slice(0, 92)}…` : value);
  const getRetryTarget = (direction: "next" | "previous") => {
    if (!retryQueue.length) return index;
    const queuePosition = retryQueue.indexOf(index);
    if (queuePosition === -1) return retryQueue[0];
    const nextPosition = direction === "next" ? queuePosition + 1 : queuePosition - 1;
    return retryQueue[(nextPosition + retryQueue.length) % retryQueue.length];
  };
  const goTo = (next: number) => {
    if (!total) return;
    const direction = next > index ? "next" : "previous";
    setIndex(retryMode ? getRetryTarget(direction) : (next + total) % total);
    setHintOpen(false);
  };
  const chooseOption = (optionId: string) => {
    if (answered) return;
    const nextAnswers = { ...answers, [index]: optionId };
    setAnswers(nextAnswers);
    if (retryMode && optionId === correctId) {
      setRetryQueue((queue) => queue.filter((questionIndex) => questionIndex !== index));
    }
    setHintOpen(false);
  };
  const startRetryWrong = () => {
    if (!wrongIndexes.length) return;
    setAnswers((prev) => {
      const next = { ...prev };
      wrongIndexes.forEach((questionIndex) => delete next[questionIndex]);
      return next;
    });
    setRetryQueue(wrongIndexes);
    setIndex(wrongIndexes[0]);
    setHintOpen(false);
  };
  const showAllQuestions = () => {
    setRetryQueue([]);
    setHintOpen(false);
  };
  const resetQuizProgress = () => {
    setAnswers({});
    setRetryQueue([]);
    setHintOpen(false);
    setIndex(0);
  };
  if (!question) return <div className="rounded-2xl border border-surface-border bg-surface-elevated p-4 text-sm text-text-tertiary">{t("notebook.studio.quizEmpty")}</div>;
  return (
    <div className="flex min-h-[520px] flex-1 flex-col rounded-[28px] bg-surface-card px-3 py-4">
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-surface-border bg-surface-elevated/70 px-4 py-3 text-xs font-semibold text-text-tertiary">
          <div className="flex flex-wrap items-center gap-2">
            <span>{retryMode ? t("notebook.studio.quizRetryMode") : t("notebook.studio.quiz")}</span>
            <span className="text-text-quaternary">·</span>
            <span>{t("notebook.studio.quizProgress", { answered: String(answeredCount), total: String(total), correct: String(correctCount), wrong: String(wrongCount) })}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={retryMode ? showAllQuestions : startRetryWrong} disabled={!retryMode && !wrongCount} className={cn("rounded-full border px-3 py-1.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50", retryMode ? "border-red-500/30 bg-red-500/10 text-red-500" : "border-surface-border text-text-secondary hover:bg-surface-card")}>{retryMode ? t("notebook.studio.quizAllQuestions") : t("notebook.studio.quizRetryWrong")}</button>
            <button type="button" onClick={resetQuizProgress} disabled={!answeredCount && !retryMode} className="rounded-full border border-surface-border px-3 py-1.5 font-semibold text-text-secondary transition hover:bg-surface-card disabled:cursor-not-allowed disabled:opacity-50">{t("notebook.studio.quizReset")}</button>
          </div>
        </div>
        <div className="mb-4 flex items-center justify-between text-xs font-semibold text-text-tertiary">
          <span>{index + 1}/{total}</span>
          <span>{retryMode ? t("notebook.studio.quizRetryRemaining", { count: String(retryQueue.length) }) : t("notebook.studio.quiz")}</span>
        </div>
        <div className="rounded-[28px] border border-surface-border bg-surface-card p-5 shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
          <h3 className="text-[19px] font-semibold leading-7 tracking-[-0.02em] text-text-primary">{question.question}</h3>
          <div className="mt-5 space-y-3">
            {question.options.map((option) => {
              const optionSelected = selected === option.id;
              const optionCorrect = option.id === correctId;
              return (
                <button key={option.id} type="button" disabled={answered} onClick={() => chooseOption(option.id)} className={cn("flex w-full flex-col rounded-2xl border px-4 py-3 text-left transition", !answered && "border-surface-border bg-surface-elevated hover:border-brand-border hover:bg-surface-hover", answered && optionCorrect && "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30", answered && !optionCorrect && "border-surface-border bg-surface-elevated/60 text-text-tertiary")}>
                  <div className="flex items-start gap-3">
                    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold", answered && optionCorrect ? "border-emerald-500 bg-emerald-500 text-white" : answered && optionSelected && !optionCorrect ? "border-red-500 bg-red-500 text-white" : "border-surface-border bg-surface-card text-text-secondary")}>{option.id}</span>
                    <span className={cn("text-sm leading-6", answered && optionCorrect ? "text-emerald-800 dark:text-emerald-200" : answered && optionSelected && !optionCorrect ? "text-red-800 dark:text-red-200" : "text-text-primary")}>{option.text}</span>
                  </div>
                  {answered && optionCorrect && (
                    <div className="mt-2.5 flex items-start gap-2 pl-9 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div>
                        <span className="font-semibold text-emerald-700 dark:text-emerald-300">{t("notebook.studio.quizCorrect")}</span>
                        <p className="mt-0.5 leading-5 text-emerald-700/90 dark:text-emerald-300/90">{truncateText(option.reason || question.explanation)}</p>
                      </div>
                    </div>
                  )}
                  {answered && optionSelected && !optionCorrect && (
                    <div className="mt-2.5 flex items-start gap-2 pl-9 text-sm">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                      <div>
                        <span className="font-semibold text-red-700 dark:text-red-300">{t("notebook.studio.quizWrong")}</span>
                        <p className="mt-0.5 leading-5 text-red-700/90 dark:text-red-300/90">{truncateText(option.reason || question.wrong_reason || question.explanation)}</p>
                      </div>
                    </div>
                  )}
                  {answered && !optionSelected && !optionCorrect && option.reason && (
                    <div className="mt-2.5 pl-9 text-sm leading-5 text-text-tertiary">
                      {truncateText(option.reason)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {hintOpen && !answered && (
            <div className="mt-5 flex gap-3 rounded-2xl border border-indigo-500/15 bg-indigo-500/10 p-4 text-sm leading-6 text-indigo-700 dark:text-indigo-300">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{question.hint}</span>
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button type="button" onClick={() => answered ? onExplain?.(question, selected) : setHintOpen((open) => !open)} className="inline-flex items-center gap-2 rounded-full border border-surface-border bg-surface-card px-4 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-elevated hover:text-text-primary">
            {answered ? <MessageCircle className="h-4 w-4" /> : <HelpCircle className="h-4 w-4" />}
            {answered ? t("notebook.studio.quizExplain") : t("notebook.studio.quizHint")}
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => goTo(index - 1)} className="rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface-elevated">{t("notebook.studio.previous")}</button>
            <button type="button" onClick={() => goTo(index + 1)} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">{t("notebook.studio.next")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfographicArtifactView({
  artifact,
  expanded = false,
  onDownload,
}: {
  artifact: Extract<NotebookStudioArtifact, { type: "infographic" }>;
  expanded?: boolean;
  onDownload?: (artifact: NotebookStudioArtifact) => void;
}) {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const imageUrl = artifact.image_url || "";

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 4));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));
  const handleReset = () => setScale(1);

  const handleDownloadImage = async () => {
    if (!imageUrl) {
      onDownload?.(artifact);
      return;
    }
    setDownloading(true);
    try {
      const url = imageUrl.startsWith("http") || imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const ext = blob.type?.includes("png") ? "png" : blob.type?.includes("jpeg") || blob.type?.includes("jpg") ? "jpg" : "png";
      link.download = `${artifact.title.replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "_") || "infographic"}.${ext}`;
      link.href = objectUrl;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    } catch {
      onDownload?.(artifact);
    } finally {
      setDownloading(false);
    }
  };

  if (!imageUrl) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-surface-border bg-surface-elevated/40 p-8 text-center", expanded ? "h-full" : "max-h-[560px]")}>
        <div className="rounded-full bg-surface-elevated p-3">
          <BarChart3 className="h-6 w-6 text-text-tertiary" />
        </div>
        <div className="text-sm font-medium text-text-secondary">{t("notebook.studio.infographicEmpty")}</div>
        <div className="text-xs text-text-tertiary">{t("notebook.studio.infographicEmptyHint")}</div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", expanded ? "h-full" : "max-h-[560px]")}>
      <div
        className={cn(
          "relative flex-1 overflow-auto rounded-2xl border border-surface-border bg-surface-elevated/40",
          expanded ? "min-h-0" : "max-h-[480px]"
        )}
      >
        <div
          className="flex min-h-full min-w-full items-center justify-center p-6"
          style={{ transform: `scale(${scale})`, transformOrigin: "center top" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={artifact.title}
            className="max-w-none rounded-xl shadow-xl"
            style={{ maxHeight: expanded ? "none" : "420px" }}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleZoomOut} className="rounded-full border border-surface-border p-2 text-text-secondary hover:bg-surface-elevated" title={t("notebook.studio.zoomOut")}>
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" onClick={handleReset} className="min-w-[3rem] text-center text-xs font-medium text-text-secondary hover:text-text-primary">
            {Math.round(scale * 100)}%
          </button>
          <button type="button" onClick={handleZoomIn} className="rounded-full border border-surface-border p-2 text-text-secondary hover:bg-surface-elevated" title={t("notebook.studio.zoomIn")}>
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={handleDownloadImage}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 rounded-full border border-surface-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-elevated disabled:opacity-60"
        >
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {t("notebook.studio.infographicDownloadPng")}
        </button>
      </div>
    </div>
  );
}

function renderActiveArtifact(artifact: NotebookStudioArtifact, t: (key: string, params?: Record<string, string>) => string, expanded = false, onDownloadArtifact?: (artifact: NotebookStudioArtifact) => void, onExplainFlashcard?: (card: NotebookStudioFlashcard) => void, onExplainQuiz?: (question: NotebookStudioQuizQuestion, selectedOptionId: string | null) => void, onOpenSource?: (sourceId: number, target?: NotebookSourceOpenTarget) => void) {
  switch (artifact.type) {
    case "table":
      return renderTableArtifact(artifact, t, expanded, onOpenSource);
    case "mindmap":
      return <MindmapArtifactView artifact={artifact} onDownload={onDownloadArtifact} />;
    case "flashcards":
      return <FlashcardsArtifactView artifact={artifact} t={t} onExplain={onExplainFlashcard} />;
    case "quiz":
      return <QuizArtifactView artifact={artifact} t={t} onExplain={onExplainQuiz} />;
    case "report":
      return renderReportArtifact(artifact, expanded, onOpenSource);
    case "infographic":
      return <InfographicArtifactView artifact={artifact} expanded={expanded} onDownload={onDownloadArtifact} />;
    case "summary":
    case "faq":
    case "briefing":
      return renderTextArtifact(artifact, onOpenSource);
  }
}

function InfographicConfigDialog({
  open,
  generating,
  onClose,
  onGenerate,
  t,
}: {
  open: boolean;
  generating: boolean;
  onClose: () => void;
  onGenerate: (options: { orientation: string; style: string; detail_level: string; prompt: string }) => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const [orientation, setOrientation] = useState<"landscape" | "portrait" | "square">("landscape");
  const [detailLevel, setDetailLevel] = useState<"short" | "standard" | "detailed">("standard");
  const [style, setStyle] = useState<string>("auto");
  const [prompt, setPrompt] = useState("");

  const styles = [
    { id: "auto", label: t("notebook.studio.infographicStyleAuto"), icon: Sparkles },
    { id: "cute", label: t("notebook.studio.infographicStyleCute"), icon: null },
    { id: "clay", label: t("notebook.studio.infographicStyleClay"), icon: null },
    { id: "sketch", label: t("notebook.studio.infographicStyleSketch"), icon: null },
    { id: "anime", label: t("notebook.studio.infographicStyleAnime"), icon: null },
    { id: "professional", label: t("notebook.studio.infographicStyleProfessional"), icon: null },
  ];

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex max-h-[88vh] w-[min(640px,94vw)] flex-col overflow-hidden rounded-[22px] border border-surface-border bg-surface-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600">
              <StudioInfographicIcon className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-lg font-semibold tracking-[-0.02em] text-text-primary">{t("notebook.studio.infographicDialogTitle")}</h3>
              <p className="text-xs text-text-tertiary">{t("notebook.studio.infographicDialogSubtitle")}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={generating} className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-elevated text-lg leading-none text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-50" aria-label="Close">×</button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-text-primary">{t("notebook.studio.infographicOrientation")}</label>
            <div className="inline-flex rounded-xl border border-surface-border bg-surface-elevated p-1">
              {(["landscape", "portrait", "square"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setOrientation(value)}
                  className={cn(
                    "rounded-lg px-4 py-2 text-sm font-medium transition",
                    orientation === value ? "bg-surface-card text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
                  )}
                >
                  {t(`notebook.studio.infographicOrientation.${value}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-text-primary">{t("notebook.studio.infographicDetailLevel")}</label>
            <div className="inline-flex rounded-xl border border-surface-border bg-surface-elevated p-1">
              {(["short", "standard", "detailed"] as const).map((value, index) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDetailLevel(value)}
                  className={cn(
                    "rounded-lg px-4 py-2 text-sm font-medium transition",
                    detailLevel === value ? "bg-surface-card text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
                  )}
                >
                  {t(`notebook.studio.infographicDetailLevel.${value}`)}
                  {index === 2 ? <span className="ml-1.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-300">Beta</span> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-text-primary">{t("notebook.studio.infographicVisualStyle")}</label>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {styles.map((item) => {
                const Icon = item.icon;
                const selected = style === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStyle(item.id)}
                    className={cn(
                      "flex min-w-[88px] flex-col items-center gap-2 rounded-xl border px-3 py-3 transition",
                      selected ? "border-brand bg-brand-muted/30 ring-1 ring-brand/20" : "border-surface-border bg-surface-elevated hover:border-surface-border hover:bg-surface-hover"
                    )}
                  >
                    <span className={cn("flex h-10 w-10 items-center justify-center rounded-full", selected ? "bg-brand text-white" : "bg-surface-card text-text-secondary")}>
                      {Icon ? <Icon className="h-5 w-5" /> : <span className="text-sm font-semibold">{item.label.slice(0, 1)}</span>}
                    </span>
                    <span className="text-xs font-medium text-text-secondary">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-text-primary">{t("notebook.studio.infographicPromptLabel")}</label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t("notebook.studio.infographicPromptPlaceholder")}
              rows={3}
              className="w-full resize-none rounded-xl border border-surface-border bg-surface-elevated px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10"
            />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-surface-border px-6 py-4">
          <div className="text-xs text-text-tertiary">{t("notebook.studio.infographicGenerationHint")}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={generating} className="rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-hover disabled:opacity-50">{t("common.cancel")}</button>
            <button
              type="button"
              onClick={() => onGenerate({ orientation, style, detail_level: detailLevel, prompt })}
              disabled={generating}
              className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-70"
            >
              {generating && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("notebook.studio.generateInfographic")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneratingStudioCard({ sourceCount, t }: { type: NotebookStudioActionId; sourceCount: number; t: (key: string, params?: Record<string, string>) => string }) {
  return (
    <div className="mb-3 overflow-hidden rounded-[18px] border border-[#e5e7eb] bg-white shadow-sm dark:border-surface-border dark:bg-surface-card">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#111827] text-white shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#111827] dark:text-text-primary">生成数据中</div>
          <div className="mt-1 text-xs leading-5 text-[#6b7280] dark:text-text-tertiary">
            正在整理和分析 {sourceCount} 个来源
          </div>
        </div>
      </div>
      <div className="h-[3px] w-full overflow-hidden bg-[#f3f4f6] dark:bg-surface-elevated">
        <div className="h-full w-1/2 animate-[notebook-studio-loading_1.35s_ease-in-out_infinite] rounded-full bg-[#111827]" />
      </div>
    </div>
  );
}

function ArtifactMenu({
  artifact,
  open,
  onToggle,
  onRenameArtifact,
  onRegenerateArtifact,
  onCopyArtifact,
  onDownloadArtifact,
  onCopyTableMarkdown,
  onPrintArtifact,
  onExportTableToGoogleSheets,
  onDeleteArtifact,
  t,
  floating = false,
}: {
  artifact: NotebookStudioArtifact;
  open: boolean;
  onToggle: () => void;
  onRenameArtifact?: (artifact: NotebookStudioArtifact) => void;
  onRegenerateArtifact?: (artifact: NotebookStudioArtifact) => void;
  onCopyArtifact?: (artifact: NotebookStudioArtifact) => void;
  onDownloadArtifact?: (artifact: NotebookStudioArtifact) => void;
  onCopyTableMarkdown?: (artifact: Extract<NotebookStudioArtifact, { type: "table" }>) => void;
  onPrintArtifact?: (artifact: NotebookStudioArtifact) => void;
  onExportTableToGoogleSheets?: (artifact: Extract<NotebookStudioArtifact, { type: "table" }>) => void;
  onDeleteArtifact?: (artifact: NotebookStudioArtifact) => void;
  t: (key: string, params?: Record<string, string>) => string;
  floating?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  const menuItemCount = [
    onRenameArtifact,
    onRegenerateArtifact,
    onCopyArtifact,
    artifact.type === "table" && onCopyTableMarkdown,
    artifact.type === "report" && onPrintArtifact,
    onDownloadArtifact,
    artifact.type === "table" && onExportTableToGoogleSheets,
    onDeleteArtifact,
  ].filter(Boolean).length;
  const estimatedMenuHeight = Math.max(48, menuItemCount * 32 + 8);

  const closeAndRun = (callback?: () => void) => {
    onToggle();
    callback?.();
  };

  useEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuWidth = 208;
      const menuHeight = menuRef.current?.offsetHeight || estimatedMenuHeight;
      const gap = 8;
      const viewportPadding = 8;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openDown = spaceBelow >= menuHeight + gap || spaceBelow >= spaceAbove;
      const left = Math.min(Math.max(viewportPadding, rect.right - menuWidth), window.innerWidth - menuWidth - viewportPadding);
      const top = openDown
        ? Math.min(rect.bottom + gap, window.innerHeight - menuHeight - viewportPadding)
        : Math.max(viewportPadding, rect.top - menuHeight - gap);
      setMenuStyle({ left, top, width: menuWidth });
    };
    updatePosition();
    const animationFrame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onToggle();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [estimatedMenuHeight, open, onToggle]);

  const menu = open && menuStyle && typeof document !== "undefined" ? createPortal(
    <div ref={menuRef} style={menuStyle} className="fixed z-[240] overflow-hidden rounded-2xl border border-surface-border bg-surface-card py-1 text-xs shadow-xl">
      {onRenameArtifact && <button type="button" onClick={() => closeAndRun(() => onRenameArtifact(artifact))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary"><Pencil className="h-3.5 w-3.5" />{t("notebook.studio.renameOutput")}</button>}
      {onRegenerateArtifact && <button type="button" onClick={() => closeAndRun(() => onRegenerateArtifact(artifact))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary"><RefreshCw className="h-3.5 w-3.5" />{t("notebook.studio.regenerateOutput")}</button>}
      {onCopyArtifact && <button type="button" onClick={() => closeAndRun(() => onCopyArtifact(artifact))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary"><Copy className="h-3.5 w-3.5" />{t("notebook.studio.copyOutput")}</button>}
      {artifact.type === "table" && onCopyTableMarkdown && <button type="button" onClick={() => closeAndRun(() => onCopyTableMarkdown(artifact))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary"><Copy className="h-3.5 w-3.5" />{t("notebook.studio.copyMarkdownTable")}</button>}
      {artifact.type === "report" && onPrintArtifact && <button type="button" onClick={() => closeAndRun(() => onPrintArtifact(artifact))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary"><Printer className="h-3.5 w-3.5" />{t("notebook.studio.printPdf")}</button>}
      {onDownloadArtifact && <button type="button" onClick={() => closeAndRun(() => onDownloadArtifact(artifact))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary"><Download className="h-3.5 w-3.5" />{artifact.type === "table" ? t("notebook.studio.downloadCsv") : artifact.type === "infographic" ? t("notebook.studio.infographicDownloadPng") : t("notebook.studio.downloadOutput")}</button>}
      {artifact.type === "table" && onExportTableToGoogleSheets && <button type="button" onClick={() => closeAndRun(() => onExportTableToGoogleSheets(artifact))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary"><ExternalLink className="h-3.5 w-3.5" />{t("notebook.studio.exportGoogleSheets")}</button>}
      {onDeleteArtifact && <button type="button" onClick={() => closeAndRun(() => onDeleteArtifact(artifact))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-500 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" />{t("notebook.studio.deleteOutput")}</button>}
    </div>,
    document.body
  ) : null;

  return (
    <div className={cn("relative", floating ? "absolute right-2 top-1/2 z-20 -translate-y-1/2" : "ml-auto")}>
      <button ref={triggerRef} type="button" onClick={onToggle} className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-elevated hover:text-text-primary" title={t("notebook.studio.moreActions")}>
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menu}
    </div>
  );
}

export function NotebookStudioPanel({
  width = 390,
  artifacts,
  notes = [],
  activeArtifactId,
  generatingType,
  selectedSourceCount = 0,
  sourceFiles = [],
  onGenerate,
  onCreateNote,
  onUpdateNote,
  onOpenArtifact,
  onRenameArtifact,
  onRegenerateArtifact,
  onDeleteArtifact,
  onCopyArtifact,
  onDownloadArtifact,
  onCopyTableMarkdown,
  onPrintArtifact,
  onExportTableToGoogleSheets,
  onExplainFlashcard,
  onExplainQuiz,
  onOpenSource,
}: NotebookStudioPanelProps) {
  const { t } = useI18n();
  const [openMenuArtifactId, setOpenMenuArtifactId] = useState<string | null>(null);
  const [viewerArtifactId, setViewerArtifactId] = useState<string | null>(null);
  const [sourcePopoverKey, setSourcePopoverKey] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [infographicDialogOpen, setInfographicDialogOpen] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const activeArtifact = artifacts.find((artifact) => artifact.id === activeArtifactId) || null;
  const viewerArtifact = artifacts.find((artifact) => artifact.id === viewerArtifactId) || null;
  const editingNote = editingNoteId ? notes.find((note) => note.id === editingNoteId) || null : null;
  const sourcesForArtifact = (artifact: NotebookStudioArtifact) => {
    const ids = Array.isArray(artifact.sourceFileIds) ? artifact.sourceFileIds.filter((id) => Number.isFinite(id) && id > 0) : [];
    if (ids.length > 0) {
      const byId = new Map(sourceFiles.map((source) => [source.id, source]));
      return ids.map((id) => byId.get(id)).filter((source): source is NotebookStudioSource => Boolean(source));
    }
    return sourceFiles.slice(0, Math.max(0, artifact.sourceCount || 0));
  };
  const sortedArtifacts = useMemo(() => {
    return [...artifacts]
      .sort((a, b) => {
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
      });
  }, [artifacts]);
  const actions: Array<{ id: NotebookStudioActionId; title: string; desc: string; accent: string; bgClass: string }> = [
    { id: "table", title: t("notebook.studio.table"), desc: t("notebook.studio.tableDesc"), accent: "from-emerald-500/15 to-cyan-500/10 text-emerald-500", bgClass: "bg-indigo-50 dark:bg-indigo-950/30" },
    { id: "mindmap", title: t("notebook.studio.mindmap"), desc: t("notebook.studio.mindmapDesc"), accent: "from-violet-500/15 to-fuchsia-500/10 text-violet-500", bgClass: "bg-purple-50 dark:bg-purple-950/30" },
    { id: "flashcards", title: t("notebook.studio.flashcards"), desc: t("notebook.studio.flashcardsDesc"), accent: "from-pink-500/15 to-rose-500/10 text-pink-500", bgClass: "bg-rose-50 dark:bg-rose-950/30" },
    { id: "quiz", title: t("notebook.studio.quiz"), desc: t("notebook.studio.quizDesc"), accent: "from-purple-500/15 to-violet-500/10 text-purple-500", bgClass: "bg-sky-50 dark:bg-sky-950/30" },
    { id: "report", title: t("notebook.studio.report"), desc: t("notebook.studio.reportDesc"), accent: "from-slate-500/15 to-blue-500/10 text-slate-600 dark:text-slate-300", bgClass: "bg-yellow-50 dark:bg-yellow-950/30" },
    { id: "infographic", title: t("notebook.studio.infographic"), desc: t("notebook.studio.infographicDesc"), accent: "from-violet-500/15 to-purple-500/10 text-violet-500", bgClass: "bg-fuchsia-50 dark:bg-fuchsia-950/30" },
  ];

  const handleActionClick = (actionId: NotebookStudioActionId) => {
    if (actionId === "infographic") {
      setInfographicDialogOpen(true);
      return;
    }
    onGenerate(actionId);
  };

  const handleArtifactClick = (artifact: NotebookStudioArtifact) => {
    if (artifact.type === "infographic") {
      setViewerArtifactId(artifact.id);
      return;
    }
    onOpenArtifact(artifact.id);
  };

  const handleInfographicGenerate = (options: { orientation: string; style: string; detail_level: string; prompt: string }) => {
    setInfographicDialogOpen(false);
    onGenerate("infographic", options);
  };

  const openNewNote = () => {
    setEditingNoteId(null);
    setNoteDialogOpen(true);
  };

  const openExistingNote = (note: NotebookStudioNote) => {
    setEditingNoteId(note.id);
    setNoteDialogOpen(true);
  };

  const handleSaveNote = (note: { title: string; content: string }) => {
    if (editingNoteId) {
      onUpdateNote?.(editingNoteId, note);
    } else {
      onCreateNote?.(note);
    }
    setNoteDialogOpen(false);
    setEditingNoteId(null);
  };

  if (isCollapsed) {
    return (
      <>
        <aside className="flex h-full w-[72px] shrink-0 flex-col overflow-hidden rounded-[28px] border border-surface-border bg-surface-card shadow-sm">
          <div className="flex h-[62px] shrink-0 items-center justify-center border-b border-surface-border">
            <button type="button" onClick={() => setIsCollapsed(false)} className="flex h-10 w-10 items-center justify-center rounded-2xl text-text-tertiary transition hover:bg-surface-elevated hover:text-text-primary" title="Studio">
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2.5 border-b border-surface-border px-2 py-3">
            {actions.map((action) => {
              const Icon = actionIconMap[action.id];
              const isGenerating = generatingType === action.id;
              const primaryIconTone = primaryStudioActionIconTone[action.id];
              return (
                <button key={action.id} type="button" onClick={() => handleActionClick(action.id)} disabled={Boolean(generatingType)} title={action.title} className="group flex h-11 w-11 items-center justify-center rounded-2xl transition hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-60">
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-2xl", primaryIconTone ? primaryIconTone : cn("bg-gradient-to-br", action.accent))}>
                    {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className={primaryIconTone ? "h-[22px] w-[22px]" : "h-4 w-4"} />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            {(generatingType === "table" || generatingType === "mindmap" || generatingType === "flashcards" || generatingType === "quiz" || generatingType === "report" || generatingType === "infographic") && (
              <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-elevated text-brand" title={t("notebook.studio.outputs")}>
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
            )}
            <div className="flex flex-col items-center gap-2">
              {sortedArtifacts.map((artifact) => {
                const Icon = artifactIconMap[artifact.type];
                return (
                  <button key={artifact.id} type="button" onClick={() => { setIsCollapsed(false); handleArtifactClick(artifact); }} title={artifact.title} className={cn("flex h-11 w-11 items-center justify-center rounded-2xl transition hover:bg-surface-elevated", activeArtifactId === artifact.id && "bg-surface-elevated ring-1 ring-brand-border")}>
                    <Icon className={cn("h-[23px] w-[23px]", artifactVisualMap[artifact.type].iconClass)} />
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
        {viewerArtifact && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm" role="dialog" aria-modal="true">
            <div className="flex h-[86vh] w-[min(1180px,92vw)] flex-col overflow-hidden rounded-3xl border border-surface-border bg-surface-card shadow-2xl">
              <div className="flex items-start gap-3 border-b border-surface-border px-6 py-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-tertiary">Studio Viewer</div>
                  <h3 className="mt-1 line-clamp-2 text-xl font-bold tracking-[-0.01em] text-text-primary">{viewerArtifact.title}</h3>
                </div>
                <button type="button" onClick={() => setViewerArtifactId(null)} className="rounded-full p-2 text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary" title={t("common.close")}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-surface-card p-5">
                {renderActiveArtifact(viewerArtifact, t, true, onDownloadArtifact, onExplainFlashcard, onExplainQuiz, onOpenSource)}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
    <aside className="flex h-full shrink-0 flex-col overflow-hidden rounded-[28px] border border-surface-border bg-surface-card shadow-sm" style={{ width }}>
      {activeArtifact ? (
        <div className="flex min-h-0 flex-1 flex-col bg-surface-card">
          <div className="flex items-start gap-3 border-b border-surface-border bg-surface-card px-4 py-4">
            <button type="button" onClick={() => onOpenArtifact(null)} className="mt-1 rounded-lg p-1.5 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" title={t("notebook.studio.backToOutputs")}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium leading-4 text-text-tertiary">Studio &gt; {activeArtifact.type === "table" ? t("notebook.studio.table") : activeArtifact.type}</div>
              <h3 className="mt-1 line-clamp-2 text-lg font-bold leading-6 tracking-[-0.01em] text-text-primary">{activeArtifact.title}</h3>
              <div className="relative mt-2.5 inline-block">
                <button
                  type="button"
                  onClick={() => setSourcePopoverKey((current) => current === `active-${activeArtifact.id}` ? null : `active-${activeArtifact.id}`)}
                  className="rounded-full border border-surface-border bg-surface-elevated px-3 py-1 text-[11px] font-medium text-text-secondary hover:border-brand-border hover:text-brand"
                >
                  {t("notebook.studio.viewSources", { count: String(activeArtifact.sourceCount) })}
                </button>
                {sourcePopoverKey === `active-${activeArtifact.id}` && <SourcePopover sources={sourcesForArtifact(activeArtifact)} title={t("notebook.sourcesTitle")} emptyLabel={t("notebook.sourcesEmpty")} onOpenSource={onOpenSource} />}
              </div>
            </div>
            <button type="button" onClick={() => setIsCollapsed(true)} className="mt-1 rounded-full p-2 text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary" title="Studio">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setViewerArtifactId(activeArtifact.id)} className="mt-1 rounded-full p-2 text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary" title={t("notebook.studio.expandViewer")}>
              <Maximize2 className="h-4 w-4" />
            </button>
            <ArtifactMenu
              artifact={activeArtifact}
              open={openMenuArtifactId === activeArtifact.id}
              onToggle={() => setOpenMenuArtifactId((current) => current === activeArtifact.id ? null : activeArtifact.id)}
              onRenameArtifact={onRenameArtifact}
              onRegenerateArtifact={onRegenerateArtifact}
              onCopyArtifact={onCopyArtifact}
              onDownloadArtifact={onDownloadArtifact}
              onCopyTableMarkdown={onCopyTableMarkdown}
              onPrintArtifact={onPrintArtifact}
              onExportTableToGoogleSheets={onExportTableToGoogleSheets}
              onDeleteArtifact={onDeleteArtifact}
              t={t}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-surface-card p-4">
            {renderActiveArtifact(activeArtifact, t, true, onDownloadArtifact, onExplainFlashcard, onExplainQuiz, onOpenSource)}
          </div>
        </div>
      ) : (
      <>
      <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-text-primary">Studio</h2>
        <button type="button" onClick={() => setIsCollapsed(true)} className="rounded-full p-2 text-text-tertiary transition hover:bg-surface-elevated hover:text-text-primary" title="Studio">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-surface-border px-4 py-4">
        <div className="grid grid-cols-2 gap-2.5">
          {actions.map((action) => {
            const Icon = actionIconMap[action.id];
            const isGenerating = generatingType === action.id;
            return (
              <div key={action.id} className={cn("group relative flex min-h-[88px] flex-col justify-between overflow-hidden rounded-2xl px-3.5 py-3 transition hover:shadow-sm", action.bgClass)}>
                <button type="button" onClick={() => handleActionClick(action.id)} disabled={Boolean(generatingType)} className="flex h-full flex-col justify-between text-left">
                  <div className="flex items-start justify-between">
                    {isGenerating ? (
                      <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
                    ) : (
                      <Icon className="h-5 w-5 text-text-secondary" />
                    )}
                  </div>
                  <div className="text-sm font-semibold text-text-primary">{action.title}</div>
                </button>
                <button type="button" onClick={() => handleActionClick(action.id)} disabled={Boolean(generatingType)} className="absolute right-3 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/70 text-text-secondary shadow-sm ring-1 ring-black/5 transition hover:scale-105 hover:bg-brand hover:text-white hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-5 pb-2.5 pt-4">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">{t("notebook.studio.outputs")}</h3>
          <MoreHorizontal className="h-4 w-4 text-text-tertiary" />
        </div>
        {(generatingType === "table" || generatingType === "mindmap" || generatingType === "flashcards" || generatingType === "quiz" || generatingType === "report" || generatingType === "infographic") && <div className="px-4 pb-3"><GeneratingStudioCard type={generatingType} sourceCount={selectedSourceCount} t={t} /></div>}
        {artifacts.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 text-text-tertiary">
              <Sparkles className="absolute ml-6 mt-0 h-3.5 w-3.5" />
              <Pencil className="h-8 w-8" />
            </div>
            <p className="text-sm font-medium text-text-primary">Studio 输出将保存在此处。</p>
            <p className="mt-2 max-w-[260px] text-xs leading-5 text-text-tertiary">添加来源后，点击即可添加数据表格、思维导图、闪卡、测验、报告或信息图。</p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
            <div className="space-y-1.5">
              {sortedArtifacts.map((artifact) => {
                const Icon = artifactIconMap[artifact.type];
                return (
                      <div key={artifact.id} className="group relative rounded-[18px] transition hover:bg-surface-elevated/70">
                        <div className="flex w-full items-center gap-3.5 px-2.5 py-3 pr-20 text-left">
                          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", artifactVisualMap[artifact.type].surfaceClass)}>
                            <Icon className={cn("h-[23px] w-[23px]", artifactVisualMap[artifact.type].iconClass)} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <button type="button" onClick={() => handleArtifactClick(artifact)} className="block w-full text-left">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-[14px] font-semibold leading-5 tracking-[-0.01em] text-text-primary">{artifact.title}</span>
                              </div>
                              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-text-tertiary">
                                <span className="truncate">{artifact.subtitle}</span>
                                <span className="text-text-tertiary/70">·</span>
                                <span className="shrink-0">{formatTime(artifact.createdAt)}</span>
                              </div>
                            </button>
                            <div className="relative mt-2 inline-block">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSourcePopoverKey((current) => current === `list-${artifact.id}` ? null : `list-${artifact.id}`);
                                }}
                                className="rounded-full border border-surface-border bg-surface-elevated px-2.5 py-1 text-[11px] font-medium text-text-secondary transition hover:border-brand-border hover:text-brand"
                              >
                                {t("notebook.studio.viewSources", { count: String(artifact.sourceCount) })}
                              </button>
                              {sourcePopoverKey === `list-${artifact.id}` && <SourcePopover sources={sourcesForArtifact(artifact)} title={t("notebook.sourcesTitle")} emptyLabel={t("notebook.sourcesEmpty")} onOpenSource={onOpenSource} />}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setViewerArtifactId(artifact.id)}
                          className="absolute right-9 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-text-tertiary opacity-0 transition hover:bg-surface-hover hover:text-text-primary group-hover:opacity-100"
                          title={t("notebook.studio.expandViewer")}
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                        </button>
                        <ArtifactMenu
                          artifact={artifact}
                          open={openMenuArtifactId === artifact.id}
                          onToggle={() => setOpenMenuArtifactId((current) => current === artifact.id ? null : artifact.id)}
                          onRenameArtifact={onRenameArtifact}
                          onRegenerateArtifact={onRegenerateArtifact}
                          onCopyArtifact={onCopyArtifact}
                          onDownloadArtifact={onDownloadArtifact}
                          onCopyTableMarkdown={onCopyTableMarkdown}
                          onPrintArtifact={onPrintArtifact}
                          onExportTableToGoogleSheets={onExportTableToGoogleSheets}
                          onDeleteArtifact={onDeleteArtifact}
                          t={t}
                          floating
                        />
                      </div>
                );
              })}
            </div>
          </div>
        )}
        {notes.length > 0 && (
          <div className="border-t border-surface-border px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">笔记</h3>
              <span className="text-xs text-text-tertiary">{notes.length}</span>
            </div>
            <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
              {notes.map((note) => (
                <button key={note.id} type="button" onClick={() => openExistingNote(note)} className="group flex w-full items-start gap-3 rounded-2xl px-2.5 py-2.5 text-left transition hover:bg-surface-elevated">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-300">
                    <StickyNote className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text-primary">{note.title}</span>
                    <span className="mt-1 block truncate text-xs text-text-tertiary">{note.readonly ? "已保存的回答只能查看" : noteContentPreview(note.content)} · {formatTime(note.createdAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="border-t border-surface-border px-4 py-3">
          <button type="button" onClick={openNewNote} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#111827] px-4 text-sm font-medium text-white transition hover:bg-[#1f2937]">
            <Pencil className="h-4 w-4" />
            添加笔记
          </button>
        </div>
      </div>
      </>
      )}
    </aside>
    {viewerArtifact && (
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm" role="dialog" aria-modal="true">
        <div className="flex h-[86vh] w-[min(1180px,92vw)] flex-col overflow-hidden rounded-3xl border border-surface-border bg-surface-card shadow-2xl">
          <div className="flex items-start gap-3 border-b border-surface-border px-6 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-tertiary">Studio Viewer</div>
              <h3 className="mt-1 line-clamp-2 text-xl font-bold tracking-[-0.01em] text-text-primary">{viewerArtifact.title}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
                <span>{viewerArtifact.subtitle}</span>
                <span>·</span>
                <span className="relative inline-block">
                  <button
                    type="button"
                    onClick={() => setSourcePopoverKey((current) => current === `viewer-${viewerArtifact.id}` ? null : `viewer-${viewerArtifact.id}`)}
                    className="rounded-full border border-surface-border bg-surface-elevated px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:border-brand-border hover:text-brand"
                  >
                    {t("notebook.studio.viewSources", { count: String(viewerArtifact.sourceCount) })}
                  </button>
                  {sourcePopoverKey === `viewer-${viewerArtifact.id}` && <SourcePopover sources={sourcesForArtifact(viewerArtifact)} title={t("notebook.sourcesTitle")} emptyLabel={t("notebook.sourcesEmpty")} onOpenSource={onOpenSource} />}
                </span>
              </div>
            </div>
            <button type="button" onClick={() => setViewerArtifactId(null)} className="rounded-full p-2 text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary" title={t("common.close")}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-surface-card p-5">
            {renderActiveArtifact(viewerArtifact, t, true, onDownloadArtifact, onExplainFlashcard, onExplainQuiz, onOpenSource)}
          </div>
        </div>
      </div>
    )}
    <InfographicConfigDialog
      open={infographicDialogOpen}
      generating={generatingType === "infographic"}
      onClose={() => setInfographicDialogOpen(false)}
      onGenerate={handleInfographicGenerate}
      t={t}
    />
    <NoteEditorDialog
      open={noteDialogOpen}
      initialTitle={editingNote?.title}
      initialContent={editingNote?.content}
      onClose={() => { setNoteDialogOpen(false); setEditingNoteId(null); }}
      onSave={handleSaveNote}
    />
    </>
  );
}
