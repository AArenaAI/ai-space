"use client";

import { useMemo, useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, FileQuestion, FileText, Layers3, Loader2, Map as MapIcon, Minus, MoreHorizontal, Pencil, Plus, Presentation, RefreshCw, Sparkles, Table2, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type NotebookStudioActionId = "table" | "summary" | "faq" | "briefing" | "mindmap" | "slides";

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
    };

type NotebookStudioPanelProps = {
  width?: number;
  artifacts: NotebookStudioArtifact[];
  activeArtifactId: string | null;
  generatingType?: NotebookStudioActionId | null;
  selectedSourceCount?: number;
  onGenerate: (type: NotebookStudioActionId) => void;
  onOpenArtifact: (artifactId: string | null) => void;
  onRenameArtifact?: (artifact: NotebookStudioArtifact) => void;
  onDeleteArtifact?: (artifact: NotebookStudioArtifact) => void;
  onCopyArtifact?: (artifact: NotebookStudioArtifact) => void;
  onDownloadArtifact?: (artifact: NotebookStudioArtifact) => void;
  onExportTableToGoogleSheets?: (artifact: Extract<NotebookStudioArtifact, { type: "table" }>) => void;
};

const actionIconMap: Record<NotebookStudioActionId, typeof Table2> = {
  table: Table2,
  summary: FileText,
  faq: FileQuestion,
  briefing: BarChart3,
  mindmap: MapIcon,
  slides: Presentation,
};

const artifactIconMap: Record<NotebookStudioArtifact["type"], typeof Table2> = {
  table: Table2,
  summary: FileText,
  faq: FileQuestion,
  briefing: BarChart3,
  mindmap: MapIcon,
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

type MindmapBranch = NotebookStudioMindmapNode & { children: MindmapBranch[] };

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

function MindmapArtifactView({ artifact }: { artifact: Extract<NotebookStudioArtifact, { type: "mindmap" }> }) {
  const root = useMemo(() => buildMindmapTree(artifact), [artifact]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set([root?.id || "root"]));
  const toggle = (id: string) => setExpandedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  if (!root) return null;
  return (
    <div className="relative min-h-0 flex-1 overflow-auto rounded-xl border border-surface-border bg-white p-4 dark:bg-surface-card">
      <div className="absolute left-3 top-3 z-10 flex flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-card/95 shadow-sm">
        <button className="p-2 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" type="button"><Plus className="h-3.5 w-3.5" /></button>
        <button className="border-t border-surface-border p-2 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" type="button"><Minus className="h-3.5 w-3.5" /></button>
        <button className="border-t border-surface-border p-2 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" type="button"><Download className="h-3.5 w-3.5" /></button>
      </div>
      <div className="flex min-w-[920px] items-center justify-center px-12 py-10">
        <MindmapNode node={root} depth={0} expandedIds={expandedIds} onToggle={toggle} />
      </div>
    </div>
  );
}

function MindmapNode({ node, depth, expandedIds, onToggle }: { node: MindmapBranch; depth: number; expandedIds: Set<string>; onToggle: (id: string) => void }) {
  const hasChildren = node.children.length > 0;
  const expanded = expandedIds.has(node.id);
  const palette = depth === 0 ? "bg-violet-100 text-violet-950 border-violet-200" : depth === 1 ? "bg-sky-100 text-sky-950 border-sky-200" : "bg-emerald-100 text-emerald-950 border-emerald-200";
  return (
    <div className="flex items-center">
      <div className="relative flex items-center">
        <div className={cn("min-w-[180px] max-w-[240px] rounded-2xl border px-4 py-3 text-center shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md", palette)}>
          <div className="text-sm font-semibold leading-5">{node.label}</div>
          {depth > 0 && node.source && <div className="mt-1 text-[11px] opacity-70">{node.source}</div>}
        </div>
        {hasChildren && (
          <button type="button" onClick={() => onToggle(node.id)} className="absolute -right-3 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-surface-border bg-surface-card text-text-secondary shadow-sm transition hover:scale-110 hover:text-brand" aria-expanded={expanded}>
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-300", expanded && "rotate-180")} />
          </button>
        )}
      </div>
      {hasChildren && (
        <div className={cn("grid transition-all duration-300 ease-out", expanded ? "grid-cols-[42px_auto] opacity-100" : "grid-cols-[0px_auto] opacity-0")}>
          <div className="relative h-full min-h-20 overflow-hidden">
            <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-violet-200" />
          </div>
          <div className={cn("space-y-4 overflow-hidden transition-all duration-300", expanded ? "translate-x-0" : "-translate-x-4 pointer-events-none")}>
            {node.children.map((child) => <MindmapNode key={child.id} node={child} depth={depth + 1} expandedIds={expandedIds} onToggle={onToggle} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function renderActiveArtifact(artifact: NotebookStudioArtifact, t: (key: string, params?: Record<string, string>) => string, expanded = false) {
  switch (artifact.type) {
    case "table":
      return renderTableArtifact(artifact, t, expanded);
    case "mindmap":
      return <MindmapArtifactView artifact={artifact} />;
    default:
      return renderTextArtifact(artifact);
  }
}

function GeneratingStudioCard({ type, sourceCount, t }: { type: NotebookStudioActionId; sourceCount: number; t: (key: string, params?: Record<string, string>) => string }) {
  const titleKey = type === "mindmap" ? "notebook.studio.generatingMindmap" : "notebook.studio.generatingTable";
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
}) {
  const closeAndRun = (callback?: () => void) => {
    onToggle();
    callback?.();
  };
  return (
    <div className="relative ml-auto">
      <button type="button" onClick={onToggle} className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" title={t("notebook.studio.moreActions")}>
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
  onGenerate,
  onOpenArtifact,
  onRenameArtifact,
  onDeleteArtifact,
  onCopyArtifact,
  onDownloadArtifact,
  onExportTableToGoogleSheets,
}: NotebookStudioPanelProps) {
  const { t } = useI18n();
  const [openMenuArtifactId, setOpenMenuArtifactId] = useState<string | null>(null);
  const activeArtifact = artifacts.find((artifact) => artifact.id === activeArtifactId) || null;
  const actions: Array<{ id: NotebookStudioActionId; title: string; desc: string; accent: string }> = [
    { id: "table", title: t("notebook.studio.table"), desc: t("notebook.studio.tableDesc"), accent: "from-emerald-500/15 to-cyan-500/10 text-emerald-500" },
    { id: "summary", title: t("notebook.studio.summary"), desc: t("notebook.studio.summaryDesc"), accent: "from-brand/15 to-purple-500/10 text-brand" },
    { id: "faq", title: t("notebook.studio.faq"), desc: t("notebook.studio.faqDesc"), accent: "from-amber-500/15 to-orange-500/10 text-amber-500" },
    { id: "briefing", title: t("notebook.studio.briefing"), desc: t("notebook.studio.briefingDesc"), accent: "from-blue-500/15 to-sky-500/10 text-blue-500" },
    { id: "mindmap", title: t("notebook.studio.mindmap"), desc: t("notebook.studio.mindmapDesc"), accent: "from-violet-500/15 to-fuchsia-500/10 text-violet-500" },
    { id: "slides", title: t("notebook.studio.slides"), desc: t("notebook.studio.slidesDesc"), accent: "from-rose-500/15 to-pink-500/10 text-rose-500" },
  ];

  return (
    <aside className="flex h-full shrink-0 flex-col bg-surface-elevated/70" style={{ width }}>
      {activeArtifact ? (
        <div className="flex min-h-0 flex-1 flex-col bg-surface-card">
          <div className="flex items-start gap-3 border-b border-surface-border bg-surface-card px-4 py-4">
            <button type="button" onClick={() => onOpenArtifact(null)} className="mt-1 rounded-lg p-1.5 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" title={t("notebook.studio.backToOutputs")}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium leading-4 text-text-tertiary">Studio &gt; {activeArtifact.type === "table" ? t("notebook.studio.table") : activeArtifact.type}</div>
              <h3 className="mt-1 line-clamp-2 text-lg font-bold leading-6 tracking-[-0.01em] text-text-primary">{activeArtifact.title}</h3>
              <button type="button" className="mt-2.5 rounded-full border border-surface-border bg-surface-elevated px-3 py-1 text-[11px] font-medium text-text-secondary hover:border-brand-border hover:text-brand">
                {t("notebook.studio.viewSources", { count: String(activeArtifact.sourceCount) })}
              </button>
            </div>
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
            {renderActiveArtifact(activeArtifact, t, true)}
            <div className="mt-3 flex items-center gap-2 border-t border-surface-border pt-3">
              <button type="button" className="rounded-full border border-surface-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-emerald-500/40 hover:text-emerald-500">{t("notebook.studio.good")}</button>
              <button type="button" className="rounded-full border border-surface-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-red-500/40 hover:text-red-500">{t("notebook.studio.bad")}</button>
            </div>
          </div>
        </div>
      ) : (
      <>
      <div className="border-b border-surface-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-tertiary">Studio</p>
            <h2 className="mt-1 text-lg font-semibold text-text-primary">{t("notebook.studio.title")}</h2>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-muted text-brand"><Sparkles className="h-5 w-5" /></div>
        </div>
        <p className="text-xs leading-5 text-text-tertiary">{t("notebook.studio.subtitle")}</p>
      </div>

      <div className="border-b border-surface-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">{t("notebook.studio.actions")}</h3>
          <span className="rounded-full bg-surface-card px-2 py-1 text-[11px] text-text-tertiary">{t("notebook.studio.beta")}</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {actions.map((action) => {
            const Icon = actionIconMap[action.id];
            const isGenerating = generatingType === action.id;
            return (
              <button key={action.id} type="button" onClick={() => onGenerate(action.id)} disabled={Boolean(generatingType)} className="group min-h-[112px] rounded-2xl border border-surface-border bg-surface-card p-3 text-left transition hover:border-brand-border hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-70">
                <div className={cn("mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br", action.accent)}>
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                </div>
                <div className="text-sm font-semibold text-text-primary">{action.title}</div>
                <p className="mt-1 line-clamp-2 text-xs leading-4 text-text-tertiary">{action.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{t("notebook.studio.outputs")}</h3>
            <p className="mt-0.5 text-xs text-text-tertiary">{t("notebook.studio.outputsDesc")}</p>
          </div>
          <MoreHorizontal className="h-4 w-4 text-text-tertiary" />
        </div>
        {(generatingType === "table" || generatingType === "mindmap") && <div className="p-4 pb-0"><GeneratingStudioCard type={generatingType} sourceCount={selectedSourceCount} t={t} /></div>}
        {artifacts.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-card text-text-tertiary"><Layers3 className="h-5 w-5" /></div>
            <p className="text-sm font-medium text-text-primary">{t("notebook.studio.emptyTitle")}</p>
            <p className="mt-2 text-xs leading-5 text-text-tertiary">{t("notebook.studio.emptyDesc")}</p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-2.5">
              {artifacts.map((artifact) => {
                const Icon = artifactIconMap[artifact.type];
                return (
                  <div key={artifact.id} className="rounded-2xl border border-surface-border bg-surface-card transition">
                    <button type="button" onClick={() => onOpenArtifact(artifact.id)} className="flex w-full items-center gap-3 p-3 text-left">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500"><Icon className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-text-primary">{artifact.title}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-tertiary"><span>{artifact.subtitle}</span><span>·</span><span>{formatTime(artifact.createdAt)}</span></div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary transition" />
                    </button>
                    <div className="flex items-center gap-1 border-t border-surface-border/70 px-3 py-2">
                      {onRenameArtifact && <button type="button" onClick={() => onRenameArtifact(artifact)} className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" title={t("notebook.studio.renameOutput")}><Pencil className="h-3.5 w-3.5" /></button>}
                      {onCopyArtifact && <button type="button" onClick={() => onCopyArtifact(artifact)} className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" title={t("notebook.studio.copyOutput")}><Copy className="h-3.5 w-3.5" /></button>}
                      {onDownloadArtifact && <button type="button" onClick={() => onDownloadArtifact(artifact)} className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" title={t("notebook.studio.downloadOutput")}><Download className="h-3.5 w-3.5" /></button>}
                      {onDeleteArtifact && <button type="button" onClick={() => onDeleteArtifact(artifact)} className="ml-auto rounded-lg p-1.5 text-text-tertiary hover:bg-red-500/10 hover:text-red-500" title={t("notebook.studio.deleteOutput")}><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      </>
      )}
    </aside>
  );
}
