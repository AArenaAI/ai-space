"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Circle, ChevronDown, ChevronRight, Clapperboard, ImageIcon, Loader2, Play, Video, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DirectorBlock, GenerationJob, StoredAsset, StoryboardShot } from "./types";
import { findDirectorBlockForShot } from "./directorBlock";

type Props = {
  shots: StoryboardShot[];
  assets: StoredAsset[];
  generationJobs: GenerationJob[];
  directorBlocks: DirectorBlock[];
  activeShotId?: string;
  selectedShotIds: string[];
  onSelectShot: (shotId: string) => void;
  onToggleSelectedShot: (shotId: string) => void;
  onBatchGenerate?: (kind: "sketch" | "image" | "video", shotIds: string[]) => void;
  isStoryboardSketchAsset: (asset: StoredAsset) => boolean;
  getShotStatusLabel: (status: StoryboardShot["status"]) => string;
  assetViewUrl: (publicIdOrUrl: string) => string;
};

function StatusPill({ ok, label, pending }: { ok: boolean; label: string; pending?: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
      ok ? "bg-emerald-500/10 text-emerald-600" : pending ? "bg-amber-500/10 text-amber-600" : "bg-surface-elevated text-text-tertiary",
    )}>
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : ok ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
      {label}
    </span>
  );
}

function Thumbnail({ src, label }: { src: string; label: string }) {
  if (!src) return null;
  return (
    <div className="group relative inline-block overflow-hidden rounded-lg border border-surface-border">
      <img src={src} alt={label} className="h-10 w-14 object-cover" loading="lazy" />
      <span className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5 text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100">{label}</span>
    </div>
  );
}

export default function ShotOverviewTable({
  shots,
  assets,
  generationJobs,
  directorBlocks,
  activeShotId,
  selectedShotIds,
  onSelectShot,
  onToggleSelectedShot,
  onBatchGenerate,
  isStoryboardSketchAsset,
  getShotStatusLabel,
  assetViewUrl,
}: Props) {
  const selectedSet = new Set(selectedShotIds);
  const [collapsedScenes, setCollapsedScenes] = useState<Set<string>>(new Set());

  const sceneGroups = useMemo(() => {
    const map = new Map<string, StoryboardShot[]>();
    for (const shot of shots) {
      const key = shot.scene || "未分组";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(shot);
    }
    return Array.from(map.entries());
  }, [shots]);

  const toggleScene = (scene: string) => {
    setCollapsedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(scene)) next.delete(scene); else next.add(scene);
      return next;
    });
  };

  const selectedMissing = useMemo(() => {
    const missingSketches: string[] = [];
    const missingImages: string[] = [];
    const missingVideos: string[] = [];
    for (const shot of shots) {
      if (!selectedSet.has(shot.id)) continue;
      const shotImages = assets.filter((a) => shot.imageAssetIds.includes(a.id) && a.type === "image");
      const hasSketch = shotImages.some(isStoryboardSketchAsset);
      const hasFormal = shotImages.some((a) => !isStoryboardSketchAsset(a));
      const hasVideo = assets.some((a) => shot.videoAssetIds.includes(a.id) && a.type === "video") || shot.videoAssetIds.length > 0;
      if (!hasSketch) missingSketches.push(shot.id);
      if (!hasFormal) missingImages.push(shot.id);
      if (!hasVideo) missingVideos.push(shot.id);
    }
    return { missingSketches, missingImages, missingVideos };
  }, [shots, assets, selectedSet, isStoryboardSketchAsset]);

  const renderShotRow = (shot: StoryboardShot) => {
    const shotImages = assets.filter((asset) => shot.imageAssetIds.includes(asset.id) && asset.type === "image");
    const sketchAssets = shotImages.filter(isStoryboardSketchAsset);
    const formalAssets = shotImages.filter((asset) => !isStoryboardSketchAsset(asset));
    const videoAssets = assets.filter((asset) => shot.videoAssetIds.includes(asset.id) && asset.type === "video");
    const hasDirector = Boolean(findDirectorBlockForShot(directorBlocks, shot.id));
    const pendingJobs = generationJobs.filter((job) => job.shotId === shot.id && job.status === "pending");
    const failedJobs = generationJobs.filter((job) => job.shotId === shot.id && job.status === "failed");
    const selected = selectedSet.has(shot.id);
    const active = shot.id === activeShotId;

    const firstSketch = sketchAssets[0];
    const firstFormal = formalAssets[0];
    const firstVideo = videoAssets[0];

    return (
      <tr key={shot.id} className={cn("transition-colors hover:bg-surface-elevated/70", active && "bg-brand/5")}>
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelectedShot(shot.id)}
            className="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand/40"
            aria-label={`选择镜头 ${shot.index}`}
          />
        </td>
        <td className="px-3 py-2">
          <button type="button" onClick={() => onSelectShot(shot.id)} className="max-w-[260px] text-left hover:text-brand">
            <div className="font-semibold text-text-primary">#{shot.index} {shot.title || "未命名镜头"}</div>
            <div className="line-clamp-1 text-[11px] text-text-tertiary">{shot.scene || shot.videoPrompt || shot.imagePrompt || "暂无描述"}</div>
          </button>
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <StatusPill ok={sketchAssets.length > 0} label={sketchAssets.length ? `${sketchAssets.length} 张` : "缺"} pending={pendingJobs.some((job) => job.intent === "storyboard_sketch")} />
            {firstSketch && <Thumbnail src={assetViewUrl(firstSketch.publicId || firstSketch.url)} label="草稿" />}
          </div>
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <StatusPill ok={formalAssets.length > 0} label={formalAssets.length ? `${formalAssets.length} 张` : "缺"} pending={pendingJobs.some((job) => job.type === "image" && job.intent !== "storyboard_sketch")} />
            {firstFormal && <Thumbnail src={assetViewUrl(firstFormal.publicId || firstFormal.url)} label="正式图" />}
          </div>
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <StatusPill ok={videoAssets.length > 0} label={videoAssets.length ? `${videoAssets.length} 条` : "缺"} pending={pendingJobs.some((job) => job.type === "video")} />
            {firstVideo && (
              <div className="group relative inline-block overflow-hidden rounded-lg border border-surface-border">
                <video src={assetViewUrl(firstVideo.publicId || firstVideo.url)} className="h-10 w-14 object-cover" muted preload="metadata" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                  <Play className="h-4 w-4 text-white" />
                </span>
              </div>
            )}
          </div>
        </td>
        <td className="px-3 py-2"><StatusPill ok={hasDirector} label={hasDirector ? "已设" : "未设"} /></td>
        <td className="px-3 py-2">
          {pendingJobs.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600"><Loader2 className="h-3 w-3 animate-spin" />{pendingJobs.length} 进行中</span>
          ) : failedJobs.length > 0 ? (
            <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600">{failedJobs.length} 失败</span>
          ) : (
            <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] text-text-tertiary">空闲</span>
          )}
        </td>
        <td className="px-3 py-2">
          <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] text-text-tertiary">{getShotStatusLabel(shot.status)}</span>
        </td>
      </tr>
    );
  };

  return (
    <div className="mb-4 rounded-2xl border border-surface-border bg-surface-card p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-text-primary">镜头总览表</div>
          <p className="mt-1 text-xs text-text-tertiary">一屏检查草稿、正式图、视频、导演台和队列状态；勾选后可批量生成缺失项。</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedShotIds.length > 0 && onBatchGenerate && (
            <div className="flex flex-wrap gap-1.5">
              {selectedMissing.missingSketches.length > 0 && (
                <button type="button" onClick={() => onBatchGenerate("sketch", selectedMissing.missingSketches)} className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] font-medium text-brand hover:bg-brand/15">
                  <Wand2 className="h-3 w-3" />补草稿({selectedMissing.missingSketches.length})
                </button>
              )}
              {selectedMissing.missingImages.length > 0 && (
                <button type="button" onClick={() => onBatchGenerate("image", selectedMissing.missingImages)} className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] font-medium text-brand hover:bg-brand/15">
                  <ImageIcon className="h-3 w-3" />补正式图({selectedMissing.missingImages.length})
                </button>
              )}
              {selectedMissing.missingVideos.length > 0 && (
                <button type="button" onClick={() => onBatchGenerate("video", selectedMissing.missingVideos)} className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] font-medium text-brand hover:bg-brand/15">
                  <Video className="h-3 w-3" />补视频({selectedMissing.missingVideos.length})
                </button>
              )}
            </div>
          )}
          <div className="text-xs text-text-tertiary">已选 {selectedShotIds.length} / {shots.length}</div>
        </div>
      </div>
      <div className="max-h-80 overflow-auto rounded-xl border border-surface-border">
        <table className="w-full min-w-[860px] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-surface-elevated text-[11px] uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-10 px-3 py-2">选</th>
              <th className="px-3 py-2">镜头</th>
              <th className="px-3 py-2">草稿</th>
              <th className="px-3 py-2">正式图</th>
              <th className="px-3 py-2">视频</th>
              <th className="px-3 py-2">导演台</th>
              <th className="px-3 py-2">队列</th>
              <th className="px-3 py-2">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {sceneGroups.map(([scene, sceneShots]) => {
              const collapsed = collapsedScenes.has(scene);
              return (
                <>
                  <tr key={`scene-${scene}`} className="bg-surface-elevated/40">
                    <td colSpan={8} className="px-3 py-1.5">
                      <button type="button" onClick={() => toggleScene(scene)} className="flex w-full items-center gap-1.5 text-left text-[11px] font-medium text-text-secondary hover:text-text-primary">
                        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        <span className="truncate">{scene}</span>
                        <span className="ml-1 rounded-full bg-surface-card px-1.5 py-0.5 text-[10px] text-text-tertiary">{sceneShots.length} 镜头</span>
                      </button>
                    </td>
                  </tr>
                  {!collapsed && sceneShots.map(renderShotRow)}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-text-tertiary">
        <span className="inline-flex items-center gap-1"><Wand2 className="h-3 w-3" />草稿用于验证构图</span>
        <span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" />正式图可做首帧/参考图</span>
        <span className="inline-flex items-center gap-1"><Video className="h-3 w-3" />视频生成状态独立追踪</span>
        <span className="inline-flex items-center gap-1"><Clapperboard className="h-3 w-3" />导演台控制空间/站位</span>
      </div>
    </div>
  );
}
