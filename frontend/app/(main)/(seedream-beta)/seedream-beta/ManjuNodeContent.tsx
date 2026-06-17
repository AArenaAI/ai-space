"use client";

import { cn } from "@/lib/utils";
import {
  BookOpen,
  Box,
  Clapperboard,
  Image,
  Video,
  FileText,
  Layers,
  GripVertical,
  Maximize2,
  Minimize2,
  X,
  Sparkles,
  Wand2,
  Play,
  Pause,
} from "lucide-react";
import type { CanvasNode } from "./ManjuCanvas";

export interface ManjuNodeContentProps {
  node: CanvasNode;
  onPlayVideo?: (nodeId: string) => void;
  onPreviewImage?: (nodeId: string) => void;
}

const TYPE_CONFIG: Record<CanvasNode["type"], { icon: React.ReactNode; color: string; label: string }> = {
  script: { icon: <BookOpen className="h-3.5 w-3.5" />, color: "text-amber-600 bg-amber-50", label: "剧本" },
  assets: { icon: <Box className="h-3.5 w-3.5" />, color: "text-blue-600 bg-blue-50", label: "资产" },
  shot: { icon: <Clapperboard className="h-3.5 w-3.5" />, color: "text-violet-600 bg-violet-50", label: "镜头" },
  image: { icon: <Image className="h-3.5 w-3.5" />, color: "text-emerald-600 bg-emerald-50", label: "分镜图" },
  video: { icon: <Video className="h-3.5 w-3.5" />, color: "text-rose-600 bg-rose-50", label: "视频" },
  director: { icon: <Layers className="h-3.5 w-3.5" />, color: "text-cyan-600 bg-cyan-50", label: "导演台" },
  text: { icon: <FileText className="h-3.5 w-3.5" />, color: "text-gray-600 bg-gray-50", label: "文本" },
  group: { icon: <Layers className="h-3.5 w-3.5" />, color: "text-orange-600 bg-orange-50", label: "组" },
};

export default function ManjuNodeContent({ node, onPlayVideo, onPreviewImage }: ManjuNodeContentProps) {
  const config = TYPE_CONFIG[node.type];
  const shot = node.data as Record<string, unknown> | undefined;

  // 提取缩略图/视频 URL
  const imageUrl = shot?.imageAssetIds && Array.isArray(shot.imageAssetIds) && shot.imageAssetIds.length > 0
    ? (shot.imageAssetIds as string[])[0]
    : undefined;
  const videoUrl = shot?.videoAssetIds && Array.isArray(shot.videoAssetIds) && shot.videoAssetIds.length > 0
    ? (shot.videoAssetIds as string[])[0]
    : undefined;
  const firstFrameUrl = shot?.firstFrameAssetId as string | undefined;

  return (
    <div className="space-y-2">
      {/* 类型标签 */}
      <div className="flex items-center gap-1.5">
        <span className={cn("flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium", config.color)}>
          {config.icon}
          {config.label}
        </span>
        {node.status === "done" && (
          <span className="rounded-full bg-emerald-50 px-1.5 py-0 text-[10px] text-emerald-600">已完成</span>
        )}
        {node.status === "draft" && (
          <span className="rounded-full bg-amber-50 px-1.5 py-0 text-[10px] text-amber-600">草稿</span>
        )}
      </div>

      {/* 缩略图/视频预览 */}
      {Boolean(imageUrl || firstFrameUrl || videoUrl) && (
        <div className="relative overflow-hidden rounded-lg bg-surface-card">
          {videoUrl ? (
            <div className="relative aspect-video">
              <video
                src={videoUrl}
                className="h-full w-full object-cover"
                preload="metadata"
                muted
                playsInline
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPlayVideo?.(node.id);
                }}
                className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity hover:opacity-100"
              >
                <Play className="h-8 w-8 text-white" />
              </button>
            </div>
          ) : imageUrl || firstFrameUrl ? (
            <div className="relative aspect-video">
              <img
                src={imageUrl || firstFrameUrl}
                alt={node.title}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreviewImage?.(node.id);
                }}
                className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity hover:opacity-100"
              >
                <Maximize2 className="h-6 w-6 text-white" />
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* 提示词预览（限高） */}
      {Boolean(shot?.imagePrompt) && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-text-tertiary">分镜图提示词</div>
          <div className="line-clamp-3 text-[11px] leading-relaxed text-text-secondary">
            {shot ? String(shot.imagePrompt) : ""}
          </div>
        </div>
      )}

      {Boolean(shot?.videoPrompt) && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-text-tertiary">视频提示词</div>
          <div className="line-clamp-3 text-[11px] leading-relaxed text-text-secondary">
            {shot ? String(shot.videoPrompt) : ""}
          </div>
        </div>
      )}

      {/* 角色/场景标签 */}
      {shot && Array.isArray(shot.characters) && shot.characters.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(shot.characters as string[]).map((c) => (
            <span key={c} className="rounded-full bg-surface-card px-2 py-0.5 text-[10px] text-text-tertiary">
              {c}
            </span>
          ))}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-1 pt-1">
        {node.type === "shot" && (
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand/10 py-1.5 text-[10px] font-medium text-brand hover:bg-brand/20"
            onClick={(e) => {
              e.stopPropagation();
              // 触发分镜图生成
            }}
          >
            <Sparkles className="h-3 w-3" />
            生成分镜图
          </button>
        )}
        {node.type === "image" && (
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-rose-50 py-1.5 text-[10px] font-medium text-rose-600 hover:bg-rose-100"
            onClick={(e) => {
              e.stopPropagation();
              // 触发视频生成
            }}
          >
            <Wand2 className="h-3 w-3" />
            生成视频
          </button>
        )}
      </div>
    </div>
  );
}
