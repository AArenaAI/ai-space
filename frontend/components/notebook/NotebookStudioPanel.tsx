"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { BarChart3, ChevronLeft, ChevronRight, ChevronsRight, Copy, Download, ExternalLink, FileQuestion, FileText, Layers3, Loader2, Map as MapIcon, Maximize2, MoreHorizontal, Pencil, Presentation, RefreshCw, Sparkles, Table2, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
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

export type NotebookStudioSource = {
  id: number;
  filename: string;
  mimeType?: string;
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
  sourceFiles?: NotebookStudioSource[];
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
      <div className="absolute left-3 top-3 z-10 flex flex-col overflow-hidden rounded-xl border border-surface-border bg-white/95 shadow-sm dark:bg-surface-card/95">
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
          className="absolute -right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-white text-indigo-500 shadow-sm transition hover:scale-105 hover:text-indigo-700 dark:border-surface-border dark:bg-surface-elevated"
          aria-label={expanded ? "Collapse mind map branch" : "Expand mind map branch"}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-300", expanded && "rotate-90")} />
        </button>
      )}
    </div>
  );
}

function renderActiveArtifact(artifact: NotebookStudioArtifact, t: (key: string, params?: Record<string, string>) => string, expanded = false, onDownloadArtifact?: (artifact: NotebookStudioArtifact) => void) {
  switch (artifact.type) {
    case "table":
      return renderTableArtifact(artifact, t, expanded);
    case "mindmap":
      return <MindmapArtifactView artifact={artifact} onDownload={onDownloadArtifact} />;
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
  sourceFiles = [],
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
  const [viewerArtifactId, setViewerArtifactId] = useState<string | null>(null);
  const [sourcePopoverKey, setSourcePopoverKey] = useState<string | null>(null);
  const activeArtifact = artifacts.find((artifact) => artifact.id === activeArtifactId) || null;
  const viewerArtifact = artifacts.find((artifact) => artifact.id === viewerArtifactId) || null;
  const sourcesForArtifact = (artifact: NotebookStudioArtifact) => sourceFiles.slice(0, Math.max(0, artifact.sourceCount || 0));
  const actions: Array<{ id: NotebookStudioActionId; title: string; desc: string; accent: string }> = [
    { id: "table", title: t("notebook.studio.table"), desc: t("notebook.studio.tableDesc"), accent: "from-emerald-500/15 to-cyan-500/10 text-emerald-500" },
    { id: "summary", title: t("notebook.studio.summary"), desc: t("notebook.studio.summaryDesc"), accent: "from-brand/15 to-purple-500/10 text-brand" },
    { id: "faq", title: t("notebook.studio.faq"), desc: t("notebook.studio.faqDesc"), accent: "from-amber-500/15 to-orange-500/10 text-amber-500" },
    { id: "briefing", title: t("notebook.studio.briefing"), desc: t("notebook.studio.briefingDesc"), accent: "from-blue-500/15 to-sky-500/10 text-blue-500" },
    { id: "mindmap", title: t("notebook.studio.mindmap"), desc: t("notebook.studio.mindmapDesc"), accent: "from-violet-500/15 to-fuchsia-500/10 text-violet-500" },
    { id: "slides", title: t("notebook.studio.slides"), desc: t("notebook.studio.slidesDesc"), accent: "from-rose-500/15 to-pink-500/10 text-rose-500" },
  ];

  return (
    <>
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
            {renderActiveArtifact(activeArtifact, t, true, onDownloadArtifact)}
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
                  <div key={artifact.id} className="group relative rounded-2xl border border-surface-border bg-surface-card transition">
                    <button type="button" onClick={() => setViewerArtifactId(artifact.id)} className="absolute right-10 top-2 z-10 rounded-full bg-surface-elevated p-1.5 text-text-tertiary opacity-0 shadow-sm transition hover:bg-surface-hover hover:text-text-primary group-hover:opacity-100" title={t("notebook.studio.expandViewer")}>
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => onOpenArtifact(artifact.id)} className="flex w-full items-center gap-3 p-3 pr-16 text-left">
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
            {renderActiveArtifact(viewerArtifact, t, true, onDownloadArtifact)}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
