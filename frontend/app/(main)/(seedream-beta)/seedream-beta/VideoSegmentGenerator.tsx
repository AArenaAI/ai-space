"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Scissors,
  Play,
  Link2,
  Clock,
  ChevronRight,
  Film,
  ImageIcon,
  ArrowRight,
  Download,
  Check,
} from "lucide-react";
import type { StoryboardShot } from "./types";

export type VideoSegment = {
  id: string;
  shots: StoryboardShot[];
  duration: number; // 总时长（秒）
  startTime: number; // 在完整片段中的起始时间
  status: "pending" | "generating" | "completed" | "error";
  videoUrl?: string;
  lastFrameUrl?: string; // 尾帧 URL，用于下一段衔接
};

export type VideoSegmentGeneratorProps = {
  shots: StoryboardShot[];
  onGenerateSegment: (segment: VideoSegment) => Promise<void>;
  onExtractLastFrame: (videoUrl: string) => Promise<string>;
  segments?: VideoSegment[];
};

export default function VideoSegmentGenerator({
  shots,
  onGenerateSegment,
  onExtractLastFrame,
  segments: initialSegments,
}: VideoSegmentGeneratorProps) {
  const [segments, setSegments] = useState<VideoSegment[]>(
    initialSegments || []
  );
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [segmentDuration, setSegmentDuration] = useState(15); // 每段最大15秒
  const [shotsPerSegment, setShotsPerSegment] = useState(4); // 每段4个镜头

  // 自动分段：按行或按镜头数
  const autoSegment = useCallback(() => {
    const newSegments: VideoSegment[] = [];
    let currentShots: StoryboardShot[] = [];
    let currentDuration = 0;
    let startTime = 0;
    let segmentIndex = 0;

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const shotDuration = shot.duration || 3; // 默认3秒/镜头

      // 如果加入当前镜头会超过限制，则先结束当前段
      if (
        currentShots.length >= shotsPerSegment ||
        currentDuration + shotDuration > segmentDuration
      ) {
        if (currentShots.length > 0) {
          newSegments.push({
            id: `segment-${segmentIndex}`,
            shots: [...currentShots],
            duration: currentDuration,
            startTime,
            status: "pending",
          });
          startTime += currentDuration;
          segmentIndex++;
        }
        currentShots = [shot];
        currentDuration = shotDuration;
      } else {
        currentShots.push(shot);
        currentDuration += shotDuration;
      }
    }

    // 处理剩余镜头
    if (currentShots.length > 0) {
      newSegments.push({
        id: `segment-${segmentIndex}`,
        shots: [...currentShots],
        duration: currentDuration,
        startTime,
        status: "pending",
      });
    }

    setSegments(newSegments);
  }, [shots, segmentDuration, shotsPerSegment]);

  // 生成单个段落
  const generateSegment = useCallback(
    async (segment: VideoSegment) => {
      setSegments((prev) =>
        prev.map((s) => (s.id === segment.id ? { ...s, status: "generating" } : s))
      );

      try {
        await onGenerateSegment(segment);

        // 生成完成后提取尾帧
        // const lastFrame = await onExtractLastFrame(segment.videoUrl!);

        setSegments((prev) =>
          prev.map((s) =>
            s.id === segment.id
              ? { ...s, status: "completed" /* lastFrameUrl: lastFrame */ }
              : s
          )
        );
      } catch (error) {
        setSegments((prev) =>
          prev.map((s) => (s.id === segment.id ? { ...s, status: "error" } : s))
        );
      }
    },
    [onGenerateSegment]
  );

  // 生成全部段落
  const generateAll = useCallback(async () => {
    for (const segment of segments) {
      if (segment.status === "pending") {
        await generateSegment(segment);
      }
    }
  }, [segments, generateSegment]);

  // 衔接提示：下一段使用上一段的尾帧
  const getSegmentLinkPrompt = (segmentIndex: number): string => {
    if (segmentIndex === 0) return "";
    const prevSegment = segments[segmentIndex - 1];
    if (!prevSegment.lastFrameUrl) return "";

    return "【衔接】以上一段尾帧为开头，保持动作连续性";
  };

  return (
    <div className="space-y-4">
      {/* 分段设置 */}
      <div className="rounded-lg border border-surface-border bg-surface-card p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scissors className="h-4 w-4 text-brand" />
            <span className="text-sm font-medium text-text-primary">
              视频分段生成
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={autoSegment}
              className="rounded bg-surface-elevated px-2 py-1 text-xs text-text-secondary hover:bg-brand/10 hover:text-brand"
            >
              自动分段
            </button>
            <button
              onClick={generateAll}
              disabled={segments.length === 0}
              className="flex items-center gap-1 rounded bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-hover disabled:opacity-50"
            >
              <Play className="h-3 w-3" />
              全部生成
            </button>
          </div>
        </div>

        <div className="mt-3 flex gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-tertiary">每段时长:</span>
            <select
              value={segmentDuration}
              onChange={(e) => setSegmentDuration(Number(e.target.value))}
              className="rounded border border-surface-border bg-surface-elevated px-1 py-0.5 text-xs"
            >
              <option value={5}>5秒</option>
              <option value={10}>10秒</option>
              <option value={15}>15秒（Seedance上限）</option>
              <option value={20}>20秒</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-tertiary">每段镜头:</span>
            <select
              value={shotsPerSegment}
              onChange={(e) => setShotsPerSegment(Number(e.target.value))}
              className="rounded border border-surface-border bg-surface-elevated px-1 py-0.5 text-xs"
            >
              <option value={2}>2镜</option>
              <option value={3}>3镜</option>
              <option value={4}>4镜（推荐）</option>
              <option value={5}>5镜</option>
            </select>
          </div>
        </div>
      </div>

      {/* 段落列表 */}
      <div className="space-y-2">
        {segments.map((segment, index) => (
          <div
            key={segment.id}
            onClick={() => setActiveSegmentId(segment.id)}
            className={cn(
              "rounded-lg border p-3 transition-all",
              activeSegmentId === segment.id
                ? "border-brand bg-brand/5"
                : "border-surface-border bg-surface-card hover:border-brand/30"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-elevated text-xs font-medium text-text-secondary">
                  {index + 1}
                </span>
                <div>
                  <div className="text-sm font-medium text-text-primary">
                    段落 {index + 1}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-text-tertiary">
                    <Clock className="h-3 w-3" />
                    {segment.duration}s · {segment.shots.length} 镜头
                    {segment.startTime > 0 && (
                      <>
                        <span>· 起始 {segment.startTime}s</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* 状态 */}
                {segment.status === "completed" && (
                  <span className="flex items-center gap-1 text-xs text-green-500">
                    <Check className="h-3 w-3" />
                    完成
                  </span>
                )}
                {segment.status === "generating" && (
                  <span className="text-xs text-brand">生成中...</span>
                )}
                {segment.status === "error" && (
                  <span className="text-xs text-red-500">失败</span>
                )}

                {/* 衔接标记 */}
                {index > 0 && (
                  <span className="flex items-center gap-1 text-xs text-text-tertiary">
                    <Link2 className="h-3 w-3" />
                    衔接
                  </span>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    generateSegment(segment);
                  }}
                  disabled={segment.status === "generating"}
                  className="flex items-center gap-1 rounded bg-brand/10 px-2 py-1 text-xs text-brand hover:bg-brand/20 disabled:opacity-50"
                >
                  <Play className="h-3 w-3" />
                  生成
                </button>
              </div>
            </div>

            {/* 镜头缩略图 */}
            <div className="mt-2 flex gap-1">
              {segment.shots.map((shot, shotIndex) => (
                <div
                  key={shot.id}
                  className="flex flex-1 items-center gap-1 rounded border border-surface-border bg-surface-elevated p-1"
                >
                  {shot.imageAssetIds?.length > 0 ? (
                    <img
                      src={shot.imageAssetIds[0]}
                      alt=""
                      className="h-8 w-8 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-surface-card">
                      <ImageIcon className="h-4 w-4 text-surface-border" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[10px] font-medium text-text-secondary">
                      {shot.title}
                    </div>
                    <div className="text-[9px] text-text-tertiary">
                      {shot.shotType}
                    </div>
                  </div>
                  {shotIndex < segment.shots.length - 1 && (
                    <ArrowRight className="h-3 w-3 shrink-0 text-text-tertiary" />
                  )}
                </div>
              ))}
            </div>

            {/* 衔接提示 */}
            {index > 0 && segments[index - 1].lastFrameUrl && (
              <div className="mt-2 flex items-center gap-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
                <Link2 className="h-3 w-3" />
                将使用上一段尾帧作为首帧参考，保持动作连续性
              </div>
            )}
          </div>
        ))}

        {segments.length === 0 && (
          <div className="rounded-lg border border-dashed border-surface-border bg-surface-card p-6 text-center">
            <Film className="mx-auto h-8 w-8 text-surface-border" />
            <p className="mt-2 text-sm text-text-tertiary">
              点击"自动分段"将 {shots.length} 个镜头按规则分组
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
