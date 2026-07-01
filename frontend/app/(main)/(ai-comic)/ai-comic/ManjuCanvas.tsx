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
  Sparkles,
  Type,
  Video,
  WandSparkles,
  Plus,
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
  lockPrompt?: string;
  image?: string;
  source?: "node" | "library" | "semantic";
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
  mentionAssets?: Array<{ id: string; name: string; kind?: string; category?: string; summary?: string; lockPrompt?: string; imageUrl?: string; image_url?: string; url?: string }>;
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
  surfaceMode?: "day" | "night" | "eye";
  onUpdateNodeContent?: (nodeId: string, updates: { title?: string; body?: string }) => void;
  onComposerSettingsChange?: (nodeId: string, updates: Partial<ComposerSettings>) => void;
  onBindAssetMention?: (nodeId: string, assetId: string) => void;
  onRewriteAsset?: (nodeId: string, instruction: string) => void;
  onChatAsset?: (nodeId: string, question: string) => void;
  assetRewriting?: boolean;
  assetChatting?: boolean;
}

type SeedreamNodeData = {
  canvasNode: CanvasNode;
  surfaceMode?: "day" | "night" | "eye";
  nodeAssets?: Array<{ id: string; publicId?: string; name: string; category?: string; url?: string; image_url?: string }>;
  mentionAssets?: ManjuCanvasProps["mentionAssets"];
  composerSettings?: ComposerSettings;
  composerOptions?: ManjuCanvasProps["composerOptions"];
  composerGenerating?: boolean;
  assetRewriting?: boolean;
  assetChatting?: boolean;
  viewportMoving?: boolean;
};

type CanvasActionHandlers = Pick<
  ManjuCanvasProps,
  "onNodeUpload" | "onNodeGenerate" | "onNodePickFromLibrary" | "onNodeSelect"
>;
type ComposerActionHandlers = Pick<ManjuCanvasProps, "onUpdateNodeContent" | "onComposerSettingsChange" | "onBindAssetMention" | "onNodeGenerate" | "onNodeSelect" | "onRewriteAsset" | "onChatAsset">;

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
  { type: "text", label: "文本", icon: Type },
  { type: "image", label: "图片", icon: Image },
  { type: "video", label: "视频", icon: Video },
];

function getNodeAddMenuItems(sourceNode?: CanvasNode): NodeAddMenuItem[] {
  if (sourceNode?.type !== "assets") return nodeAddMenuItems;
  return [
    { type: "text", label: "文本", icon: Type },
    { type: "image", label: "图片", icon: Image },
    { type: "video", label: "视频", icon: Video },
  ];
}

const canvasActionHandlers: { current: CanvasActionHandlers } = { current: {} };
const composerActionHandlers: { current: ComposerActionHandlers } = { current: {} };
const canvasNodeAddMenuHandlers: { current: { open?: (nodeId: string, side: "left" | "right", event: React.MouseEvent) => void } } = { current: {} };

const handleBaseClass =
  "!top-1/2 !z-20 !flex !h-8 !w-8 !-translate-y-1/2 !items-center !justify-center !rounded-full !border !border-white/[0.18] !bg-black !text-white/70 !opacity-100 !shadow-[0_10px_28px_rgba(0,0,0,0.38)] transition-all hover:!scale-105 hover:!border-white hover:!bg-white hover:!text-black";

function nodeVisual(type: CanvasNode["type"]) {
  switch (type) {
    case "script":
      return { label: "剧本源", icon: Type, accent: "from-violet-500 to-fuchsia-500", soft: "bg-violet-500/10 text-violet-500" };
    case "assets":
      return { label: "资产", icon: Box, accent: "from-amber-400 to-orange-500", soft: "bg-amber-500/10 text-amber-500" };
    case "shot":
      return { label: "镜头卡", icon: Clapperboard, accent: "from-sky-400 to-cyan-500", soft: "bg-sky-500/10 text-sky-500" };
    case "image":
      return { label: "图片", icon: Image, accent: "from-emerald-400 to-teal-500", soft: "bg-emerald-500/10 text-emerald-500" };
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
  const surfaceMode = data.surfaceMode || "night";
  const visual = nodeVisual(node.type);
  const Icon = visual.icon;
  const cardTheme = surfaceMode === "day"
    ? {
        shell: "border-black/[0.08] bg-white/95 shadow-[0_22px_55px_rgba(25,23,18,0.14)] ring-1 ring-black/[0.04]",
        selected: "border-black/40 shadow-[0_0_0_1px_rgba(0,0,0,0.18),0_26px_68px_rgba(25,23,18,0.20)]",
        idle: "hover:border-black/20",
        topLine: "via-black/20",
        icon: "border-black/[0.08] bg-black/[0.04] text-black/70",
        title: "text-[#171512]",
        badge: "border-black/[0.08] bg-black/[0.04] text-black/[0.48]",
        status: "text-black/[0.40]",
        content: "border-t border-black/[0.06] bg-black/[0.025]",
      }
    : surfaceMode === "eye"
      ? {
          shell: "border-[#b5bfae]/60 bg-[#e2ecd9]/95 shadow-[0_22px_55px_rgba(53,54,46,0.13)] ring-1 ring-[#b5bfae]/35",
          selected: "border-[#4f7f45]/60 shadow-[0_0_0_1px_rgba(79,127,69,0.24),0_26px_68px_rgba(53,54,46,0.18)]",
          idle: "hover:border-[#4f7f45]/35",
          topLine: "via-[#4f7f45]/25",
          icon: "border-[#b5bfae]/60 bg-[#4f7f45]/[0.06] text-[#35362e]/70",
          title: "text-[#35362e]",
          badge: "border-[#b5bfae]/60 bg-[#4f7f45]/[0.06] text-[#35362e]/52",
          status: "text-[#35362e]/42",
          content: "border-t border-[#b5bfae]/55 bg-[#4f7f45]/[0.025]",
        }
      : {
          shell: "border-white/[0.08] bg-[#101011]/95 shadow-[0_22px_55px_rgba(0,0,0,0.42)] ring-1 ring-white/[0.06]",
          selected: "border-white/70 shadow-[0_0_0_1px_rgba(255,255,255,0.55),0_26px_68px_rgba(0,0,0,0.52)]",
          idle: "hover:border-white/20",
          topLine: "via-white/25",
          icon: "border-white/[0.08] bg-white/[0.06] text-white/[0.72]",
          title: "text-white",
          badge: "border-white/[0.08] bg-white/[0.06] text-white/[0.45]",
          status: "text-white/[0.34]",
          content: "border-t border-white/[0.06] bg-white/[0.035]",
        };

  return (
    <div
      onClick={() => {
        canvasActionHandlers.current.onNodeSelect?.(node.id);
      }}
      className={cn(
        "group relative flex flex-col overflow-visible rounded-[24px] will-change-transform [contain:layout_style]",
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
          "flex flex-1 flex-col overflow-hidden rounded-[24px] border backdrop-blur-xl",
          cardTheme.shell,
          selected ? cardTheme.selected : cardTheme.idle
        )}
      >
        <div className={cn("h-px bg-gradient-to-r from-transparent to-transparent", cardTheme.topLine)} />
        <div className="flex items-center gap-3 px-4 py-3">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border", cardTheme.icon)}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={cn("truncate text-[15px] font-semibold tracking-[-0.01em]", cardTheme.title)}>{node.title}</span>
              <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", cardTheme.badge)}>
                {visual.label}
              </span>
            </div>
            <div className={cn("mt-0.5 text-[11px] font-medium", cardTheme.status)}>{statusLabel(node.status)}</div>
          </div>
        </div>
        {!node.collapsed && (
          <div className={cn("flex flex-1 p-3", cardTheme.content)}>
            <ManjuNodeContent
              node={node}
              surfaceMode={surfaceMode}
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
          onRewriteAsset={composerActionHandlers.current.onRewriteAsset}
          onChatAsset={composerActionHandlers.current.onChatAsset}
          assetRewriting={data.assetRewriting}
          assetChatting={data.assetChatting}
          onClose={() => composerActionHandlers.current.onNodeSelect?.(null)}
        />
      )}
    </div>
  );
});

const nodeTypes = { seedream: SeedreamFlowNode };
const defaultEdgeOptions = { type: "default" };
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
  return connection === "scene-transition" ? "smoothstep" : "default";
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
  props: Pick<ManjuCanvasProps, "nodeAssets" | "mentionAssets" | "selectedNodeId" | "composerSettings" | "composerOptions" | "composerGenerating" | "assetRewriting" | "assetChatting" | "surfaceMode"> & { viewportMoving?: boolean }
): Node<SeedreamNodeData>[] {
  return nodes.map((node) => ({
    id: node.id,
    type: "seedream",
    position: { x: node.x, y: node.y },
    selected: props.selectedNodeId === node.id || node.selected,
    draggable: node.type !== "group",
    data: {
      canvasNode: node,
      surfaceMode: props.surfaceMode,
      nodeAssets: props.nodeAssets,
      mentionAssets: props.mentionAssets,
      composerSettings: props.composerSettings,
      composerOptions: props.composerOptions,
      composerGenerating: props.composerGenerating,
      assetRewriting: props.assetRewriting,
      assetChatting: props.assetChatting,
      viewportMoving: props.viewportMoving,
    },
  }));
}

function toFlowEdges(connections: CanvasConnection[], surfaceMode: ManjuCanvasProps["surfaceMode"] = "night"): Edge[] {
  const labelStyle = surfaceMode === "day"
    ? { fill: "#171512", fontSize: 11, fontWeight: 600 }
    : surfaceMode === "eye"
      ? { fill: "#35362e", fontSize: 11, fontWeight: 600 }
      : { fill: "#e5e7eb", fontSize: 11, fontWeight: 600 };
  const labelBgStyle = surfaceMode === "day"
    ? { fill: "rgba(255,255,255,0.92)", fillOpacity: 0.92 }
    : surfaceMode === "eye"
      ? { fill: "rgba(226,236,217,0.94)", fillOpacity: 0.94 }
      : { fill: "rgba(15,15,16,0.88)", fillOpacity: 0.88 };
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
    labelStyle,
    labelBgStyle,
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
  surfaceMode = "night",
  onUpdateNodeContent,
  onComposerSettingsChange,
  onBindAssetMention,
  onRewriteAsset,
  onChatAsset,
  assetRewriting,
  assetChatting,
}: ManjuCanvasProps) {
  const [flow, setFlow] = useState<ReactFlowInstance<Node<SeedreamNodeData>, Edge> | null>(null);
  const [nodeAddMenu, setNodeAddMenu] = useState<NodeAddMenu | null>(null);
  const [viewportMoving, setViewportMoving] = useState(false);
  const viewportMovingRef = useRef(false);
  const viewportIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlerRef = useRef({ onNodeMove, onNodeSelect, onCanvasContextMenu, onConnectNodes });
  handlerRef.current = { onNodeMove, onNodeSelect, onCanvasContextMenu, onConnectNodes };
  canvasActionHandlers.current = { onNodeUpload, onNodeGenerate, onNodePickFromLibrary, onNodeSelect };
  composerActionHandlers.current = { onUpdateNodeContent, onComposerSettingsChange, onBindAssetMention, onNodeGenerate, onNodeSelect, onRewriteAsset, onChatAsset };
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
    () => toFlowNodes(stableNodes, { nodeAssets: stableNodeAssets, mentionAssets: stableMentionAssets, selectedNodeId, composerSettings, composerOptions, composerGenerating, assetRewriting, assetChatting, surfaceMode, viewportMoving }),
    [stableNodeAssets, stableMentionAssets, stableNodes, selectedNodeId, composerSettings, composerOptions, composerGenerating, assetRewriting, assetChatting, surfaceMode, viewportMoving]
  );
  const externalFlowEdges = useMemo(() => toFlowEdges(stableConnections, surfaceMode), [stableConnections, surfaceMode]);
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
  const surface = surfaceMode === "day"
    ? {
        canvas: "border-black/[0.08] bg-[#f4f2ec] shadow-inner",
        grid: "rgba(20,20,18,0.07)",
        toolbar: "border-black/[0.08] bg-white/[0.82] text-black shadow-[0_12px_36px_rgba(25,23,18,0.12)]",
        toolbarText: "text-black/[0.58] hover:bg-black hover:text-white",
        selectedPanel: "border-black/[0.08] bg-white/[0.86] shadow-[0_12px_36px_rgba(25,23,18,0.12)]",
        selectedText: "text-black/[0.58]",
        primaryButton: "bg-black text-white hover:bg-black/[0.86]",
        secondaryButton: "border-black/[0.1] bg-black/[0.04] text-black/[0.58] hover:bg-black/[0.08] hover:text-black",
        nodeAddMenu: "border-black/[0.08] bg-white/[0.94] text-black shadow-[0_18px_60px_rgba(25,23,18,0.16)]",
        nodeAddMenuTitle: "text-black/[0.66]",
        nodeAddMenuItem: "text-black/[0.78] hover:bg-black/[0.06]",
        nodeAddMenuItemDisabled: "cursor-not-allowed text-black/[0.26]",
        nodeAddMenuIcon: "bg-black/[0.05] text-black/[0.72]",
        nodeAddMenuIconDisabled: "bg-black/[0.04] text-black/[0.24]",
        nodeAddMenuBadge: "bg-black/[0.08] text-black/[0.62]",
        nodeAddMenuChevron: "text-black/[0.38]",
      }
    : surfaceMode === "eye"
      ? {
          canvas: "border-[#b5bfae]/[0.24] bg-[#d4e0c8] shadow-inner",
          grid: "rgba(53,54,46,0.08)",
          toolbar: "border-[#b5bfae]/[0.12] bg-[#e2ecd9]/[0.78] text-[#4f7f45] shadow-[0_12px_36px_rgba(0,0,0,0.28)]",
          toolbarText: "text-[#35362e]/[0.62] hover:bg-[#4f7f45] hover:text-white",
          selectedPanel: "border-[#b5bfae]/[0.12] bg-[#e2ecd9]/[0.78] shadow-[0_12px_36px_rgba(0,0,0,0.28)]",
          selectedText: "text-[#35362e]/[0.62]",
          primaryButton: "bg-[#4f7f45] text-white hover:bg-[#3f6937]",
          secondaryButton: "border-[#4f7f45]/[0.12] bg-[#4f7f45]/[0.06] text-[#35362e]/[0.62] hover:bg-[#4f7f45]/[0.1] hover:text-[#35362e]",
          nodeAddMenu: "border-[#b5bfae]/[0.18] bg-[#e2ecd9]/[0.94] text-[#35362e] shadow-[0_18px_60px_rgba(53,54,46,0.18)]",
          nodeAddMenuTitle: "text-[#35362e]/[0.66]",
          nodeAddMenuItem: "text-[#35362e]/[0.78] hover:bg-[#4f7f45]/[0.08]",
          nodeAddMenuItemDisabled: "cursor-not-allowed text-[#35362e]/[0.28]",
          nodeAddMenuIcon: "bg-[#4f7f45]/[0.08] text-[#4f7f45]",
          nodeAddMenuIconDisabled: "bg-[#4f7f45]/[0.05] text-[#35362e]/[0.24]",
          nodeAddMenuBadge: "bg-[#4f7f45]/[0.1] text-[#35362e]/[0.66]",
          nodeAddMenuChevron: "text-[#35362e]/[0.42]",
        }
      : {
          canvas: "border-white/[0.08] bg-[#070707] shadow-inner",
          grid: "rgba(255,255,255,0.055)",
          toolbar: "border-white/[0.1] bg-black/[0.72] text-white shadow-[0_12px_36px_rgba(0,0,0,0.36)]",
          toolbarText: "text-white/[0.58] hover:bg-white hover:text-black",
          selectedPanel: "border-white/[0.1] bg-black/[0.72] shadow-[0_12px_36px_rgba(0,0,0,0.36)]",
          selectedText: "text-white/[0.58]",
          primaryButton: "bg-white text-black hover:bg-white/[0.88]",
          secondaryButton: "border-white/[0.1] bg-white/[0.05] text-white/[0.58] hover:bg-white/[0.09] hover:text-white",
          nodeAddMenu: "border-white/10 bg-[#242424] text-white shadow-[0_18px_60px_rgba(0,0,0,0.38)]",
          nodeAddMenuTitle: "text-white/[0.86]",
          nodeAddMenuItem: "text-white/[0.88] hover:bg-white/10",
          nodeAddMenuItemDisabled: "cursor-not-allowed text-white/[0.28]",
          nodeAddMenuIcon: "bg-white/8 text-white/[0.86]",
          nodeAddMenuIconDisabled: "bg-white/5 text-white/25",
          nodeAddMenuBadge: "bg-white/12 text-white/75",
          nodeAddMenuChevron: "text-white/[0.45]",
        };

  return (
    <div className={cn("relative h-full w-full overflow-hidden rounded-[26px] border", surface.canvas)}>
      <style jsx global>{`
        .seedream-react-flow .react-flow__controls {
          display: flex;
          flex-direction: column;
          gap: 1px;
          background: ${surfaceMode === "day" ? "rgba(255, 255, 255, 0.94)" : surfaceMode === "eye" ? "rgba(226, 236, 217, 0.94)" : "rgba(18, 18, 20, 0.92)"} !important;
          border-color: ${surfaceMode === "day" ? "rgba(20, 20, 18, 0.10)" : surfaceMode === "eye" ? "rgba(53, 54, 46, 0.14)" : "rgba(255, 255, 255, 0.12)"} !important;
          box-shadow: ${surfaceMode === "day" ? "0 18px 42px rgba(25, 23, 18, 0.14)" : "0 18px 42px rgba(0, 0, 0, 0.42)"} !important;
        }
        .seedream-react-flow .react-flow__controls-button {
          width: 34px !important;
          height: 34px !important;
          background: ${surfaceMode === "day" ? "#ffffff" : surfaceMode === "eye" ? "#e2ecd9" : "#121214"} !important;
          border: 0 !important;
          border-bottom: 1px solid ${surfaceMode === "day" ? "rgba(0, 0, 0, 0.10)" : surfaceMode === "eye" ? "rgba(53, 54, 46, 0.12)" : "rgba(255, 255, 255, 0.10)"} !important;
          color: ${surfaceMode === "day" ? "#111111" : surfaceMode === "eye" ? "#35362e" : "#ffffff"} !important;
          fill: currentColor !important;
          transition: background 160ms ease, color 160ms ease, transform 160ms ease;
        }
        .seedream-react-flow .react-flow__controls-button:last-child {
          border-bottom: 0 !important;
        }
        .seedream-react-flow .react-flow__controls-button svg {
          width: 17px !important;
          height: 17px !important;
          max-width: 17px !important;
          max-height: 17px !important;
          fill: currentColor !important;
          stroke: currentColor !important;
        }
        .seedream-react-flow .react-flow__controls-button:hover {
          background: ${surfaceMode === "day" ? "#0a0a0a" : surfaceMode === "eye" ? "#4f7f45" : "#ffffff"} !important;
          color: ${surfaceMode === "day" ? "#ffffff" : surfaceMode === "eye" ? "#ffffff" : "#050505"} !important;
          fill: currentColor !important;
        }
      `}</style>
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
        <Background variant={BackgroundVariant.Lines} gap={96} size={1} color={surface.grid} />
        <Controls
          className={cn("!bottom-4 !left-4 !top-auto overflow-hidden !rounded-2xl !border !backdrop-blur-xl", surface.toolbar)}
          showInteractive={false}
        />
        <Panel position="bottom-center" className={cn("mb-3 flex items-center gap-1 rounded-full border p-1.5 backdrop-blur-xl", surface.toolbar)}>
          <button type="button" className={cn("flex h-8 items-center gap-1 rounded-full px-3 text-[11px] font-semibold", surface.toolbarText)} onClick={() => flow?.fitView({ padding: 0.24, duration: 280 })}>
            <LocateFixed className="h-3.5 w-3.5" />归位
          </button>
          {onAutoLayout && (
            <button
              type="button"
              className={cn("flex h-8 items-center gap-1 rounded-full px-3 text-[11px] font-semibold", surface.toolbarText)}
              onClick={onAutoLayout}
            >
              <WandSparkles className="h-3.5 w-3.5" />自动布局
            </button>
          )}
        </Panel>
        {onBatchGenerate && selectedFlowNodes.length > 0 && (
          <Panel position="top-right" className={cn("mr-3 mt-3 flex items-center gap-2 rounded-2xl border px-3 py-2 backdrop-blur-xl", surface.selectedPanel)}>
            <span className={cn("text-xs", surface.selectedText)}>已选 {selectedFlowNodes.length} 个节点</span>
            <button type="button" className={cn("rounded-lg px-2.5 py-1 text-xs font-medium", surface.primaryButton)} onClick={() => onBatchGenerate(selectedFlowNodes, "image")}>
              批量分镜
            </button>
            <button type="button" className={cn("rounded-lg border px-2.5 py-1 text-xs font-medium", surface.secondaryButton)} onClick={() => onBatchGenerate(selectedFlowNodes, "video")}>
              批量视频
            </button>
          </Panel>
        )}
        {nodeAddMenu && (
          <Panel position="top-left" className="!m-0">
            <div className="fixed inset-0 z-[80]" onClick={closeNodeAddMenu} />
            <div
              className={cn("absolute z-[90] w-[224px] overflow-hidden rounded-2xl border p-2", surface.nodeAddMenu)}
              style={{
                left: nodeAddMenu.side === "right" ? nodeAddMenu.x + 18 : nodeAddMenu.x - 242,
                top: Math.max(12, nodeAddMenu.y - 22),
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={cn("px-2.5 pb-2 pt-1.5 text-[12px] font-semibold", surface.nodeAddMenuTitle)}>引用该节点生成</div>
              <div className="space-y-0.5">
                {getNodeAddMenuItems(stableNodes.find((node) => node.id === nodeAddMenu.nodeId)).map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      disabled={item.disabled}
                      onClick={() => handleNodeMenuAction(item)}
                      className={cn(
                        "flex h-10 w-full items-center gap-3 rounded-xl px-2.5 text-left text-[13px] font-medium transition-colors",
                        item.disabled ? surface.nodeAddMenuItemDisabled : surface.nodeAddMenuItem
                      )}
                    >
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", item.disabled ? surface.nodeAddMenuIconDisabled : surface.nodeAddMenuIcon)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge && (
                        <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold", item.badge === "NEW" ? "bg-blue-500 text-white" : surface.nodeAddMenuBadge)}>{item.badge}</span>
                      )}
                      {item.submenu && <ChevronRight className={cn("h-3.5 w-3.5", surface.nodeAddMenuChevron)} />}
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
