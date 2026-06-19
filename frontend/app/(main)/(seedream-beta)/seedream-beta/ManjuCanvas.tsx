"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  ReactFlow,
  ReactFlowProvider,
  Position,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnNodesChange,
  type ReactFlowInstance,
  MarkerType,
  Panel,
  applyNodeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import {
  Box,
  Clapperboard,
  Image,
  LocateFixed,
  Maximize2,
  Music,
  Sparkles,
  Type,
  Video,
  WandSparkles,
  Plus,
  Code2,
  Link2,
  Scissors,
  ChevronRight,
} from "lucide-react";
import ManjuNodeContent from "./ManjuNodeContent";
import BottomNodeComposer, { type ComposerSettings } from "./BottomNodeComposer";

export interface CanvasNode {
  id: string;
  type: "script" | "assets" | "shot" | "image" | "video" | "director" | "generator" | "text" | "group";
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data?: Record<string, unknown>;
  selected?: boolean;
  collapsed?: boolean;
  status?: "empty" | "draft" | "generating" | "done" | "error";
}

export interface CanvasConnection {
  id: string;
  from: string;
  to: string;
  label?: string;
  type?: "sequence" | "scene-transition" | "context" | "binding" | "generator";
}

export type CanvasAssetDropPayload = {
  id: string;
  name: string;
  kind?: string;
  summary?: string;
  image?: string;
  source?: "node" | "library";
};

export interface ManjuCanvasProps {
  nodes: CanvasNode[];
  connections?: CanvasConnection[];
  onNodeMove?: (id: string, x: number, y: number) => void;
  onNodeSelect?: (id: string | null) => void;
  onNodeDoubleClick?: (node: CanvasNode) => void;
  onNodeContextMenu?: (node: CanvasNode, e: React.MouseEvent) => void;
  onCanvasContextMenu?: (e: React.MouseEvent) => void;
  onGenerateAsset?: (assetId: string) => void;
  onAddNode?: (type: CanvasNode["type"], x: number, y: number, sourceNodeId?: string, sourceSide?: "left" | "right") => void;
  onDeleteNode?: (id: string) => void;
  onToggleCollapse?: (id: string) => void;
  onAutoLayout?: () => void;
  onBatchGenerate?: (nodeIds: string[], mode: "image" | "video") => void;
  onConnectNodes?: (from: string, to: string) => void;
  onDropAsset?: (asset: CanvasAssetDropPayload, x: number, y: number) => void;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[];
  readOnly?: boolean;
  onDropAddNode?: (type: string, x: number, y: number) => void;

  /* 资产节点操作 */
  onNodeUpload?: (nodeId: string) => void;
  onNodeGenerate?: (nodeId: string) => void;
  onNodePickFromLibrary?: (nodeId: string) => void;
  nodeAssets?: Array<{ id: string; publicId?: string; name: string; category?: string; url?: string; image_url?: string }>;
  mentionAssets?: Array<{ id: string; name: string; kind?: string; category?: string; summary?: string; imageUrl?: string; image_url?: string; url?: string }>;
  composerSettings?: ComposerSettings;
  composerOptions?: {
    imageAspects: string[];
    imageResolutions: string[];
    videoModels: string[];
    videoAspects: string[];
    videoResolutions: string[];
    videoDurations: number[];
  };
  composerGenerating?: boolean;
  onUpdateNodeContent?: (nodeId: string, updates: { title?: string; body?: string }) => void;
  onComposerSettingsChange?: (nodeId: string, updates: Partial<ComposerSettings>) => void;
  onBindAssetMention?: (nodeId: string, assetId: string) => void;
}

type SeedreamNodeData = {
  canvasNode: CanvasNode;
  nodeAssets?: Array<{ id: string; publicId?: string; name: string; category?: string; url?: string; image_url?: string }>;
  mentionAssets?: ManjuCanvasProps["mentionAssets"];
  composerSettings?: ComposerSettings;
  composerOptions?: ManjuCanvasProps["composerOptions"];
  composerGenerating?: boolean;
  viewportMoving?: boolean;
};

type CanvasActionHandlers = Pick<
  ManjuCanvasProps,
  "onNodeUpload" | "onNodeGenerate" | "onNodePickFromLibrary" | "onNodeSelect"
>;
type ComposerActionHandlers = Pick<ManjuCanvasProps, "onUpdateNodeContent" | "onComposerSettingsChange" | "onBindAssetMention" | "onNodeGenerate" | "onNodeSelect">;

type NodeAddMenu = {
  nodeId: string;
  side: "left" | "right";
  x: number;
  y: number;
};

type NodeAddMenuItem = {
  type: CanvasNode["type"] | "audio" | "composite" | "reference";
  label: string;
  icon: typeof Type;
  badge?: "Beta" | "NEW";
  disabled?: boolean;
  submenu?: boolean;
};

const nodeAddMenuItems: NodeAddMenuItem[] = [
  { type: "text", label: "文本素材", icon: Type },
  { type: "image", label: "分镜图片", icon: Image },
  { type: "video", label: "视频片段", icon: Video },
  { type: "composite", label: "视频合成", icon: Scissors, badge: "Beta" },
  { type: "director", label: "导演台", icon: Maximize2, badge: "NEW" },
  { type: "audio", label: "音频", icon: Music, disabled: true },
  { type: "script", label: "剧本源", icon: Code2, submenu: true },
  { type: "reference", label: "参考节点", icon: Link2 },
];

const canvasActionHandlers: { current: CanvasActionHandlers } = { current: {} };
const composerActionHandlers: { current: ComposerActionHandlers } = { current: {} };
const canvasNodeAddMenuHandlers: { current: { open?: (nodeId: string, side: "left" | "right", event: React.MouseEvent) => void } } = { current: {} };

const handleBaseClass =
  "!top-1/2 !z-20 !flex !h-8 !w-8 !-translate-y-1/2 !items-center !justify-center !rounded-full !border !border-slate-200/80 !bg-white !text-slate-700 !opacity-100 !shadow-sm transition-colors hover:!border-slate-300 hover:!bg-slate-950 hover:!text-white";

function nodeVisual(type: CanvasNode["type"]) {
  switch (type) {
    case "script":
      return { label: "剧本源", icon: Type, accent: "from-violet-500 to-fuchsia-500", soft: "bg-violet-500/10 text-violet-500" };
    case "assets":
      return { label: "资产", icon: Box, accent: "from-amber-400 to-orange-500", soft: "bg-amber-500/10 text-amber-500" };
    case "shot":
      return { label: "镜头卡", icon: Clapperboard, accent: "from-sky-400 to-cyan-500", soft: "bg-sky-500/10 text-sky-500" };
    case "image":
      return { label: "分镜图片", icon: Image, accent: "from-emerald-400 to-teal-500", soft: "bg-emerald-500/10 text-emerald-500" };
    case "video":
      return { label: "视频片段", icon: Video, accent: "from-rose-400 to-pink-500", soft: "bg-rose-500/10 text-rose-500" };
    case "director":
      return { label: "导演台", icon: Maximize2, accent: "from-indigo-400 to-blue-500", soft: "bg-indigo-500/10 text-indigo-500" };
    case "generator":
      return { label: "生成器组", icon: WandSparkles, accent: "from-fuchsia-400 to-rose-500", soft: "bg-fuchsia-500/10 text-fuchsia-500" };
    default:
      return { label: "文本素材", icon: Type, accent: "from-slate-400 to-slate-500", soft: "bg-surface-card text-text-secondary" };
  }
}

function statusLabel(status?: CanvasNode["status"]) {
  if (status === "done") return "完成";
  if (status === "draft") return "草稿";
  if (status === "error") return "异常";
  return "待生成";
}

function generateAutoConnections(nodes: CanvasNode[]): CanvasConnection[] {
  const connections: CanvasConnection[] = [];
  const sceneGroups = new Map<string, CanvasNode[]>();

  nodes.forEach((node) => {
    if (node.type === "shot" || node.type === "image" || node.type === "video") {
      const scene = (node.data as Record<string, unknown>)?.scene as string || "未分组";
      if (!sceneGroups.has(scene)) sceneGroups.set(scene, []);
      sceneGroups.get(scene)!.push(node);
    }
  });

  sceneGroups.forEach((groupNodes) => {
    const sorted = [...groupNodes].sort((a, b) => {
      const aIdx = ((a.data as Record<string, unknown>)?.index as number) || 0;
      const bIdx = ((b.data as Record<string, unknown>)?.index as number) || 0;
      return aIdx - bIdx;
    });
    for (let i = 0; i < sorted.length - 1; i++) {
      connections.push({
        id: `conn-${sorted[i].id}-${sorted[i + 1].id}`,
        from: sorted[i].id,
        to: sorted[i + 1].id,
        label: "→",
        type: "sequence",
      });
    }
  });

  const sceneNames = Array.from(sceneGroups.keys());
  for (let i = 0; i < sceneNames.length - 1; i++) {
    const currentScene = sceneGroups.get(sceneNames[i])!;
    const nextScene = sceneGroups.get(sceneNames[i + 1])!;
    const sortedCurrent = [...currentScene].sort((a, b) => (((a.data as Record<string, unknown>)?.index as number) || 0) - (((b.data as Record<string, unknown>)?.index as number) || 0));
    const sortedNext = [...nextScene].sort((a, b) => (((a.data as Record<string, unknown>)?.index as number) || 0) - (((b.data as Record<string, unknown>)?.index as number) || 0));
    const lastOfCurrent = sortedCurrent[sortedCurrent.length - 1];
    const firstOfNext = sortedNext[0];
    if (lastOfCurrent && firstOfNext) {
      connections.push({
        id: `scene-transition-${lastOfCurrent.id}-${firstOfNext.id}`,
        from: lastOfCurrent.id,
        to: firstOfNext.id,
        label: "转场",
        type: "scene-transition",
      });
    }
  }

  return connections;
}

const SeedreamFlowNode = memo(function SeedreamFlowNode({ data, selected }: NodeProps<Node<SeedreamNodeData>>) {
  const node = data.canvasNode;
  const visual = nodeVisual(node.type);
  const Icon = visual.icon;

  return (
    <div
      onClick={() => {
        canvasActionHandlers.current.onNodeSelect?.(node.id);
      }}
      className={cn(
        "group relative flex flex-col rounded-[24px] will-change-transform [contain:layout_paint_style]",
        selected ? "z-10" : ""
      )}
      style={{ width: node.width || 380, minHeight: node.collapsed ? undefined : node.height || 430 }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={cn(handleBaseClass, "!left-[-16px]")}
        style={{ width: 32, height: 32 }}
        isConnectable
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          canvasActionHandlers.current.onNodeSelect?.(node.id);
          canvasNodeAddMenuHandlers.current.open?.(node.id, "left", event);
        }}
      >
        <Plus className="pointer-events-none h-4 w-4 stroke-[2.4]" />
      </Handle>
      <Handle
        type="source"
        position={Position.Right}
        className={cn(handleBaseClass, "!right-[-16px]")}
        style={{ width: 32, height: 32 }}
        isConnectable
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          canvasActionHandlers.current.onNodeSelect?.(node.id);
          canvasNodeAddMenuHandlers.current.open?.(node.id, "right", event);
        }}
      >
        <Plus className="pointer-events-none h-4 w-4 stroke-[2.4]" />
      </Handle>
      <div
        className={cn(
          "flex flex-1 flex-col overflow-hidden rounded-[24px] border bg-white shadow-[0_6px_16px_rgba(15,23,42,0.08)] ring-1 ring-white/70",
          selected ? "border-slate-900" : "border-white/80 hover:border-slate-300"
        )}
      >
        <div className={cn("h-1 bg-gradient-to-r", visual.accent)} />
        <div className="flex items-center gap-3 px-4 py-3">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", visual.soft)}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-slate-900">{node.title}</span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
                {visual.label}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-slate-400">{statusLabel(node.status)}</div>
          </div>
        </div>
        {!node.collapsed && (
          <div className="flex flex-1 border-t border-black/5 bg-slate-50/55 p-3">
            <ManjuNodeContent
              node={node}
              onUpload={canvasActionHandlers.current.onNodeUpload}
              onGenerate={canvasActionHandlers.current.onNodeGenerate}
              onPickFromLibrary={canvasActionHandlers.current.onNodePickFromLibrary}
              onSelect={canvasActionHandlers.current.onNodeSelect}
              assets={data.nodeAssets}
            />
          </div>
        )}
      </div>
      {selected && !data.viewportMoving && data.composerSettings && data.composerOptions && (
        <BottomNodeComposer
          node={node}
          mentionAssets={data.mentionAssets}
          settings={data.composerSettings}
          options={data.composerOptions}
          generating={data.composerGenerating}
          variant="attached"
          onUpdate={composerActionHandlers.current.onUpdateNodeContent}
          onSettingsChange={composerActionHandlers.current.onComposerSettingsChange}
          onBindAssetMention={composerActionHandlers.current.onBindAssetMention}
          onGenerate={composerActionHandlers.current.onNodeGenerate}
          onClose={() => composerActionHandlers.current.onNodeSelect?.(null)}
        />
      )}
    </div>
  );
});

const nodeTypes = { seedream: SeedreamFlowNode };
const defaultEdgeOptions = { type: "bezier" };
const proOptions = { hideAttribution: true };

function stableNodesSignature(nodes: CanvasNode[]) {
  return nodes
    .map((node) =>
      [
        node.id,
        node.type,
        node.title,
        node.x,
        node.y,
        node.width,
        node.height,
        node.collapsed ? 1 : 0,
        node.status || "",
        JSON.stringify(node.data || {}),
      ].join("∷")
    )
    .join("∥");
}

function stableConnectionsSignature(connections: CanvasConnection[]) {
  return connections.map((connection) => [connection.id, connection.from, connection.to, connection.label || "", connection.type || ""].join("∷")).join("∥");
}

function stableAssetsSignature(assets?: Array<{ id: string; name: string; category?: string; kind?: string; summary?: string; url?: string; image_url?: string; imageUrl?: string }>) {
  return (assets || []).map((asset) => [asset.id, asset.name, asset.kind || asset.category || "", asset.summary || "", asset.url || asset.image_url || asset.imageUrl || ""].join("∷")).join("∥");
}

function edgeType(connection?: CanvasConnection["type"]) {
  return connection === "scene-transition" ? "smoothstep" : "bezier";
}

function edgeColor(connection?: CanvasConnection["type"]) {
  if (connection === "scene-transition") return "#f59e0b";
  if (connection === "binding") return "#a855f7";
  if (connection === "generator") return "#ec4899";
  return "#38bdf8";
}

function edgeWidth(connection?: CanvasConnection["type"]) {
  if (connection === "scene-transition") return 1.8;
  if (connection === "binding") return 2;
  return 2.2;
}

function toFlowNodes(
  nodes: CanvasNode[],
  props: Pick<ManjuCanvasProps, "nodeAssets" | "mentionAssets" | "selectedNodeId" | "composerSettings" | "composerOptions" | "composerGenerating"> & { viewportMoving?: boolean }
): Node<SeedreamNodeData>[] {
  return nodes.map((node) => ({
    id: node.id,
    type: "seedream",
    position: { x: node.x, y: node.y },
    selected: props.selectedNodeId === node.id || node.selected,
    draggable: node.type !== "group",
    data: {
      canvasNode: node,
      nodeAssets: props.nodeAssets,
      mentionAssets: props.mentionAssets,
      composerSettings: props.composerSettings,
      composerOptions: props.composerOptions,
      composerGenerating: props.composerGenerating,
      viewportMoving: props.viewportMoving,
    },
  }));
}

function toFlowEdges(connections: CanvasConnection[]): Edge[] {
  return connections.map((connection) => ({
    id: connection.id,
    source: connection.from,
    target: connection.to,
    label: connection.label && connection.label !== "→" ? connection.label : undefined,
    type: edgeType(connection.type),
    animated: connection.type === "scene-transition",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: edgeColor(connection.type),
    },
    style: {
      stroke: edgeColor(connection.type),
      strokeWidth: edgeWidth(connection.type),
      strokeDasharray: connection.type === "scene-transition" ? "7 6" : undefined,
    },
    labelStyle: { fill: "#64748b", fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: "rgba(255,255,255,0.88)", fillOpacity: 0.88 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 8,
  }));
}

function ManjuCanvasInner({
  nodes,
  connections: propConnections = [],
  onNodeMove,
  onNodeSelect,
  onNodeDoubleClick,
  onNodeContextMenu,
  onCanvasContextMenu,
  onAddNode,
  onDeleteNode,
  onAutoLayout,
  onBatchGenerate,
  onConnectNodes,
  onDropAsset,
  selectedNodeId,
  readOnly,
  onNodeUpload,
  onNodeGenerate,
  onNodePickFromLibrary,
  nodeAssets,
  mentionAssets,
  composerSettings,
  composerOptions,
  composerGenerating,
  onUpdateNodeContent,
  onComposerSettingsChange,
  onBindAssetMention,
}: ManjuCanvasProps) {
  const [flow, setFlow] = useState<ReactFlowInstance<Node<SeedreamNodeData>, Edge> | null>(null);
  const [nodeAddMenu, setNodeAddMenu] = useState<NodeAddMenu | null>(null);
  const [viewportMoving, setViewportMoving] = useState(false);
  const viewportMovingRef = useRef(false);
  const viewportIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlerRef = useRef({ onNodeMove, onNodeSelect, onCanvasContextMenu, onConnectNodes });
  handlerRef.current = { onNodeMove, onNodeSelect, onCanvasContextMenu, onConnectNodes };
  canvasActionHandlers.current = { onNodeUpload, onNodeGenerate, onNodePickFromLibrary, onNodeSelect };
  composerActionHandlers.current = { onUpdateNodeContent, onComposerSettingsChange, onBindAssetMention, onNodeGenerate, onNodeSelect };
  const markViewportMoving = useCallback(() => {
    if (!viewportMovingRef.current) {
      viewportMovingRef.current = true;
      setViewportMoving(true);
    }
    if (viewportIdleTimerRef.current) clearTimeout(viewportIdleTimerRef.current);
    viewportIdleTimerRef.current = setTimeout(() => {
      viewportMovingRef.current = false;
      setViewportMoving(false);
    }, 140);
  }, []);

  const markViewportIdle = useCallback(() => {
    if (viewportIdleTimerRef.current) clearTimeout(viewportIdleTimerRef.current);
    viewportMovingRef.current = false;
    setViewportMoving(false);
  }, []);

  useEffect(() => {
    return () => {
      if (viewportIdleTimerRef.current) clearTimeout(viewportIdleTimerRef.current);
    };
  }, []);

  const nodesSignature = stableNodesSignature(nodes);
  const propConnectionsSignature = stableConnectionsSignature(propConnections);
  const nodeAssetsSignature = stableAssetsSignature(nodeAssets);
  const mentionAssetsSignature = stableAssetsSignature(mentionAssets);
  const stableNodes = useMemo(() => nodes, [nodesSignature]);
  const stablePropConnections = useMemo(() => propConnections, [propConnectionsSignature]);
  const stableNodeAssets = useMemo(() => nodeAssets, [nodeAssetsSignature]);
  const stableMentionAssets = useMemo(() => mentionAssets, [mentionAssetsSignature]);
  const connections = useMemo(
    () => (stablePropConnections.length ? stablePropConnections : generateAutoConnections(stableNodes)),
    [stableNodes, stablePropConnections]
  );
  const connectionsSignature = stableConnectionsSignature(connections);
  const stableConnections = useMemo(() => connections, [connectionsSignature]);
  const externalFlowNodes = useMemo(
    () => toFlowNodes(stableNodes, { nodeAssets: stableNodeAssets, mentionAssets: stableMentionAssets, selectedNodeId, composerSettings, composerOptions, composerGenerating, viewportMoving }),
    [stableNodeAssets, stableMentionAssets, stableNodes, selectedNodeId, composerSettings, composerOptions, composerGenerating, viewportMoving]
  );
  const externalFlowEdges = useMemo(() => toFlowEdges(stableConnections), [stableConnections]);
  const [flowNodes, setFlowNodes] = useState<Node<SeedreamNodeData>[]>(externalFlowNodes);
  const [flowEdges, setFlowEdges] = useState<Edge[]>(externalFlowEdges);

  useEffect(() => {
    setFlowNodes(externalFlowNodes);
  }, [externalFlowNodes]);

  useEffect(() => {
    setFlowEdges(externalFlowEdges);
  }, [externalFlowEdges]);

  const onNodesChange: OnNodesChange<Node<SeedreamNodeData>> = useCallback(
    (changes) => {
      setFlowNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
      let nextSelectedNodeId: string | null | undefined;
      changes.forEach((change) => {
        if (change.type === "position" && change.dragging === false && change.position) {
          handlerRef.current.onNodeMove?.(change.id, Math.round(change.position.x), Math.round(change.position.y));
        }
        if (change.type === "select") {
          if (change.selected) nextSelectedNodeId = change.id;
          else if (nextSelectedNodeId === undefined) nextSelectedNodeId = null;
        }
      });
      if (nextSelectedNodeId !== undefined) handlerRef.current.onNodeSelect?.(nextSelectedNodeId);
    },
    []
  );

  const handlePaneClick = useCallback(() => {
    handlerRef.current.onNodeSelect?.(null);
  }, []);

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
      event.preventDefault();
      if ("nativeEvent" in event) {
        handlerRef.current.onCanvasContextMenu?.(event);
      }
    },
    []
  );

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    handlerRef.current.onConnectNodes?.(connection.source, connection.target);
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (readOnly) return;
    if (!event.dataTransfer.types.includes("application/x-seedream-asset")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, [readOnly]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    if (readOnly || !onDropAsset || !flow) return;
    const raw = event.dataTransfer.getData("application/x-seedream-asset");
    if (!raw) return;
    event.preventDefault();
    try {
      const asset = JSON.parse(raw) as CanvasAssetDropPayload;
      if (!asset?.id) return;
      const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onDropAsset(asset, Math.round(position.x - 180), Math.round(position.y - 160));
      setNodeAddMenu(null);
    } catch {
      // Ignore invalid drag payloads from outside the Studio.
    }
  }, [flow, onDropAsset, readOnly]);

  const openNodeAddMenu = useCallback((nodeId: string, side: "left" | "right", event: React.MouseEvent) => {
    const wrapper = (event.currentTarget as HTMLElement).closest(".seedream-react-flow") as HTMLElement | null;
    const wrapperRect = wrapper?.getBoundingClientRect();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setNodeAddMenu({
      nodeId,
      side,
      x: wrapperRect ? rect.left - wrapperRect.left + rect.width / 2 : event.clientX,
      y: wrapperRect ? rect.top - wrapperRect.top + rect.height / 2 : event.clientY,
    });
  }, []);

  canvasNodeAddMenuHandlers.current.open = openNodeAddMenu;

  const closeNodeAddMenu = useCallback(() => setNodeAddMenu(null), []);

  const handleNodeMenuAction = useCallback((item: NodeAddMenuItem) => {
    if (!nodeAddMenu || item.disabled) return;
    const sourceNode = stableNodes.find((node) => node.id === nodeAddMenu.nodeId);
    if (!sourceNode) return;
    if (item.type === "audio") return;
    if (item.type === "reference") {
      handlerRef.current.onNodeSelect?.(sourceNode.id);
      closeNodeAddMenu();
      return;
    }
    const canvasType: CanvasNode["type"] = item.type === "composite" ? "video" : item.type;
    const offsetX = nodeAddMenu.side === "right" ? (sourceNode.width || 360) + 160 : -520;
    onAddNode?.(canvasType, Math.round(sourceNode.x + offsetX), Math.round(sourceNode.y + 20), sourceNode.id, nodeAddMenu.side);
    closeNodeAddMenu();
  }, [closeNodeAddMenu, nodeAddMenu, onAddNode, stableNodes]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (readOnly) return;
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [data-seedream-composer='true']")) return;
      if (!selectedNodeId || !onDeleteNode) return;
      event.preventDefault();
      onDeleteNode(selectedNodeId);
      setNodeAddMenu(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDeleteNode, readOnly, selectedNodeId]);

  const selectedFlowNodes = useMemo(() => flowNodes.filter((node) => node.selected).map((node) => node.id), [flowNodes]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[26px] border border-white/80 bg-[#f4f7f1]">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onInit={setFlow}
        onNodesChange={readOnly ? undefined : onNodesChange}
        onNodeClick={(_, node) => onNodeSelect?.(node.id)}
        onNodeDoubleClick={(_, node) => onNodeDoubleClick?.(node.data.canvasNode)}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          onNodeContextMenu?.(node.data.canvasNode, event);
        }}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onMoveStart={markViewportMoving}
        onMove={markViewportMoving}
        onMoveEnd={markViewportIdle}
        onConnect={readOnly ? undefined : handleConnect}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        defaultViewport={{ x: 92, y: 86, zoom: 0.86 }}
        minZoom={0.2}
        maxZoom={1.8}
        defaultEdgeOptions={defaultEdgeOptions}
        proOptions={proOptions}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        panOnDrag
        selectionOnDrag
        panOnScroll
        zoomOnScroll
        onlyRenderVisibleElements
        className="seedream-react-flow"
      >
        <Background variant={BackgroundVariant.Lines} gap={96} size={1} color="rgba(15,23,42,0.055)" />
        <Controls
          className="!bottom-4 !left-4 !top-auto overflow-hidden !rounded-2xl !border !border-white/80 !bg-white/88 !shadow-sm"
          showInteractive={false}
        />
        <Panel position="bottom-center" className="mb-3 flex items-center gap-1 rounded-full border border-white/80 bg-white/92 p-1.5 shadow-sm">
          <button type="button" className="flex h-8 items-center gap-1 rounded-full px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950" onClick={() => flow?.fitView({ padding: 0.24, duration: 280 })}>
            <LocateFixed className="h-3.5 w-3.5" />归位
          </button>
          {onAutoLayout && (
            <button
              type="button"
              className="flex h-8 items-center gap-1 rounded-full px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              onClick={() => {
                onAutoLayout();
                window.setTimeout(() => flow?.fitView({ padding: 0.26, duration: 320 }), 80);
              }}
            >
              <WandSparkles className="h-3.5 w-3.5" />自动布局
            </button>
          )}
        </Panel>
        {onBatchGenerate && selectedFlowNodes.length > 0 && (
          <Panel position="top-right" className="mr-3 mt-3 flex items-center gap-2 rounded-2xl border border-surface-border/70 bg-surface-elevated/95 px-3 py-2 shadow-sm">
            <span className="text-xs text-text-secondary">已选 {selectedFlowNodes.length} 个节点</span>
            <button type="button" className="rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-hover" onClick={() => onBatchGenerate(selectedFlowNodes, "image")}>
              批量分镜
            </button>
            <button type="button" className="rounded-lg bg-surface-card px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text-primary" onClick={() => onBatchGenerate(selectedFlowNodes, "video")}>
              批量视频
            </button>
          </Panel>
        )}
        {nodeAddMenu && (
          <Panel position="top-left" className="!m-0">
            <div className="fixed inset-0 z-[80]" onClick={closeNodeAddMenu} />
            <div
              className="absolute z-[90] w-[224px] overflow-hidden rounded-2xl border border-white/10 bg-[#242424] p-2 shadow-[0_18px_60px_rgba(0,0,0,0.38)]"
              style={{
                left: nodeAddMenu.side === "right" ? nodeAddMenu.x + 18 : nodeAddMenu.x - 242,
                top: Math.max(12, nodeAddMenu.y - 22),
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="px-2.5 pb-2 pt-1.5 text-[12px] font-semibold text-white/86">引用该节点生成</div>
              <div className="space-y-0.5">
                {nodeAddMenuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      disabled={item.disabled}
                      onClick={() => handleNodeMenuAction(item)}
                      className={cn(
                        "flex h-10 w-full items-center gap-3 rounded-xl px-2.5 text-left text-[13px] font-medium transition-colors",
                        item.disabled ? "cursor-not-allowed text-white/28" : "text-white/88 hover:bg-white/10"
                      )}
                    >
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", item.disabled ? "bg-white/5 text-white/25" : "bg-white/8 text-white/86")}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge && (
                        <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold", item.badge === "NEW" ? "bg-blue-500 text-white" : "bg-white/12 text-white/75")}>{item.badge}</span>
                      )}
                      {item.submenu && <ChevronRight className="h-3.5 w-3.5 text-white/45" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

export default function ManjuCanvas(props: ManjuCanvasProps) {
  return (
    <ReactFlowProvider>
      <ManjuCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
