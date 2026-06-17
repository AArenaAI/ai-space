"use client";

import { useState, useMemo } from "react";
import { Video, Scissors, ArrowRight, Play, Pause, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, Trash2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StoryboardShot, VideoSegment } from "./types";

interface VideoSegmentGeneratorProps {
  shots: StoryboardShot[];
  assets: Array<{ id: string; publicId: string; type: string; url: string }>;
  onGenerateSegment: (segment: VideoSegment) => Promise<void>;
  onDeleteSegment?: (segmentId: string) => void;
  generatingSegmentId?: string | null;
}

const MAX_SEGMENT_DURATION = 15; // 秒

export default function VideoSegmentGenerator({
  shots,
  assets,
  onGenerateSegment,
  onDeleteSegment,
  generatingSegmentId,
}: VideoSegmentGeneratorProps) {
  const [segments, setSegments] = useState<VideoSegment[]>([]);
  const [expandedSegment, setExpandedSegment] = useState<string | null>(null);
  const [autoSplit, setAutoSplit] = useState(true);

  // 自动拆段：按 15 秒上限分组
  const autoSegments = useMemo(() => {
    if (!autoSplit || shots.length === 0) return [];
    const result: VideoSegment[] = [];
    let current: StoryboardShot[] = [];
    let currentDuration = 0;
    let segmentIndex = 1;

    for (const shot of shots) {
      const shotDuration = shot.duration || 5;
      if (currentDuration + shotDuration > MAX_SEGMENT_DURATION && current.length > 0) {
        // 结束当前段
        result.push({
          id: `segment-${segmentIndex}`,
          index: segmentIndex,
          title: `段落 ${segmentIndex} (${current.length} 镜)`,
          shots: [...current],
          lastFrameShotId: current[current.length - 1]?.id,
          status: "draft",
        });
        segmentIndex++;
        current = [shot];
        currentDuration = shotDuration;
      } else {
        current.push(shot);
        currentDuration += shotDuration;
      }
    }
    if (current.length > 0) {
      result.push({
        id: `segment-${segmentIndex}`,
        index: segmentIndex,
        title: `段落 ${segmentIndex} (${current.length} 镜)`,
        shots: [...current],
        lastFrameShotId: current[current.length - 1]?.id,
        status: "draft",
      });
    }
    return result;
  }, [shots, autoSplit]);

  const displaySegments = segments.length > 0 ? segments : autoSegments;

  const handleGenerate = async (segment: VideoSegment) => {
    setSegments((prev) =>
      prev.map((s) => (s.id === segment.id ? { ...s, status: "generating" } : s))
    );
    try {
      await onGenerateSegment(segment);
      setSegments((prev) =>
        prev.map((s) => (s.id === segment.id ? { ...s, status: "done" } : s))
      );
    } catch {
      setSegments((prev) =>
        prev.map((s) => (s.id === segment.id ? { ...s, status: "failed" } : s))
      );
    }
  };

  const getLastFrameAsset = (shotId?: string) => {
    if (!shotId) return null;
    const shot = shots.find((s) => s.id === shotId);
    if (!shot?.lastFrameAssetId) return null;
    return assets.find((a) => a.id === shot.lastFrameAssetId);
  };

  const getSegmentDuration = (segment: VideoSegment) =>
    segment.shots.reduce((sum, shot) => sum + (shot.duration || 5), 0);

  return (
    <div className="flex flex-col gap-3">
      {/* 控制栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-brand" />
          <span className="text-sm font-semibold text-text-primary">视频分段生成器</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={autoSplit}
              onChange={(e) => setAutoSplit(e.target.checked)}
              className="rounded border-surface-border"
            />
            自动拆段
          </label>
          <span className="text-xs text-text-tertiary">每段 ≤ {MAX_SEGMENT_DURATION} 秒</span>
        </div>
      </div>

      {/* 分段列表 */}
      {displaySegments.length === 0 ? (
        <div className="rounded-xl border border-surface-border bg-surface-card p-6 text-center">
          <Video className="mx-auto mb-2 h-8 w-8 text-text-tertiary" />
          <p className="text-sm text-text-secondary">暂无镜头可分段</p>
          <p className="text-xs text-text-tertiary mt-1">先生成分镜镜头，再拆段生成视频</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {displaySegments.map((segment) => {
            const duration = getSegmentDuration(segment);
            const isExpanded = expandedSegment === segment.id;
            const lastFrameAsset = getLastFrameAsset(segment.lastFrameShotId);
            const isGenerating = generatingSegmentId === segment.id || segment.status === "generating";

            return (
              <div
                key={segment.id}
                className={cn(
                  "rounded-xl border bg-surface-card overflow-hidden",
                  segment.status === "done"
                    ? "border-emerald-200"
                    : segment.status === "failed"
                    ? "border-red-200"
                    : "border-surface-border"
                )}
              >
                {/* 头部 */}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setExpandedSegment(isExpanded ? null : segment.id)}
                    className="text-text-tertiary hover:text-text-primary"
                  >
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">
                        {segment.title}
                      </span>
                      <span className="text-xs text-text-tertiary">
                        {segment.shots.length} 镜 · {duration} 秒
                      </span>
                    </div>
                    {lastFrameAsset && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <ArrowRight className="h-3 w-3 text-amber-500" />
                        <span className="text-xs text-amber-600">尾帧衔接: 镜头 {segment.lastFrameShotId?.slice(-4)}</span>
                      </div>
                    )}
                  </div>

                  {/* 状态 */}
                  {segment.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  {segment.status === "failed" && <AlertCircle className="h-4 w-4 text-red-500" />}
                  {isGenerating && <Loader2 className="h-4 w-4 text-brand animate-spin" />}

                  {/* 操作 */}
                  <button
                    type="button"
                    onClick={() => handleGenerate(segment)}
                    disabled={isGenerating || segment.status === "done"}
                    className={cn(
                      "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium",
                      segment.status === "done"
                        ? "bg-emerald-50 text-emerald-600 cursor-default"
                        : "bg-brand/10 text-brand hover:bg-brand/20 disabled:opacity-50"
                    )}
                  >
                    {isGenerating ? (
                      <>
                        <Pause className="h-3 w-3" />
                        生成中
                      </>
                    ) : segment.status === "done" ? (
                      <>
                        <CheckCircle2 className="h-3 w-3" />
                        完成
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-3 w-3" />
                        生成
                      </>
                    )}
                  </button>

                  {onDeleteSegment && (
                    <button
                      type="button"
                      onClick={() => onDeleteSegment(segment.id)}
                      className="text-text-tertiary hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* 展开内容：镜头列表 */}
                {isExpanded && (
                  <div className="border-t border-surface-border px-3 py-2">
                    <div className="flex flex-col gap-1.5">
                      {segment.shots.map((shot, idx) => (
                        <div
                          key={shot.id}
                          className="flex items-center gap-2 rounded-lg bg-surface-hover px-2 py-1.5"
                        >
                          <span className="text-xs text-text-tertiary w-6">{idx + 1}</span>
                          <span className="text-xs text-text-primary truncate flex-1">
                            {shot.title || `镜头 ${shot.index}`}
                          </span>
                          <span className="text-xs text-text-tertiary">{shot.duration || 5} 秒</span>
                          {shot.videoAssetIds.length > 0 && (
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 尾帧预览 */}
                    {lastFrameAsset && (
                      <div className="mt-2 flex items-center gap-2 rounded-lg bg-amber-50 p-2">
                        <ArrowRight className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-xs text-amber-700">下一段首帧将使用此尾帧衔接</span>
                        <img
                          src={lastFrameAsset.url}
                          alt="尾帧"
                          className="h-8 w-8 rounded object-cover ml-auto"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
