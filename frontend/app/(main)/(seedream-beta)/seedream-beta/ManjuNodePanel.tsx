"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  Box,
  Clapperboard,
  Image,
  Video,
  Layers,
  Wand2,
  Sparkles,
  Trash2,
  Copy,
  GripVertical,
  Settings,
  ChevronRight,
  ChevronLeft,
  X,
  Plus,
  GripHorizontal,
} from "lucide-react";
import type { CanvasNode } from "./ManjuCanvas";

export interface ManjuNodePanelProps {
  node: CanvasNode | null;
  onUpdateNode?: (id: string, updates: Partial<CanvasNode>) => void;
  onDeleteNode?: (id: string) => void;
  onDuplicateNode?: (id: string) => void;
  onGenerateImage?: (nodeId: string) => void;
  onGenerateVideo?: (nodeId: string) => void;
  onClose?: () => void;
}

export default function ManjuNodePanel({
  node,
  onUpdateNode,
  onDeleteNode,
  onDuplicateNode,
  onGenerateImage,
  onGenerateVideo,
  onClose,
}: ManjuNodePanelProps) {
  const [activeTab, setActiveTab] = useState<"info" | "prompt" | "assets" | "settings">("info");

  if (!node) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-text-tertiary">
        <Layers className="h-10 w-10 opacity-20" />
        <p className="text-xs">选择节点查看详情</p>
      </div>
    );
  }

  const shot = node.data as Record<string, unknown> | undefined;
  const canGenerateImage = node.type === "shot" || node.type === "script";
  const canGenerateVideo = node.type === "image" || node.type === "shot";

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-surface-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-primary">{node.title}</span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0 text-[10px]",
              node.status === "done" && "bg-emerald-50 text-emerald-600",
              node.status === "draft" && "bg-amber-50 text-amber-600",
              node.status === "empty" && "bg-surface-card text-text-tertiary",
              node.status === "error" && "bg-red-50 text-red-600"
            )}
          >
            {node.status === "done" ? "已完成" : node.status === "draft" ? "草稿" : node.status === "error" ? "错误" : "未开始"}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-text-tertiary hover:bg-surface-card hover:text-text-secondary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tab 导航 */}
      <div className="flex border-b border-surface-border">
        {(["info", "prompt", "assets", "settings"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex-1 py-2 text-[11px] font-medium transition-colors",
              activeTab === tab
                ? "border-b-2 border-brand text-brand"
                : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {tab === "info" && "信息"}
            {tab === "prompt" && "提示词"}
            {tab === "assets" && "资产"}
            {tab === "settings" && "设置"}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === "info" && (
          <div className="space-y-3">
            {/* 基本信息 */}
            <div className="space-y-2">
              <label className="text-[10px] font-medium text-text-tertiary">标题</label>
              <input
                type="text"
                value={node.title}
                onChange={(e) => onUpdateNode?.(node.id, { title: e.target.value })}
                className="h-9 w-full rounded-lg border border-surface-border bg-surface-base px-3 text-xs text-text-primary outline-none focus:border-brand"
              />
            </div>

            {/* 场景 */}
            {shot && Boolean(shot.scene) && (
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-text-tertiary">场景</label>
                <div className="text-xs text-text-secondary">{String(shot.scene)}</div>
              </div>
            )}

            {/* 角色 */}
            {shot && Array.isArray(shot.characters) && shot.characters.length > 0 && (
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-text-tertiary">角色</label>
                <div className="flex flex-wrap gap-1">
                  {(shot.characters as string[]).map((c) => (
                    <span key={c} className="rounded-full bg-surface-card px-2 py-0.5 text-[10px] text-text-secondary">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 时长 */}
            {shot && Boolean(shot.duration) && (
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-text-tertiary">建议时长</label>
                <div className="text-xs text-text-secondary">{String(shot.duration)} 秒</div>
              </div>
            )}

            {/* 画幅 */}
            {shot && Boolean(shot.aspectRatio) && (
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-text-tertiary">画幅</label>
                <div className="text-xs text-text-secondary">{String(shot.aspectRatio)}</div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-2 pt-2">
              {canGenerateImage && (
                <button
                  type="button"
                  onClick={() => onGenerateImage?.(node.id)}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand/10 py-2 text-[11px] font-medium text-brand hover:bg-brand/20"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  生成分镜图
                </button>
              )}
              {canGenerateVideo && (
                <button
                  type="button"
                  onClick={() => onGenerateVideo?.(node.id)}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-rose-50 py-2 text-[11px] font-medium text-rose-600 hover:bg-rose-100"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  生成视频
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onDuplicateNode?.(node.id)}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-surface-border py-2 text-[11px] text-text-secondary hover:bg-surface-card"
              >
                <Copy className="h-3.5 w-3.5" />
                复制
              </button>
              <button
                type="button"
                onClick={() => onDeleteNode?.(node.id)}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-red-100 py-2 text-[11px] text-red-500 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </button>
            </div>
          </div>
        )}

        {activeTab === "prompt" && (
          <div className="space-y-3">
            {shot && Boolean(shot.imagePrompt) && (
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-text-tertiary">分镜图提示词</label>
                <textarea
                  value={String(shot.imagePrompt)}
                  readOnly
                  className="h-32 w-full rounded-lg border border-surface-border bg-surface-base p-3 text-[11px] leading-relaxed text-text-secondary outline-none"
                />
              </div>
            )}
            {shot && Boolean(shot.videoPrompt) && (
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-text-tertiary">视频提示词</label>
                <textarea
                  value={String(shot.videoPrompt)}
                  readOnly
                  className="h-32 w-full rounded-lg border border-surface-border bg-surface-base p-3 text-[11px] leading-relaxed text-text-secondary outline-none"
                />
              </div>
            )}
            {!shot?.imagePrompt && !shot?.videoPrompt && (
              <div className="py-8 text-center text-[11px] text-text-tertiary">暂无提示词</div>
            )}
          </div>
        )}

        {activeTab === "assets" && (
          <div className="space-y-2">
            {shot?.imageAssetIds && Array.isArray(shot.imageAssetIds) && shot.imageAssetIds.length > 0 ? (
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-text-tertiary">分镜图资产</label>
                <div className="grid grid-cols-2 gap-1">
                  {(shot.imageAssetIds as string[]).map((id) => (
                    <div key={id} className="aspect-video rounded-lg bg-surface-card" />
                  ))}
                </div>
              </div>
            ) : null}
            {shot?.videoAssetIds && Array.isArray(shot.videoAssetIds) && shot.videoAssetIds.length > 0 ? (
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-text-tertiary">视频资产</label>
                <div className="grid grid-cols-2 gap-1">
                  {(shot.videoAssetIds as string[]).map((id) => (
                    <div key={id} className="aspect-video rounded-lg bg-surface-card" />
                  ))}
                </div>
              </div>
            ) : null}
            {((!shot?.imageAssetIds || !Array.isArray(shot.imageAssetIds) || shot.imageAssetIds.length === 0) &&
              (!shot?.videoAssetIds || !Array.isArray(shot.videoAssetIds) || shot.videoAssetIds.length === 0)) && (
                <div className="py-8 text-center text-[11px] text-text-tertiary">暂无资产</div>
              )}
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-text-tertiary">节点 ID</label>
              <div className="text-[11px] text-text-secondary font-mono">{String(node.id)}</div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-text-tertiary">类型</label>
              <div className="text-[11px] text-text-secondary">{String(node.type)}</div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-text-tertiary">坐标</label>
              <div className="text-[11px] text-text-secondary">
                X: {String(node.x)}, Y: {String(node.y)}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-text-tertiary">尺寸</label>
              <div className="text-[11px] text-text-secondary">
                {String(node.width)} × {String(node.height)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
