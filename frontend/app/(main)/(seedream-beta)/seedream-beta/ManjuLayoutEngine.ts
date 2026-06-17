"use client";

import type { CanvasNode } from "./ManjuCanvas";

export type LayoutType = "timeline" | "scene-group" | "free";

interface LayoutOptions {
  startX?: number;
  startY?: number;
  gapX?: number;
  gapY?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  groupGapY?: number;
}

const DEFAULT_OPTIONS: Required<LayoutOptions> = {
  startX: 48,
  startY: 48,
  gapX: 280,
  gapY: 160,
  nodeWidth: 240,
  nodeHeight: 180,
  groupGapY: 80,
};

/** 时间轴布局：按 index 顺序水平排列 */
export function layoutTimeline(
  nodes: CanvasNode[],
  options: LayoutOptions = {}
): CanvasNode[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sorted = [...nodes].sort((a, b) => {
    const idxA = (a.data?.index as number) ?? 0;
    const idxB = (b.data?.index as number) ?? 0;
    return idxA - idxB;
  });

  return sorted.map((node, i) => ({
    ...node,
    x: opts.startX + i * opts.gapX,
    y: opts.startY,
    width: node.width || opts.nodeWidth,
    height: node.height || opts.nodeHeight,
  }));
}

/** 场景分组布局：按 scene 分组，每组垂直排列，组间水平排列 */
export function layoutSceneGroup(
  nodes: CanvasNode[],
  options: LayoutOptions = {}
): CanvasNode[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 按 scene 分组
  const groups: Record<string, CanvasNode[]> = {};
  const noScene: CanvasNode[] = [];

  for (const node of nodes) {
    const scene = (node.data?.scene as string) || "";
    if (scene) {
      if (!groups[scene]) groups[scene] = [];
      groups[scene].push(node);
    } else {
      noScene.push(node);
    }
  }

  // 每组内按 index 排序
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => {
      const idxA = (a.data?.index as number) ?? 0;
      const idxB = (b.data?.index as number) ?? 0;
      return idxA - idxB;
    });
  }

  const result: CanvasNode[] = [];
  let groupX = opts.startX;

  // 先排列有 scene 的组
  for (const scene of Object.keys(groups)) {
    const group = groups[scene];
    // 场景标题节点
    const titleNode: CanvasNode = {
      id: `scene-title-${scene}`,
      type: "group",
      title: scene,
      x: groupX,
      y: opts.startY - 40,
      width: opts.nodeWidth,
      height: 32,
      data: { isSceneTitle: true, scene },
      status: "empty",
    };
    result.push(titleNode);

    // 组内节点垂直排列
    for (let i = 0; i < group.length; i++) {
      const node = group[i];
      result.push({
        ...node,
        x: groupX,
        y: opts.startY + i * opts.gapY,
        width: node.width || opts.nodeWidth,
        height: node.height || opts.nodeHeight,
      });
    }

    groupX += opts.gapX;
  }

  // 无 scene 的节点放在最后，水平排列
  for (let i = 0; i < noScene.length; i++) {
    const node = noScene[i];
    result.push({
      ...node,
      x: groupX + i * opts.gapX,
      y: opts.startY,
      width: node.width || opts.nodeWidth,
      height: node.height || opts.nodeHeight,
    });
  }

  return result;
}

/** 自动推导布局：有 scene 用分组，无 scene 用时间轴 */
export function autoLayout(
  nodes: CanvasNode[],
  options: LayoutOptions = {}
): { nodes: CanvasNode[]; type: LayoutType } {
  const hasScene = nodes.some((n) => (n.data?.scene as string)?.length > 0);
  if (hasScene) {
    return { nodes: layoutSceneGroup(nodes, options), type: "scene-group" };
  }
  return { nodes: layoutTimeline(nodes, options), type: "timeline" };
}

/** 生成连接线：按 index 顺序连接相邻节点 */
export function generateConnections(nodes: CanvasNode[]): { id: string; from: string; to: string }[] {
  const sorted = [...nodes]
    .filter((n) => n.type !== "group")
    .sort((a, b) => {
      const idxA = (a.data?.index as number) ?? 0;
      const idxB = (b.data?.index as number) ?? 0;
      return idxA - idxB;
    });

  const connections: { id: string; from: string; to: string }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    connections.push({
      id: `conn-${sorted[i].id}-${sorted[i + 1].id}`,
      from: sorted[i].id,
      to: sorted[i + 1].id,
    });
  }
  return connections;
}
