"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  GripVertical,
  Maximize2,
  Minimize2,
  X,
  Plus,
} from "lucide-react";

export interface CanvasNode {
  id: string;
  type: "script" | "assets" | "shot" | "image" | "video" | "director" | "text" | "group";
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data?: Record<string, unknown>;
  selected?: boolean;
  collapsed?: boolean;
  status?: "empty" | "draft" | "done" | "error";
}

export interface CanvasConnection {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface ManjuCanvasProps {
  nodes: CanvasNode[];
  connections?: CanvasConnection[];
  onNodeMove?: (id: string, x: number, y: number) => void;
  onNodeSelect?: (id: string | null) => void;
  onNodeDoubleClick?: (node: CanvasNode) => void;
  onNodeContextMenu?: (node: CanvasNode, e: React.MouseEvent) => void;
  onCanvasContextMenu?: (e: React.MouseEvent) => void;
  onAddNode?: (type: CanvasNode["type"], x: number, y: number) => void;
  onDeleteNode?: (id: string) => void;
  onToggleCollapse?: (id: string) => void;
  selectedNodeId?: string | null;
  readOnly?: boolean;
  children?: React.ReactNode;
}

const GRID_SIZE = 24;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.0;

export default function ManjuCanvas({
  nodes,
  connections = [],
  onNodeMove,
  onNodeSelect,
  onNodeDoubleClick,
  onNodeContextMenu,
  onCanvasContextMenu,
  onAddNode,
  onDeleteNode,
  onToggleCollapse,
  selectedNodeId,
  readOnly,
  children,
}: ManjuCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // 滚轮缩放
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));
      } else if (e.shiftKey) {
        e.preventDefault();
        setPan((p) => ({ ...p, x: p.x - e.deltaY }));
      } else {
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    },
    []
  );

  // 中键/空格+拖拽 平移
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        e.preventDefault();
        setPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        return;
      }
      if (e.button === 0 && e.target === containerRef.current) {
        onNodeSelect?.(null);
      }
    },
    [pan, onNodeSelect]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (panning) {
        setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
        return;
      }
      if (draggingNode) {
        const scale = 1 / zoom;
        const newX = (e.clientX - pan.x - dragStart.x) * scale;
        const newY = (e.clientY - pan.y - dragStart.y) * scale;
        onNodeMove?.(
          draggingNode,
          Math.round(newX / GRID_SIZE) * GRID_SIZE,
          Math.round(newY / GRID_SIZE) * GRID_SIZE
        );
      }
    },
    [panning, panStart, pan, draggingNode, dragStart, zoom, onNodeMove]
  );

  const onMouseUp = useCallback(() => {
    setPanning(false);
    setDraggingNode(null);
  }, []);

  const onNodeMouseDown = useCallback(
    (e: React.MouseEvent, node: CanvasNode) => {
      if (readOnly) return;
      e.stopPropagation();
      onNodeSelect?.(node.id);
      setDraggingNode(node.id);
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setDragStart({
          x: e.clientX - rect.left - pan.x - node.x * zoom,
          y: e.clientY - rect.top - pan.y - node.y * zoom,
        });
      }
    },
    [readOnly, onNodeSelect, pan, zoom]
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === containerRef.current) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect && onAddNode) {
          const x = (e.clientX - rect.left - pan.x) / zoom;
          const y = (e.clientY - rect.top - pan.y) / zoom;
          onAddNode(
            "text",
            Math.round(x / GRID_SIZE) * GRID_SIZE,
            Math.round(y / GRID_SIZE) * GRID_SIZE
          );
        }
      }
    },
    [pan, zoom, onAddNode]
  );

  // 背景网格
  const gridPattern = `url("data:image/svg+xml,%3Csvg width='${GRID_SIZE}' height='${GRID_SIZE}' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='1' cy='1' r='1' fill='%239CA3AF' fill-opacity='0.15'/%3E%3C/svg%3E")`;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-surface-base"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onCanvasContextMenu}
    >
      {/* 背景网格 */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: gridPattern,
          backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
          transform: `scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      />

      {/* 画布内容层 */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {/* 连接线 SVG */}
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{ width: "100%", height: "100%" }}
        >
          {connections.map((conn) => {
            const from = nodes.find((n) => n.id === conn.from);
            const to = nodes.find((n) => n.id === conn.to);
            if (!from || !to) return null;
            const x1 = from.x + from.width / 2;
            const y1 = from.y + from.height;
            const x2 = to.x + to.width / 2;
            const y2 = to.y;
            const cp1x = x1;
            const cp1y = y1 + 60;
            const cp2x = x2;
            const cp2y = y2 - 60;
            return (
              <path
                key={conn.id}
                d={`M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="text-surface-border"
              />
            );
          })}
        </svg>

        {/* 节点卡片 */}
        {nodes.map((node) => (
          <div
            key={node.id}
            className={cn(
              "absolute rounded-2xl border bg-surface-elevated shadow-sm transition-shadow",
              selectedNodeId === node.id
                ? "border-brand/60 shadow-md ring-1 ring-brand/20"
                : "border-surface-border hover:border-brand/30"
            )}
            style={{
              left: node.x,
              top: node.y,
              width: node.width,
              height: node.collapsed ? 44 : node.height,
            }}
            onMouseDown={(e) => onNodeMouseDown(e, node)}
            onDoubleClick={() => onNodeDoubleClick?.(node)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onNodeContextMenu?.(node, e);
            }}
          >
            {/* 节点头部 */}
            <div className="flex items-center gap-2 px-3 py-2">
              <GripVertical className="h-3.5 w-3.5 text-text-tertiary" />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary">
                {node.title}
              </span>
              <div className="flex items-center gap-1">
                {node.status === "empty" && (
                  <span className="h-2 w-2 rounded-full bg-text-tertiary/30" />
                )}
                {node.status === "draft" && (
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                )}
                {node.status === "done" && (
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                )}
                {node.status === "error" && (
                  <span className="h-2 w-2 rounded-full bg-red-400" />
                )}
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-text-tertiary hover:bg-surface-card"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse?.(node.id);
                  }}
                >
                  {node.collapsed ? (
                    <Maximize2 className="h-3 w-3" />
                  ) : (
                    <Minimize2 className="h-3 w-3" />
                  )}
                </button>
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-text-tertiary hover:bg-red-50 hover:text-red-500"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteNode?.(node.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* 节点内容 */}
            {!node.collapsed && <div className="px-3 pb-3">{children}</div>}
          </div>
        ))}
      </div>

      {/* 底部控制栏 */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-surface-border bg-surface-elevated px-3 py-1.5 shadow-sm">
        <button
          type="button"
          className="text-xs text-text-secondary hover:text-text-primary"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.25))}
        >
          −
        </button>
        <span className="min-w-[3ch] text-center text-xs tabular-nums text-text-secondary">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="text-xs text-text-secondary hover:text-text-primary"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.25))}
        >
          +
        </button>
        <span className="mx-1 h-3 w-px bg-surface-border" />
        <button
          type="button"
          className="text-xs text-text-secondary hover:text-text-primary"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          适应
        </button>
      </div>

      {/* 右下角添加节点按钮 */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white shadow-md hover:bg-brand-hover"
          onClick={(e) => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect && onAddNode) {
              const cx = (rect.width / 2 - pan.x) / zoom;
              const cy = (rect.height / 2 - pan.y) / zoom;
              onAddNode("text", cx, cy);
            }
          }}
          title="添加节点"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
