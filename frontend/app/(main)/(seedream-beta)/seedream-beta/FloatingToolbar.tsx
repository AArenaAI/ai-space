"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Plus,
  FolderOpen,
  Images,
  HelpCircle,
  X,
  BookOpen,
  Clapperboard,
  Image,
  Video,
  Layers,
  FileText,
} from "lucide-react";
import type { CanvasNode } from "./ManjuCanvas";

interface FloatingToolbarProps {
  onAddNode: (type: CanvasNode["type"], x: number, y: number, sourceNodeId?: string, sourceSide?: "left" | "right") => void;
  onOpenProjectPanel?: () => void;
  onOpenAssetLibrary?: () => void;
  onHelp?: () => void;
}

const NODE_TYPES: { type: CanvasNode["type"]; label: string; icon: React.ReactNode; description?: string }[] = [
  { type: "script", label: "剧本源", icon: <BookOpen className="h-4 w-4" />, description: "可拆镜头的结构化剧本" },
  { type: "shot", label: "镜头卡", icon: <Clapperboard className="h-4 w-4" />, description: "单镜头生产单元" },
  { type: "image", label: "分镜图片", icon: <Image className="h-4 w-4" />, description: "Seedream 生成的静态分镜图" },
  { type: "video", label: "视频片段", icon: <Video className="h-4 w-4" />, description: "Seedance 生成的单镜头视频" },
  { type: "director", label: "导演台", icon: <Layers className="h-4 w-4" />, description: "镜头预演、构图与走位" },
  { type: "text", label: "文本素材", icon: <FileText className="h-4 w-4" />, description: "旁白、备注、设定或 Prompt 草稿" },
];

export default function FloatingToolbar({ onAddNode, onOpenAssetLibrary, onHelp }: FloatingToolbarProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="absolute left-3 top-1/2 z-20 -translate-y-1/2">
      {/* 主工具栏 */}
      <div className="flex flex-col gap-1.5 rounded-2xl border border-white/80 bg-white/78 p-1.5 shadow-[0_12px_30px_rgba(15,23,42,0.10)] backdrop-blur-xl">
        {/* 添加按钮 - 点击展开节点类型 */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-xl transition-colors",
            expanded
              ? "bg-brand text-white"
              : "bg-surface-card text-text-secondary hover:bg-brand/10 hover:text-brand"
          )}
          title="添加节点"
        >
          {expanded ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </button>

        {/* 画布元素按钮：项目入口已经在右上角，避免重复 */}
        <button
          type="button"
          onClick={onOpenAssetLibrary}
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/65 text-slate-500 transition-colors hover:bg-brand/10 hover:text-brand"
          title="画布元素"
        >
          <FolderOpen className="h-4 w-4" />
        </button>

        {/* 资产库按钮 */}
        <button
          type="button"
          onClick={onOpenAssetLibrary}
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/65 text-slate-500 transition-colors hover:bg-brand/10 hover:text-brand"
          title="资产库"
        >
          <Images className="h-4 w-4" />
        </button>

        {/* 帮助按钮 */}
        <button
          type="button"
          onClick={onHelp}
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/65 text-slate-500 transition-colors hover:bg-brand/10 hover:text-brand"
          title="帮助"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </div>

      {/* 展开的节点类型面板 */}
      {expanded && (
        <div className="absolute left-12 top-0 w-56 rounded-2xl border border-white/80 bg-white/95 p-3 shadow-[0_18px_46px_rgba(15,23,42,0.16)] backdrop-blur-xl">
          <div className="mb-2 text-xs font-semibold text-text-tertiary">添加节点</div>
          <div className="grid grid-cols-2 gap-1.5">
            {NODE_TYPES.map((nt) => (
              <button
                key={nt.type}
                type="button"
                onClick={() => {
                  onAddNode(nt.type, 200, 200);
                  setExpanded(false);
                }}
                className="flex flex-col items-center gap-1 rounded-xl border border-surface-border bg-surface-base px-3 py-2.5 text-xs text-text-secondary transition-colors hover:border-brand/40 hover:bg-surface-card hover:text-text-primary"
                title={nt.description || nt.label}
              >
                {nt.icon}
                <span className="text-[10px]">{nt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
