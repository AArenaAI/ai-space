"use client";

import { Copy } from "lucide-react";
import type { DirectorBlock, StoryboardShot } from "./types";

type PromptSource = "imagePrompt" | "structuredFallback" | "videoPrompt" | "empty";

type Props = {
  mode: "image" | "video";
  shot: StoryboardShot;
  finalPrompt: string;
  directorBlock?: DirectorBlock;
  referenceImageCount: number;
  referenceVideoCount: number;
  onCopy: (value: string) => void;
};

function getPromptSource(mode: "image" | "video", shot: StoryboardShot): PromptSource {
  if (mode === "image") return shot.imagePrompt.trim() ? "imagePrompt" : "structuredFallback";
  if (shot.videoPrompt.trim()) return "videoPrompt";
  if (shot.imagePrompt.trim()) return "imagePrompt";
  return "empty";
}

function getPromptSourceLabel(source: PromptSource) {
  if (source === "imagePrompt") return "分镜图提示词";
  if (source === "structuredFallback") return "结构化字段兜底";
  if (source === "videoPrompt") return "视频提示词";
  return "空";
}

export default function ShotPromptInspector({
  mode,
  shot,
  finalPrompt,
  directorBlock,
  referenceImageCount,
  referenceVideoCount,
  onCopy,
}: Props) {
  const source = getPromptSource(mode, shot);
  const directorInjected = Boolean(directorBlock && finalPrompt.trim());

  return (
    <details className="rounded-2xl border border-brand/20 bg-brand/5 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-text-secondary">
        最终 Prompt 预览 · {mode === "image" ? "Seedream 图片" : "Seedance 视频"}
      </summary>
      <div className="mt-3 space-y-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <InfoBadge label="来源" value={getPromptSourceLabel(source)} />
          <InfoBadge label="导演台" value={directorInjected ? "已注入" : "未启用"} tone={directorInjected ? "brand" : "muted"} />
          <InfoBadge label="参考图" value={`${referenceImageCount} 张`} />
          <InfoBadge label="参考视频" value={`${referenceVideoCount} 条`} />
        </div>
        <textarea
          readOnly
          value={finalPrompt || "暂无可生成 prompt"}
          className="max-h-72 min-h-36 w-full resize-y rounded-xl border border-surface-border bg-surface-card px-3 py-2 font-mono text-xs leading-5 text-text-secondary outline-none"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onCopy(finalPrompt)}
            disabled={!finalPrompt.trim()}
            className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-brand/40 hover:text-text-primary disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" />
            复制最终 Prompt
          </button>
          {source === "structuredFallback" && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
              分镜图提示词为空，当前由镜头结构字段生成；没有借用视频提示词。
            </span>
          )}
        </div>
      </div>
    </details>
  );
}

function InfoBadge({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "brand" }) {
  return (
    <div className={tone === "brand" ? "rounded-xl border border-brand/30 bg-brand/10 px-3 py-2" : "rounded-xl border border-surface-border bg-surface-card px-3 py-2"}>
      <div className="text-[10px] font-medium text-text-tertiary">{label}</div>
      <div className={tone === "brand" ? "mt-0.5 text-xs font-semibold text-brand" : "mt-0.5 text-xs font-semibold text-text-secondary"}>{value}</div>
    </div>
  );
}
