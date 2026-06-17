"use client";

import { CheckCircle2, Circle, Clapperboard, ImageIcon, Loader2, Video, Wand2 } from "lucide-react";
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
  isStoryboardSketchAsset: (asset: StoredAsset) => boolean;
  getShotStatusLabel: (status: StoryboardShot["status"]) => string;
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

export default function ShotOverviewTable({
  shots,
  assets,
  generationJobs,
  directorBlocks,
  activeShotId,
  selectedShotIds,
  onSelectShot,
  onToggleSelectedShot,
  isStoryboardSketchAsset,
  getShotStatusLabel,
}: Props) {
  const selectedSet = new Set(selectedShotIds);

  return (
    <div className="mb-4 rounded-2xl border border-surface-border bg-surface-card p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-text-primary">镜头总览表</div>
          <p className="mt-1 text-xs text-text-tertiary">一屏检查草稿、正式图、视频、导演台和队列状态；勾选后可把当前导演台应用到选中镜头。</p>
        </div>
        <div className="text-xs text-text-tertiary">已选 {selectedShotIds.length} / {shots.length}</div>
      </div>
      <div className="max-h-72 overflow-auto rounded-xl border border-surface-border">
        <table className="w-full min-w-[760px] border-collapse text-left text-xs">
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
            {shots.map((shot) => {
              const shotImages = assets.filter((asset) => shot.imageAssetIds.includes(asset.id) && asset.type === "image");
              const sketchCount = shotImages.filter(isStoryboardSketchAsset).length;
              const formalImageCount = shotImages.filter((asset) => !isStoryboardSketchAsset(asset)).length;
              const videoCount = assets.filter((asset) => shot.videoAssetIds.includes(asset.id) && asset.type === "video").length || shot.videoAssetIds.length;
              const hasDirector = Boolean(findDirectorBlockForShot(directorBlocks, shot.id));
              const pendingJobs = generationJobs.filter((job) => job.shotId === shot.id && job.status === "pending");
              const failedJobs = generationJobs.filter((job) => job.shotId === shot.id && job.status === "failed");
              const selected = selectedSet.has(shot.id);
              const active = shot.id === activeShotId;

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
                  <td className="px-3 py-2"><StatusPill ok={sketchCount > 0} label={sketchCount ? `${sketchCount} 张` : "缺"} pending={pendingJobs.some((job) => job.intent === "storyboard_sketch")} /></td>
                  <td className="px-3 py-2"><StatusPill ok={formalImageCount > 0} label={formalImageCount ? `${formalImageCount} 张` : "缺"} pending={pendingJobs.some((job) => job.type === "image" && job.intent !== "storyboard_sketch")} /></td>
                  <td className="px-3 py-2"><StatusPill ok={videoCount > 0} label={videoCount ? `${videoCount} 条` : "缺"} pending={pendingJobs.some((job) => job.type === "video")} /></td>
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
