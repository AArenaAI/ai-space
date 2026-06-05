"use client";

import { BarChart3, ChevronRight, Copy, Download, FileQuestion, FileText, Layers3, Loader2, Map, MoreHorizontal, Pencil, Presentation, Sparkles, Table2, Trash2 } from "lucide-react";
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
  artifacts: NotebookStudioArtifact[];
  activeArtifactId: string | null;
  generatingType?: NotebookStudioActionId | null;
  onGenerate: (type: NotebookStudioActionId) => void;
  onOpenArtifact: (artifactId: string) => void;
  onRenameArtifact?: (artifact: NotebookStudioArtifact) => void;
  onDeleteArtifact?: (artifact: NotebookStudioArtifact) => void;
  onCopyArtifact?: (artifact: NotebookStudioArtifact) => void;
  onDownloadArtifact?: (artifact: NotebookStudioArtifact) => void;
};

const actionIconMap: Record<NotebookStudioActionId, typeof Table2> = {
  table: Table2,
  summary: FileText,
  faq: FileQuestion,
  briefing: BarChart3,
  mindmap: Map,
  slides: Presentation,
};

const artifactIconMap: Record<NotebookStudioArtifact["type"], typeof Table2> = {
  table: Table2,
  summary: FileText,
  faq: FileQuestion,
  briefing: BarChart3,
  mindmap: Map,
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

function renderTableArtifact(artifact: Extract<NotebookStudioArtifact, { type: "table" }>, t: (key: string, params?: Record<string, string>) => string) {
  return (
    <div className="max-h-[460px] overflow-auto rounded-3xl border border-surface-border bg-surface-card shadow-sm">
      <table className="min-w-[760px] border-collapse text-left text-xs">
        <thead className="sticky top-0 z-10 bg-surface-elevated text-text-tertiary">
          <tr>
            <th className="border-b border-surface-border px-3 py-2 font-semibold">{t("notebook.studio.columnModule")}</th>
            <th className="border-b border-surface-border px-3 py-2 font-semibold">{t("notebook.studio.columnCapability")}</th>
            <th className="border-b border-surface-border px-3 py-2 font-semibold">{t("notebook.studio.columnStatus")}</th>
            <th className="border-b border-surface-border px-3 py-2 font-semibold">{t("notebook.studio.columnImplementation")}</th>
            <th className="border-b border-surface-border px-3 py-2 font-semibold">{t("notebook.studio.columnValue")}</th>
            <th className="border-b border-surface-border px-3 py-2 font-semibold">{t("notebook.studio.columnSource")}</th>
          </tr>
        </thead>
        <tbody>
          {artifact.rows.map((row, index) => (
            <tr key={`${row.module}-${index}`} className="align-top hover:bg-surface-hover/60">
              <td className="border-b border-surface-border px-3 py-3 font-semibold text-text-primary">{row.module}</td>
              <td className="border-b border-surface-border px-3 py-3 leading-5 text-text-secondary">{row.capability}</td>
              <td className="border-b border-surface-border px-3 py-3 text-text-secondary">{row.status}</td>
              <td className="border-b border-surface-border px-3 py-3 leading-5 text-text-secondary">{row.implementation}</td>
              <td className="border-b border-surface-border px-3 py-3 leading-5 text-text-secondary">{row.value}</td>
              <td className="border-b border-surface-border px-3 py-3 text-brand">{row.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderMindmapArtifact(artifact: Extract<NotebookStudioArtifact, { type: "mindmap" }>) {
  const root = artifact.nodes.find((node) => node.id === "root") || artifact.nodes[0];
  const childNodes = artifact.nodes.filter((node) => node.id !== root?.id);
  return (
    <div className="space-y-3 p-4">
      {root && (
        <div className="rounded-3xl border border-brand-border bg-brand-muted/30 p-4 text-center">
          <div className="text-sm font-semibold text-text-primary">{root.label}</div>
          {root.summary && <p className="mt-2 text-xs leading-5 text-text-secondary">{root.summary}</p>}
        </div>
      )}
      <div className="space-y-2.5">
        {childNodes.map((node) => {
          const incoming = artifact.edges.find((edge) => edge.to === node.id);
          return (
            <div key={node.id} className="rounded-2xl border border-surface-border bg-surface-elevated/60 p-3">
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-text-primary">{node.label}</div>
                  {node.summary && <p className="mt-1.5 text-xs leading-5 text-text-secondary">{node.summary}</p>}
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-text-tertiary">
                    {incoming?.label && <span>{incoming.label}</span>}
                    {node.source && <span className="text-brand">{node.source}</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderActiveArtifact(artifact: NotebookStudioArtifact, t: (key: string, params?: Record<string, string>) => string) {
  switch (artifact.type) {
    case "table":
      return renderTableArtifact(artifact, t);
    case "mindmap":
      return renderMindmapArtifact(artifact);
    default:
      return renderTextArtifact(artifact);
  }
}

export function NotebookStudioPanel({
  artifacts,
  activeArtifactId,
  generatingType,
  onGenerate,
  onOpenArtifact,
  onRenameArtifact,
  onDeleteArtifact,
  onCopyArtifact,
  onDownloadArtifact,
}: NotebookStudioPanelProps) {
  const { t } = useI18n();
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
    <aside className="flex h-full w-[390px] shrink-0 flex-col border-l border-surface-border bg-surface-elevated/70">
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
                const isActive = artifact.id === activeArtifactId;
                const Icon = artifactIconMap[artifact.type];
                return (
                  <div key={artifact.id} className={cn("rounded-2xl border bg-surface-card transition", isActive ? "border-brand-border bg-brand-muted/30" : "border-surface-border")}>
                    <button type="button" onClick={() => onOpenArtifact(artifact.id)} className="flex w-full items-center gap-3 p-3 text-left">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500"><Icon className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-text-primary">{artifact.title}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-tertiary"><span>{artifact.subtitle}</span><span>·</span><span>{formatTime(artifact.createdAt)}</span></div>
                      </div>
                      <ChevronRight className={cn("h-4 w-4 shrink-0 text-text-tertiary transition", isActive && "rotate-90 text-brand")} />
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
            {activeArtifact && (
              <div className="mt-4">
                {renderActiveArtifact(activeArtifact, t)}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
