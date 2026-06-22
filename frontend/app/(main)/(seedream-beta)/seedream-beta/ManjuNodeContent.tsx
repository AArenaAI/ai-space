"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  Box,
  Clapperboard,
  Image,
  Video,
  FileText,
  Layers,
  Loader2,
  Maximize2,
  User,
  Upload,
  Sparkles,
  FolderOpen,
  X,
} from "lucide-react";
import type { CanvasNode } from "./ManjuCanvas";

export interface ManjuNodeContentProps {
  node: CanvasNode;
  onPlayVideo?: (nodeId: string) => void;
  onPreviewImage?: (nodeId: string) => void;
  onUpload?: (nodeId: string) => void;
  onGenerate?: (nodeId: string) => void;
  onPickFromLibrary?: (nodeId: string) => void;
  onSelect?: (nodeId: string) => void;
  assets?: Array<{ id: string; publicId?: string; name: string; category?: string; url?: string; image_url?: string }>;
}

const TYPE_CONFIG: Record<CanvasNode["type"], { icon: React.ReactNode; label: string }> = {
  script: { icon: <BookOpen className="h-3.5 w-3.5" />, label: "剧本" },
  assets: { icon: <Box className="h-3.5 w-3.5" />, label: "资产" },
  shot: { icon: <Clapperboard className="h-3.5 w-3.5" />, label: "镜头" },
  image: { icon: <Image className="h-3.5 w-3.5" />, label: "图片" },
  video: { icon: <Video className="h-3.5 w-3.5" />, label: "视频" },
  director: { icon: <Layers className="h-3.5 w-3.5" />, label: "导演台" },
  generator: { icon: <Sparkles className="h-3.5 w-3.5" />, label: "生成器组" },
  text: { icon: <FileText className="h-3.5 w-3.5" />, label: "文本" },
  group: { icon: <Layers className="h-3.5 w-3.5" />, label: "组" },
};

const STATUS_CONFIG: Record<string, { dot: string; label: string }> = {
  done: { dot: "bg-emerald-500", label: "已完成" },
  draft: { dot: "bg-amber-500", label: "草稿" },
  generating: { dot: "bg-blue-500", label: "生成中" },
  error: { dot: "bg-red-500", label: "失败" },
  empty: { dot: "bg-slate-300", label: "待补充" },
};

export default function ManjuNodeContent({
  node,
  onPreviewImage,
  onUpload,
  onGenerate,
  onPickFromLibrary,
  onSelect,
  assets,
}: ManjuNodeContentProps) {
  const config = TYPE_CONFIG[node.type];
  const shot = node.data as Record<string, unknown> | undefined;
  const shotHasImageMedia = node.type === "shot" && Array.isArray(shot?.imageAssetIds) && shot.imageAssetIds.length > 0;
  const staleVideoErrorOnShot = node.type === "shot" && node.status === "error" && (typeof shot?.errorMessage === "string" || shotHasImageMedia);
  const displayStatus = staleVideoErrorOnShot ? (shotHasImageMedia ? "done" : "draft") : node.status;
  const status = STATUS_CONFIG[displayStatus || "empty"];
  const [showActions, setShowActions] = useState(false);

  const semanticAsset = shot?.asset as { imageUrl?: string; imageAssetId?: string; linkedAssetIds?: string[]; kind?: string; lockPrompt?: string; summary?: string } | undefined;
  const directImageUrl = node.type !== "shot" && typeof shot?.imageUrl === "string" ? shot.imageUrl : undefined;
  const storyboardImageUrl = node.type === "shot" && typeof shot?.storyboardImageUrl === "string" ? shot.storyboardImageUrl : undefined;
  const directVideoUrl = node.type === "video" && typeof shot?.videoUrl === "string" ? shot.videoUrl : undefined;
  const imageUrl = directImageUrl
    || semanticAsset?.imageUrl
    || semanticAsset?.imageAssetId
    || (Array.isArray(semanticAsset?.linkedAssetIds) ? semanticAsset?.linkedAssetIds?.[0] : undefined)
    || (shot?.imageAssetIds && Array.isArray(shot.imageAssetIds) && shot.imageAssetIds.length > 0
      ? (shot.imageAssetIds as string[])[0]
      : undefined);
  const videoUrl = directVideoUrl || (node.type === "video" && shot?.videoAssetIds && Array.isArray(shot.videoAssetIds) && shot.videoAssetIds.length > 0
    ? (shot.videoAssetIds as string[])[0]
    : undefined);
  const firstFrameUrl = (typeof shot?.firstFrameUrl === "string" ? shot.firstFrameUrl : undefined) || (shot?.firstFrameAssetId as string | undefined);

  const resolvedImageUrl = (() => {
    if (!imageUrl) return undefined;
    if (imageUrl.startsWith("http")) return imageUrl;
    const asset = assets?.find((a) => a.id === imageUrl || a.publicId === imageUrl);
    return asset?.url || asset?.image_url || imageUrl;
  })();

  const resolvedVideoUrl = (() => {
    if (!videoUrl) return undefined;
    if (videoUrl.startsWith("http")) return videoUrl;
    const asset = assets?.find((a) => a.id === videoUrl || a.publicId === videoUrl);
    return asset?.url || asset?.image_url || videoUrl;
  })();

  const hasMedia = Boolean(resolvedImageUrl || firstFrameUrl || resolvedVideoUrl);
  const isAssetNode = node.type === "assets";
  const isGeneratorNode = node.type === "generator";
  const isGenerating = node.status === "generating";
  const rawErrorMessage = typeof shot?.errorMessage === "string" ? shot.errorMessage.trim() : "";
  const errorMessage = rawErrorMessage === "视频生成失败，请稍后再试。若多次失败，请换个提示词或素材。" || rawErrorMessage === "视频生成失败，请稍后重试或调整描述。" || rawErrorMessage === "视频生成失败，请稍后重试。" || rawErrorMessage === "视频生成失败"
    ? "后端未返回具体失败原因，请检查视频任务日志或重试。"
    : rawErrorMessage || undefined;
  const assetCategory = (node.data?.category as string) || (node.data?.assetType as string) || (node.data?.kind as string) || semanticAsset?.kind || "asset";
  const isCharacter = assetCategory === "character" || assetCategory === "角色";
  const isVideoGenerating = node.type === "video";
  const generatingLabel = isVideoGenerating ? "正在生成视频" : isAssetNode ? (isCharacter ? "正在生成角色图" : "正在生成资产图") : "正在生成图片";
  const generatingHint = isVideoGenerating ? "完成后会自动显示在这个视频节点" : isAssetNode ? "完成后会自动关联到这个资产节点" : "完成后会自动显示在这个节点";

  return (
    <div className="flex h-full min-h-[330px] flex-1 flex-col overflow-hidden rounded-[20px] bg-black/[0.18]">
      <div className="flex items-center gap-2 px-3 pb-2 pt-1">
        <span className={cn("h-2 w-2 rounded-full", status.dot)} />
        <span className="text-[11px] font-medium text-white/36">{status.label}</span>
        {isAssetNode && (
          <span className="ml-auto rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-0.5 text-[10px] font-medium text-white/[0.34]">
            {isCharacter ? "角色" : assetCategory}
          </span>
        )}
      </div>

      {isGeneratorNode ? (
        <div className="flex flex-1 flex-col justify-between rounded-[18px] border border-white/[0.08] bg-white/[0.04] p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[10px] font-semibold text-white/[0.55]">
              <span>{shot?.mode === "video" ? "Seedance 视频" : "Seedream 分镜图"}</span>
              <span>{Array.isArray(shot?.shotIds) ? shot?.shotIds.length : 0} 镜</span>
            </div>
            <p className="line-clamp-6 whitespace-pre-line text-[11px] leading-relaxed text-white/[0.58]">
              {String(shot?.promptPreview || "把镜头拖线连接到这里，形成可批量执行的生成器组。")}
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 text-[10px] leading-relaxed text-white/[0.42] shadow-sm">
            支持：镜头 → 生成器组；资产 → 镜头；生成前统一检查提示词和参考图。
          </div>
        </div>
      ) : node.type === "shot" ? (
        <div className="flex flex-1 flex-col justify-between rounded-[18px] border border-white/[0.08] bg-white/[0.035] p-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/[0.36]">Shot Card</div>
                <div className="mt-1 line-clamp-2 text-[13px] font-bold leading-snug text-white/85">
                  {String(shot?.scene || shot?.title || "镜头调度说明")}
                </div>
              </div>
              {storyboardImageUrl && (
                <div className="shrink-0 rounded-xl border border-white/[0.08] bg-black/30 p-1">
                  <img src={storyboardImageUrl} alt="分镜预览" className="h-14 w-20 rounded-lg object-cover" loading="lazy" />
                </div>
              )}
            </div>
            <div className="grid gap-2 text-[11px] leading-relaxed text-white/[0.58]">
              <div className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2">
                <span className="mr-2 font-bold text-white/[0.76]">分镜图提示词</span>
                <span className="line-clamp-3">{String(shot?.imagePrompt || "未填写；用于生成分镜图，不会直接作为视频首帧。")}</span>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2">
                <span className="mr-2 font-bold text-white/[0.76]">视频提示词</span>
                <span className="line-clamp-3">{String(shot?.videoPrompt || "未填写；派生视频节点时只带文本，不自动带首帧。")}</span>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2 text-[10px] leading-relaxed text-amber-100/65">
            镜头卡是导演指令卡；分镜图只是预览引用。视频首帧需绑定图片节点或明确首帧素材。
          </div>
        </div>
      ) : isGenerating ? (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-3 rounded-[18px] border border-white/[0.16] bg-white/[0.04] px-4 text-white/[0.82]">
          <Loader2 className="h-8 w-8 animate-spin" />
          <div className="text-center">
            <div className="text-[13px] font-bold">{generatingLabel}</div>
            <div className="mt-1 text-[11px] text-white/[0.42]">{generatingHint}</div>
          </div>
        </div>
      ) : displayStatus === "error" ? (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-3 rounded-[18px] border border-red-300/20 bg-white/[0.035] px-4 text-red-200/80">
          <div className="rounded-full border border-red-200/20 bg-white/[0.06] px-3 py-1 text-[11px] font-bold text-red-100/80 shadow-sm">生成失败</div>
          <p className="line-clamp-5 text-center text-[11px] leading-relaxed text-red-100/65">
            {errorMessage || "未返回具体错误。请重试，或检查参考图、提示词、模型参数。"}
          </p>
        </div>
      ) : isAssetNode && !hasMedia ? (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-3 rounded-[18px] border border-dashed border-white/[0.12] bg-white/[0.025] px-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-white/[0.08] bg-white/[0.05] text-white/25">
            {isCharacter ? <User className="h-7 w-7" /> : <Box className="h-7 w-7" />}
          </div>
          <span className="text-[12px] font-medium text-white/36">
            {isCharacter ? "未命名角色" : "待补充资产"}
          </span>

          {showActions && (
            <div className="absolute inset-x-2 top-2 z-10 rounded-xl border border-white/[0.1] bg-[#0d0d0e]/95 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-white/[0.72]">补充资产</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowActions(false); }}
                  className="rounded-full p-0.5 text-white/[0.38] hover:bg-white/[0.08] hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSelect?.(node.id); onUpload?.(node.id); setShowActions(false); }}
                  className="flex flex-col items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-2 text-[9px] text-white/[0.45] transition-colors hover:bg-white hover:text-black"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>上传</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSelect?.(node.id); onGenerate?.(node.id); setShowActions(false); }}
                  className="flex flex-col items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-2 text-[9px] text-white/[0.45] transition-colors hover:bg-white hover:text-black"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{isCharacter ? "角色图" : "生成"}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSelect?.(node.id); onPickFromLibrary?.(node.id); setShowActions(false); }}
                  className="flex flex-col items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-2 text-[9px] text-white/[0.45] transition-colors hover:bg-white hover:text-black"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>资产库</span>
                </button>
              </div>
            </div>
          )}

          {!showActions && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSelect?.(node.id); setShowActions(true); }}
              className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-white/[0.04]"
            >
              <span className="rounded-full border border-white bg-white px-4 py-2 text-[12px] font-semibold text-black shadow-sm">
                补充素材
              </span>
            </button>
          )}
        </div>
      ) : hasMedia ? (
        <div className="relative flex-1 overflow-hidden rounded-[18px] bg-black ring-1 ring-white/[0.06]">
          {resolvedVideoUrl ? (
            <div className="relative h-full w-full bg-black">
              <video
                src={resolvedVideoUrl}
                poster={resolvedImageUrl || firstFrameUrl}
                className="nodrag nopan h-full w-full object-contain"
                preload="metadata"
                playsInline
                controls
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              />
              <div className="pointer-events-none absolute left-2 top-2 rounded-full border border-white/[0.1] bg-black/[0.55] px-2 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur">
                可播放视频
              </div>
            </div>
          ) : (
            <>
              <img src={resolvedImageUrl || firstFrameUrl} alt={node.title} className="h-full w-full object-cover" loading="lazy" />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onPreviewImage?.(node.id); }}
                className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity hover:opacity-100"
              >
                <Maximize2 className="h-4 w-4 text-white" />
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-[18px] border border-dashed border-white/[0.12] bg-white/[0.025]">
          <div className="flex flex-col items-center gap-2 text-white/25">
            <span>{config.icon}</span>
            <span className="text-[11px]">{config.label}</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="truncate text-[11px] font-medium text-white/[0.42]">
          {isAssetNode
            ? (isCharacter ? "角色设定图 / 基础形象" : assetCategory)
            : shot?.scene ? String(shot.scene) : "未设置场景"}
        </div>
        {isAssetNode && isCharacter && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect?.(node.id); onGenerate?.(node.id); }}
            className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-black shadow-sm transition-colors hover:bg-white/[0.88]"
          >
            生成角色图
          </button>
        )}
        {shot?.duration ? (
          <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-medium text-white/32">
            {String(shot.duration)}s
          </span>
        ) : isAssetNode ? (
          <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-medium text-white/32">
            {assets?.filter((a) => (node.data?.semanticAssetIds as string[])?.includes(a.id)).length || 0} 项
          </span>
        ) : null}
      </div>
    </div>
  );
}
