"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DirectorBlock, StoredAsset, StoryboardShot } from "./types";

export type BatchPreflightKind = "sketches" | "images" | "videos";

type Props = {
  kind: BatchPreflightKind;
  queue: StoryboardShot[];
  assets: StoredAsset[];
  directorBlocks: DirectorBlock[];
};

export default function BatchPreflightPanel({ kind, queue, assets, directorBlocks }: Props) {
  if (!queue.length) return null;

  const missingPrompt = queue.filter((shot) => {
    if (kind === "sketches") return !(shot.scene.trim() || shot.imagePrompt.trim() || shot.videoPrompt.trim());
    if (kind === "images") return !(shot.imagePrompt.trim() || shot.scene.trim() || shot.title.trim());
    return !(shot.videoPrompt.trim() || shot.imagePrompt.trim());
  }).length;
  const withDirector = queue.filter((shot) => directorBlocks.some((block) => block.shotId === shot.id)).length;
  const withImageRefs = queue.filter((shot) => shot.referenceAssetIds.some((id) => assets.find((asset) => asset.id === id && asset.type === "image"))).length;
  const withVideoRefs = queue.filter((shot) => shot.referenceAssetIds.some((id) => assets.find((asset) => asset.id === id && asset.type === "video"))).length;
  const withFirstFrame = queue.filter((shot) => Boolean(shot.firstFrameAssetId)).length;
  const riskyVideoFallback = kind === "videos" ? queue.filter((shot) => !shot.videoPrompt.trim() && shot.imagePrompt.trim()).length : 0;

  const title = kind === "sketches" ? "批量草稿图预检" : kind === "images" ? "批量正式图预检" : "批量视频预检";
  const ok = missingPrompt === 0;

  return (
    <div className={cn("mb-4 rounded-2xl border p-3", ok ? "border-emerald-200 bg-emerald-50/70" : "border-amber-200 bg-amber-50/70")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />}
          <div>
            <div className={cn("text-xs font-semibold", ok ? "text-emerald-700" : "text-amber-700")}>{title}</div>
            <div className="mt-1 text-[11px] leading-4 text-text-tertiary">
              当前队列 {queue.length} 个镜头；点击批量按钮会按队列顺序逐个提交，暂停只会在当前提交结束后生效。
            </div>
          </div>
        </div>
        {!ok && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-700">{missingPrompt} 个缺 prompt</span>}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="队列" value={`${queue.length}`} />
        <Metric label="缺 Prompt" value={`${missingPrompt}`} tone={missingPrompt ? "warn" : "ok"} />
        <Metric label="导演台" value={`${withDirector}`} />
        <Metric label="参考图" value={`${withImageRefs}`} />
        <Metric label="首帧" value={`${withFirstFrame}`} />
        <Metric label="参考视频" value={`${withVideoRefs}`} />
      </div>
      {riskyVideoFallback > 0 && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-700">
          {riskyVideoFallback} 个视频镜头没有 videoPrompt，将暂时使用 imagePrompt 生成视频；建议补齐视频提示词以减少动作丢失。
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "ok" | "warn" }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card px-3 py-2">
      <div className="text-[10px] text-text-tertiary">{label}</div>
      <div className={cn("mt-0.5 text-sm font-semibold", tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-700" : "text-text-primary")}>{value}</div>
    </div>
  );
}
