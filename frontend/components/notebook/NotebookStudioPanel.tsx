"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { BarChart3, CheckCircle2, ChevronLeft, ChevronRight, ChevronsRight, Copy, Download, ExternalLink, FileQuestion, FileText, HelpCircle, Layers3, Lightbulb, Loader2, Map as MapIcon, Maximize2, MessageCircle, MoreHorizontal, Pencil, Presentation, RefreshCw, Sparkles, Trash2, X, XCircle, ZoomIn, ZoomOut } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type NotebookStudioActionId = "table" | "summary" | "faq" | "briefing" | "mindmap" | "flashcards" | "quiz" | "report" | "slides";

export type NotebookStudioTableRow = {
  module: string;
  capability: string;
  status: string;
  implementation: string;
  value: string;
  source: string;
};

export type NotebookStudioTextSection = {
  heading: string;
  body?: string;
  bullets?: string[];
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

export type NotebookStudioFlashcard = {
  front: string;
  back: string;
  source?: string;
};

export type NotebookStudioQuizOption = {
  id: "A" | "B" | "C" | "D" | string;
  text: string;
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
};

export type NotebookStudioReportTable = {
  title: string;
  headers: string[];
  rows: string[][];
};

export type NotebookStudioArtifact =
  | {
      id: string;
      type: "table";
      title: string;
      subtitle: string;
      createdAt: string;
      sourceCount: number;
      rows: NotebookStudioTableRow[];
    }
  | {
      id: string;
      type: "summary" | "faq" | "briefing";
      title: string;
      subtitle: string;
      createdAt: string;
      sourceCount: number;
      sections: NotebookStudioTextSection[];
    }
  | {
      id: string;
      type: "mindmap";
      title: string;
      subtitle: string;
      createdAt: string;
      sourceCount: number;
      nodes: NotebookStudioMindmapNode[];
      edges: NotebookStudioMindmapEdge[];
    }
  | {
      id: string;
      type: "flashcards";
      title: string;
      subtitle: string;
      createdAt: string;
      sourceCount: number;
      cards: NotebookStudioFlashcard[];
    }
  | {
      id: string;
      type: "quiz";
      title: string;
      subtitle: string;
      createdAt: string;
      sourceCount: number;
      questions: NotebookStudioQuizQuestion[];
    }
  | {
      id: string;
      type: "report";
      title: string;
      subtitle: string;
      createdAt: string;
      sourceCount: number;
      formatId: string;
      formatTitle: string;
      executiveSummary: string;
      sections: NotebookStudioReportSection[];
      tables: NotebookStudioReportTable[];
    };

type NotebookStudioPanelProps = {
  width?: number;
  artifacts: NotebookStudioArtifact[];
  activeArtifactId: string | null;
  generatingType?: NotebookStudioActionId | null;
  selectedSourceCount?: number;
  sourceFiles?: NotebookStudioSource[];
  onGenerate: (type: NotebookStudioActionId) => void;
  onOpenArtifact: (artifactId: string | null) => void;
  onRenameArtifact?: (artifact: NotebookStudioArtifact) => void;
  onDeleteArtifact?: (artifact: NotebookStudioArtifact) => void;
  onCopyArtifact?: (artifact: NotebookStudioArtifact) => void;
  onDownloadArtifact?: (artifact: NotebookStudioArtifact) => void;
  onExportTableToGoogleSheets?: (artifact: Extract<NotebookStudioArtifact, { type: "table" }>) => void;
  onExplainFlashcard?: (card: NotebookStudioFlashcard) => void;
  onExplainQuiz?: (question: NotebookStudioQuizQuestion, selectedOptionId: string | null) => void;
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
};

const artifactIconTone: Record<NotebookStudioArtifact["type"], string> = {
  table: "text-blue-900 dark:text-blue-300",
  summary: "text-slate-700 dark:text-slate-300",
  faq: "text-indigo-700 dark:text-indigo-300",
  briefing: "text-amber-700 dark:text-amber-300",
  mindmap: "text-emerald-700 dark:text-emerald-300",
  flashcards: "text-red-900 dark:text-rose-300",
  quiz: "text-purple-800 dark:text-purple-300",
  report: "text-[#8a7a35] dark:text-yellow-300",
};

const primaryStudioActionIconTone: Partial<Record<NotebookStudioActionId, string>> = {
  table: artifactIconTone.table,
  flashcards: artifactIconTone.flashcards,
  quiz: artifactIconTone.quiz,
  report: artifactIconTone.report,
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

function SourcePopover({ sources, title, emptyLabel }: { sources: NotebookStudioSource[]; title: string; emptyLabel: string }) {
  return (
    <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-2xl border border-surface-border bg-surface-card p-3 text-left shadow-2xl">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
        <FileText className="h-4 w-4 text-text-tertiary" />
        <span>{title}</span>
      </div>
      {sources.length ? (
        <div className="space-y-1.5">
          {sources.map((source) => (
            <div key={source.id} className="flex items-center gap-2 rounded-xl px-2 py-2 text-xs text-text-secondary hover:bg-surface-hover">
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", sourceAccent(source))}><FileText className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{source.filename}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-surface-elevated px-3 py-2 text-xs text-text-tertiary">{emptyLabel}</div>
      )}
    </div>
  );
}

function renderTextArtifact(artifact: Extract<NotebookStudioArtifact, { type: "summary" | "faq" | "briefing" }>) {
  return (
    <div className="space-y-3 p-4">
      {artifact.sections.map((section, index) => (
        <section key={`${section.heading}-${index}`} className="rounded-2xl border border-surface-border bg-surface-elevated/60 p-3">
          <h4 className="text-sm font-semibold text-text-primary">{section.heading}</h4>
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

function renderTableArtifact(artifact: Extract<NotebookStudioArtifact, { type: "table" }>, t: (key: string, params?: Record<string, string>) => string, expanded = false) {
  return (
    <div className={cn("overflow-auto border border-surface-border bg-surface-card", expanded ? "min-h-0 flex-1 rounded-lg shadow-none" : "max-h-[460px] rounded-2xl shadow-sm")}>
      <table className={cn("border-collapse text-left", expanded ? "min-w-[960px] text-[13px]" : "min-w-[780px] text-xs")}>
        <thead className="sticky top-0 z-10 bg-surface-elevated/95 text-text-primary">
          <tr>
            <th className={cn("border-b border-surface-border font-semibold", expanded ? "px-4 py-3.5 text-[13px]" : "px-3 py-3")}>{t("notebook.studio.columnModule")}</th>
            <th className={cn("border-b border-surface-border font-semibold", expanded ? "px-4 py-3.5 text-[13px]" : "px-3 py-3")}>{t("notebook.studio.columnCapability")}</th>
            <th className={cn("border-b border-surface-border font-semibold [writing-mode:vertical-rl]", expanded ? "px-3 py-3.5 text-[13px]" : "px-3 py-3")}>{t("notebook.studio.columnStatus")}</th>
            <th className={cn("border-b border-surface-border font-semibold", expanded ? "px-4 py-3.5 text-[13px]" : "px-3 py-3")}>{t("notebook.studio.columnImplementation")}</th>
            <th className={cn("border-b border-surface-border font-semibold", expanded ? "px-4 py-3.5 text-[13px]" : "px-3 py-3")}>{t("notebook.studio.columnValue")}</th>
            <th className={cn("border-b border-surface-border font-semibold", expanded ? "px-4 py-3.5 text-[13px]" : "px-3 py-3")}>{t("notebook.studio.columnSource")}</th>
          </tr>
        </thead>
        <tbody>
          {artifact.rows.map((row, index) => (
            <tr key={`${row.module}-${index}`} className="align-top hover:bg-surface-hover/60">
              <td className={cn("border-b border-surface-border font-semibold text-text-primary", expanded ? "px-4 py-[18px] leading-6" : "px-3 py-4")}>{row.module}</td>
              <td className={cn("border-b border-surface-border text-text-secondary", expanded ? "px-4 py-[18px] leading-6" : "px-3 py-4 leading-5")}>{row.capability}</td>
              <td className={cn("border-b border-surface-border text-center font-medium text-text-secondary [writing-mode:vertical-rl]", expanded ? "px-3 py-[18px] leading-6" : "px-3 py-4")}>{row.status}</td>
              <td className={cn("border-b border-surface-border text-text-secondary", expanded ? "px-4 py-[18px] leading-6" : "px-3 py-4 leading-5")}>{row.implementation}</td>
              <td className={cn("border-b border-surface-border text-text-secondary", expanded ? "px-4 py-[18px] leading-6" : "px-3 py-4 leading-5")}>{row.value}</td>
              <td className={cn("border-b border-surface-border font-medium text-brand", expanded ? "px-4 py-[18px] leading-6" : "px-3 py-4")}>{row.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderReportArtifact(artifact: Extract<NotebookStudioArtifact, { type: "report" }>, expanded = false) {
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
                      <h3 className="mb-1.5 text-[15px] font-bold text-slate-900 dark:text-text-primary">{subsection.number ? `${subsection.number}. ` : ""}{subsection.heading}</h3>
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
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState<"wrong" | "right" | null>(null);
  const total = artifact.cards.length;
  const rawCard = artifact.cards[Math.min(index, Math.max(total - 1, 0))];
  const card = rawCard ? { ...rawCard, front: cleanFlashcardDisplayText(rawCard.front), back: cleanFlashcardDisplayText(rawCard.back), source: "" } : undefined;
  const wrongCount = Object.values(known).filter((value) => value === false).length;
  const rightCount = Object.values(known).filter((value) => value === true).length;
  const go = (next: number, direction: "left" | "right" = next > index ? "left" : "right") => {
    if (!total) return;
    setReviewFeedback(null);
    setSlideDirection(direction);
    setIndex((next + total) % total);
    setAnswerVisible(false);
    window.setTimeout(() => setSlideDirection(null), 260);
  };
  const review = (value: boolean) => {
    if (!total || reviewFeedback) return;
    setKnown((prev) => ({ ...prev, [index]: value }));
    setReviewFeedback(value ? "right" : "wrong");
    setAnswerVisible(false);
    setSlideDirection(value ? "left" : "right");
    window.setTimeout(() => {
      setIndex((index + 1) % total);
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
  const total = artifact.questions.length;
  const question = artifact.questions[Math.min(index, Math.max(total - 1, 0))];
  const selected = answers[index] || null;
  const correctId = question?.correct_option_id;
  const selectedOption = question?.options.find((option) => option.id === selected);
  const correctOption = question?.options.find((option) => option.id === correctId);
  const answered = Boolean(selected);
  const isCorrect = selected === correctId;
  const truncateText = (value: string) => (value.length > 95 ? `${value.slice(0, 92)}…` : value);
  const goTo = (next: number) => {
    if (!total) return;
    setIndex((next + total) % total);
    setHintOpen(false);
  };
  if (!question) return <div className="rounded-2xl border border-surface-border bg-surface-elevated p-4 text-sm text-text-tertiary">{t("notebook.studio.quizEmpty")}</div>;
  return (
    <div className="flex min-h-[520px] flex-1 flex-col rounded-[28px] bg-surface-card px-3 py-4">
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col">
        <div className="mb-4 flex items-center justify-between text-xs font-semibold text-text-tertiary">
          <span>{index + 1}/{total}</span>
          <span>{t("notebook.studio.quiz")}</span>
        </div>
        <div className="rounded-[28px] border border-surface-border bg-surface-card p-5 shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
          <h3 className="text-[19px] font-semibold leading-7 tracking-[-0.02em] text-text-primary">{question.question}</h3>
          <div className="mt-5 space-y-3">
            {question.options.map((option) => {
              const optionSelected = selected === option.id;
              const optionCorrect = option.id === correctId;
              return (
                <button key={option.id} type="button" disabled={answered} onClick={() => { if (!answered) { setAnswers((prev) => ({ ...prev, [index]: option.id })); setHintOpen(false); } }} className={cn("flex w-full flex-col rounded-2xl border px-4 py-3 text-left transition", !answered && "border-surface-border bg-surface-elevated hover:border-brand-border hover:bg-surface-hover", answered && optionCorrect && "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30", answered && !optionCorrect && "border-surface-border bg-surface-elevated/60 text-text-tertiary")}>
                  <div className="flex items-start gap-3">
                    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold", answered && optionCorrect ? "border-emerald-500 bg-emerald-500 text-white" : answered && optionSelected && !optionCorrect ? "border-red-500 bg-red-500 text-white" : "border-surface-border bg-surface-card text-text-secondary")}>{option.id}</span>
                    <span className={cn("text-sm leading-6", answered && optionCorrect ? "text-emerald-800 dark:text-emerald-200" : answered && optionSelected && !optionCorrect ? "text-red-800 dark:text-red-200" : "text-text-primary")}>{option.text}</span>
                  </div>
                  {answered && optionCorrect && (
                    <div className="mt-2.5 flex items-start gap-2 pl-9 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div>
                        <span className="font-semibold text-emerald-700 dark:text-emerald-300">{t("notebook.studio.quizCorrect")}</span>
                        <p className="mt-0.5 leading-5 text-emerald-700/90 dark:text-emerald-300/90">{truncateText(question.explanation)}</p>
                      </div>
                    </div>
                  )}
                  {answered && optionSelected && !optionCorrect && (
                    <div className="mt-2.5 flex items-start gap-2 pl-9 text-sm">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                      <div>
                        <span className="font-semibold text-red-700 dark:text-red-300">{t("notebook.studio.quizWrong")}</span>
                        <p className="mt-0.5 leading-5 text-red-700/90 dark:text-red-300/90">{truncateText(question.wrong_reason || question.explanation)}</p>
                      </div>
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

function renderActiveArtifact(artifact: NotebookStudioArtifact, t: (key: string, params?: Record<string, string>) => string, expanded = false, onDownloadArtifact?: (artifact: NotebookStudioArtifact) => void, onExplainFlashcard?: (card: NotebookStudioFlashcard) => void, onExplainQuiz?: (question: NotebookStudioQuizQuestion, selectedOptionId: string | null) => void) {
  switch (artifact.type) {
    case "table":
      return renderTableArtifact(artifact, t, expanded);
    case "mindmap":
      return <MindmapArtifactView artifact={artifact} onDownload={onDownloadArtifact} />;
    case "flashcards":
      return <FlashcardsArtifactView artifact={artifact} t={t} onExplain={onExplainFlashcard} />;
    case "quiz":
      return <QuizArtifactView artifact={artifact} t={t} onExplain={onExplainQuiz} />;
    case "report":
      return renderReportArtifact(artifact, expanded);
    case "summary":
    case "faq":
    case "briefing":
      return renderTextArtifact(artifact);
  }
}

function GeneratingStudioCard({ type, sourceCount, t }: { type: NotebookStudioActionId; sourceCount: number; t: (key: string, params?: Record<string, string>) => string }) {
  const titleKey = type === "mindmap" ? "notebook.studio.generatingMindmap" : type === "flashcards" ? "notebook.studio.generatingFlashcards" : type === "quiz" ? "notebook.studio.generatingQuiz" : type === "report" ? "notebook.studio.generatingReport" : "notebook.studio.generatingTable";
  return (
    <div className="mb-3 rounded-2xl border border-surface-border bg-surface-card px-3 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-elevated text-brand">
          <RefreshCw className="absolute h-5 w-5 animate-spin" />
          <RefreshCw className="h-3.5 w-3.5 animate-[spin_1.2s_linear_infinite_reverse] opacity-70" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">{t(titleKey)}</div>
          <div className="mt-1 text-xs text-text-tertiary">{t("notebook.studio.basedOnSources", { count: String(sourceCount) })}</div>
        </div>
      </div>
    </div>
  );
}

function ArtifactMenu({
  artifact,
  open,
  onToggle,
  onRenameArtifact,
  onCopyArtifact,
  onDownloadArtifact,
  onExportTableToGoogleSheets,
  onDeleteArtifact,
  t,
  floating = false,
}: {
  artifact: NotebookStudioArtifact;
  open: boolean;
  onToggle: () => void;
  onRenameArtifact?: (artifact: NotebookStudioArtifact) => void;
  onCopyArtifact?: (artifact: NotebookStudioArtifact) => void;
  onDownloadArtifact?: (artifact: NotebookStudioArtifact) => void;
  onExportTableToGoogleSheets?: (artifact: Extract<NotebookStudioArtifact, { type: "table" }>) => void;
  onDeleteArtifact?: (artifact: NotebookStudioArtifact) => void;
  t: (key: string, params?: Record<string, string>) => string;
  floating?: boolean;
}) {
  const closeAndRun = (callback?: () => void) => {
    onToggle();
    callback?.();
  };
  return (
    <div className={cn("relative", floating ? "absolute right-2 top-1/2 z-20 -translate-y-1/2" : "ml-auto")}>
      <button type="button" onClick={onToggle} className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-elevated hover:text-text-primary" title={t("notebook.studio.moreActions")}>
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-2 w-52 overflow-hidden rounded-2xl border border-surface-border bg-surface-card py-1 text-xs shadow-xl">
          {onRenameArtifact && <button type="button" onClick={() => closeAndRun(() => onRenameArtifact(artifact))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary"><Pencil className="h-3.5 w-3.5" />{t("notebook.studio.renameOutput")}</button>}
          {onCopyArtifact && <button type="button" onClick={() => closeAndRun(() => onCopyArtifact(artifact))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary"><Copy className="h-3.5 w-3.5" />{t("notebook.studio.copyOutput")}</button>}
          {onDownloadArtifact && <button type="button" onClick={() => closeAndRun(() => onDownloadArtifact(artifact))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary"><Download className="h-3.5 w-3.5" />{artifact.type === "table" ? t("notebook.studio.downloadCsv") : t("notebook.studio.downloadOutput")}</button>}
          {artifact.type === "table" && onExportTableToGoogleSheets && <button type="button" onClick={() => closeAndRun(() => onExportTableToGoogleSheets(artifact))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary"><ExternalLink className="h-3.5 w-3.5" />{t("notebook.studio.exportGoogleSheets")}</button>}
          {onDeleteArtifact && <button type="button" onClick={() => closeAndRun(() => onDeleteArtifact(artifact))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-500 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" />{t("notebook.studio.deleteOutput")}</button>}
        </div>
      )}
    </div>
  );
}

export function NotebookStudioPanel({
  width = 390,
  artifacts,
  activeArtifactId,
  generatingType,
  selectedSourceCount = 0,
  sourceFiles = [],
  onGenerate,
  onOpenArtifact,
  onRenameArtifact,
  onDeleteArtifact,
  onCopyArtifact,
  onDownloadArtifact,
  onExportTableToGoogleSheets,
  onExplainFlashcard,
  onExplainQuiz,
}: NotebookStudioPanelProps) {
  const { t } = useI18n();
  const [openMenuArtifactId, setOpenMenuArtifactId] = useState<string | null>(null);
  const [viewerArtifactId, setViewerArtifactId] = useState<string | null>(null);
  const [sourcePopoverKey, setSourcePopoverKey] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const activeArtifact = artifacts.find((artifact) => artifact.id === activeArtifactId) || null;
  const viewerArtifact = artifacts.find((artifact) => artifact.id === viewerArtifactId) || null;
  const sourcesForArtifact = (artifact: NotebookStudioArtifact) => sourceFiles.slice(0, Math.max(0, artifact.sourceCount || 0));
  const actions: Array<{ id: NotebookStudioActionId; title: string; desc: string; accent: string }> = [
    { id: "table", title: t("notebook.studio.table"), desc: t("notebook.studio.tableDesc"), accent: "from-emerald-500/15 to-cyan-500/10 text-emerald-500" },
    { id: "summary", title: t("notebook.studio.summary"), desc: t("notebook.studio.summaryDesc"), accent: "from-brand/15 to-purple-500/10 text-brand" },
    { id: "faq", title: t("notebook.studio.faq"), desc: t("notebook.studio.faqDesc"), accent: "from-amber-500/15 to-orange-500/10 text-amber-500" },
    { id: "briefing", title: t("notebook.studio.briefing"), desc: t("notebook.studio.briefingDesc"), accent: "from-blue-500/15 to-sky-500/10 text-blue-500" },
    { id: "mindmap", title: t("notebook.studio.mindmap"), desc: t("notebook.studio.mindmapDesc"), accent: "from-violet-500/15 to-fuchsia-500/10 text-violet-500" },
    { id: "flashcards", title: t("notebook.studio.flashcards"), desc: t("notebook.studio.flashcardsDesc"), accent: "from-pink-500/15 to-rose-500/10 text-pink-500" },
    { id: "quiz", title: t("notebook.studio.quiz"), desc: t("notebook.studio.quizDesc"), accent: "from-purple-500/15 to-violet-500/10 text-purple-500" },
    { id: "report", title: t("notebook.studio.report"), desc: t("notebook.studio.reportDesc"), accent: "from-slate-500/15 to-blue-500/10 text-slate-600 dark:text-slate-300" },
    { id: "slides", title: t("notebook.studio.slides"), desc: t("notebook.studio.slidesDesc"), accent: "from-rose-500/15 to-pink-500/10 text-rose-500" },
  ];

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
                <button key={action.id} type="button" onClick={() => onGenerate(action.id)} disabled={Boolean(generatingType)} title={action.title} className="group flex h-11 w-11 items-center justify-center rounded-2xl transition hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-60">
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-2xl", primaryIconTone ? primaryIconTone : cn("bg-gradient-to-br", action.accent))}>
                    {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className={primaryIconTone ? "h-[22px] w-[22px]" : "h-4 w-4"} />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            {(generatingType === "table" || generatingType === "mindmap" || generatingType === "flashcards" || generatingType === "quiz" || generatingType === "report") && (
              <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-elevated text-brand" title={t("notebook.studio.outputs")}>
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
            )}
            <div className="flex flex-col items-center gap-2">
              {artifacts.map((artifact) => {
                const Icon = artifactIconMap[artifact.type];
                return (
                  <button key={artifact.id} type="button" onClick={() => { setIsCollapsed(false); onOpenArtifact(artifact.id); }} title={artifact.title} className={cn("flex h-11 w-11 items-center justify-center rounded-2xl transition hover:bg-surface-elevated", activeArtifactId === artifact.id && "bg-surface-elevated ring-1 ring-brand-border")}>
                    <Icon className={cn("h-[23px] w-[23px]", artifactIconTone[artifact.type])} />
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
                {renderActiveArtifact(viewerArtifact, t, true, onDownloadArtifact, onExplainFlashcard, onExplainQuiz)}
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
                {sourcePopoverKey === `active-${activeArtifact.id}` && <SourcePopover sources={sourcesForArtifact(activeArtifact)} title={t("notebook.sourcesTitle")} emptyLabel={t("notebook.sourcesEmpty")} />}
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
              onCopyArtifact={onCopyArtifact}
              onDownloadArtifact={onDownloadArtifact}
              onExportTableToGoogleSheets={onExportTableToGoogleSheets}
              onDeleteArtifact={onDeleteArtifact}
              t={t}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-surface-card p-4">
            {renderActiveArtifact(activeArtifact, t, true, onDownloadArtifact, onExplainFlashcard, onExplainQuiz)}
            <div className="mt-3 flex items-center gap-2 border-t border-surface-border pt-3">
              <button type="button" className="rounded-full border border-surface-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-emerald-500/40 hover:text-emerald-500">{t("notebook.studio.good")}</button>
              <button type="button" className="rounded-full border border-surface-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-red-500/40 hover:text-red-500">{t("notebook.studio.bad")}</button>
            </div>
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
            const primaryIconTone = primaryStudioActionIconTone[action.id];
            return (
              <button key={action.id} type="button" onClick={() => onGenerate(action.id)} disabled={Boolean(generatingType)} className="group flex min-h-[72px] items-center gap-3 rounded-2xl border border-surface-border bg-surface-elevated px-3 py-3 text-left transition hover:border-surface-border hover:bg-surface-card hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-70">
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center", primaryIconTone ? primaryIconTone : cn("rounded-2xl bg-gradient-to-br", action.accent))}>
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className={primaryIconTone ? "h-[23px] w-[23px]" : "h-4 w-4"} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-text-primary">{action.title}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-text-tertiary">
                    <span className="truncate">{action.id === "slides" || action.id === "briefing" ? t("notebook.studio.beta") : t("notebook.studio.basedOnSources", { count: String(selectedSourceCount) })}</span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary transition group-hover:translate-x-0.5" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-5 pb-2.5 pt-4">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">{t("notebook.studio.outputs")}</h3>
          <MoreHorizontal className="h-4 w-4 text-text-tertiary" />
        </div>
        {(generatingType === "table" || generatingType === "mindmap" || generatingType === "flashcards" || generatingType === "quiz" || generatingType === "report") && <div className="px-4 pb-3"><GeneratingStudioCard type={generatingType} sourceCount={selectedSourceCount} t={t} /></div>}
        {artifacts.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-elevated text-text-tertiary"><Layers3 className="h-5 w-5" /></div>
            <p className="text-sm font-medium text-text-primary">{t("notebook.studio.emptyTitle")}</p>
            <p className="mt-2 text-xs leading-5 text-text-tertiary">{t("notebook.studio.emptyDesc")}</p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
            <div className="space-y-1.5">
              {artifacts.map((artifact) => {
                const Icon = artifactIconMap[artifact.type];
                return (
                  <div key={artifact.id} className="group relative rounded-[18px] transition hover:bg-surface-elevated/70">
                    <button type="button" onClick={() => onOpenArtifact(artifact.id)} className="flex w-full items-center gap-3.5 px-2.5 py-3 pr-16 text-left">
                      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", artifactIconTone[artifact.type])}>
                        <Icon className="h-[23px] w-[23px]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-semibold leading-5 tracking-[-0.01em] text-text-primary">{artifact.title}</div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-text-tertiary">
                          <span className="truncate">{artifact.subtitle}</span>
                          <span className="text-text-tertiary/70">·</span>
                          <span className="shrink-0">{formatTime(artifact.createdAt)}</span>
                        </div>
                      </div>
                    </button>
                    <button type="button" onClick={() => setViewerArtifactId(artifact.id)} className="absolute right-9 top-1/2 z-10 -translate-y-1/2 rounded-full p-1.5 text-text-tertiary opacity-0 transition hover:bg-surface-card hover:text-text-primary group-hover:opacity-100" title={t("notebook.studio.expandViewer")}>
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                    <ArtifactMenu
                      artifact={artifact}
                      open={openMenuArtifactId === artifact.id}
                      onToggle={() => setOpenMenuArtifactId((current) => current === artifact.id ? null : artifact.id)}
                      onRenameArtifact={onRenameArtifact}
                      onCopyArtifact={onCopyArtifact}
                      onDownloadArtifact={onDownloadArtifact}
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
        <div className="border-t border-surface-border px-4 py-3">
          <button type="button" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand-hover">
            <Pencil className="h-4 w-4" />
            {t("notebook.studio.summary")}
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
                  {sourcePopoverKey === `viewer-${viewerArtifact.id}` && <SourcePopover sources={sourcesForArtifact(viewerArtifact)} title={t("notebook.sourcesTitle")} emptyLabel={t("notebook.sourcesEmpty")} />}
                </span>
              </div>
            </div>
            <button type="button" onClick={() => setViewerArtifactId(null)} className="rounded-full p-2 text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary" title={t("common.close")}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-surface-card p-5">
            {renderActiveArtifact(viewerArtifact, t, true, onDownloadArtifact, onExplainFlashcard, onExplainQuiz)}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
