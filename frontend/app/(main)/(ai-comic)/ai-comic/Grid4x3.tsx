"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Grid3X3,
  Play,
  ImageIcon,
  Wand2,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Camera,
  Clock,
  Type,
} from "lucide-react";
import type { StoryboardShot } from "./types";

export type Grid4x3Props = {
  shots: StoryboardShot[];
  onSelectShot: (shot: StoryboardShot) => void;
  onGenerateImage: (shot: StoryboardShot) => void;
  onGenerateVideo: (shot: StoryboardShot) => void;
  selectedShotId?: string;
  activeRow?: number; // 当前激活的行（用于分段生成）
};

export default function Grid4x3({
  shots,
  onSelectShot,
  onGenerateImage,
  onGenerateVideo,
  selectedShotId,
  activeRow,
}: Grid4x3Props) {
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [showRowSelector, setShowRowSelector] = useState(false);

  // 将镜头按行分组（每行4个）
  const rows: StoryboardShot[][] = [];
  for (let i = 0; i < shots.length; i += 4) {
    rows.push(shots.slice(i, i + 4));
  }

  // 确保有3行（不足补空位）
  while (rows.length < 3) {
    rows.push([]);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Grid3X3 className="h-5 w-5 text-brand" />
          <span className="text-sm font-semibold text-text-primary">
            4×3 故事板
          </span>
          <span className="text-xs text-text-tertiary">
            ({shots.length} 镜头 / {rows.length} 行)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRowSelector(!showRowSelector)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
              showRowSelector
                ? "bg-brand/20 text-brand"
                : "bg-surface-card text-text-secondary hover:text-text-primary"
            )}
          >
            <Camera className="h-3.5 w-3.5" />
            分段生成
          </button>
        </div>
      </div>

      {/* 行选择器（用于分段生成） */}
      {showRowSelector && (
        <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card p-2">
          <span className="text-xs text-text-tertiary">选择行:</span>
          {rows.map((_, rowIndex) => (
            <button
              key={rowIndex}
              onClick={() => {
                // 选中整行镜头进行批量生成
                const rowShots = rows[rowIndex];
                rowShots.forEach((shot) => onGenerateVideo(shot));
              }}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium",
                activeRow === rowIndex
                  ? "bg-brand text-white"
                  : "bg-surface-elevated text-text-secondary hover:bg-brand/10"
              )}
            >
              第{rowIndex + 1}行 ({rows[rowIndex].length}镜)
            </button>
          ))}
        </div>
      )}

      {/* 4×3 网格 */}
      <div className="grid grid-cols-4 gap-2">
        {rows.map((row, rowIndex) =>
          row.map((shot, colIndex) => {
            const cellIndex = rowIndex * 4 + colIndex;
            const isSelected = shot.id === selectedShotId;
            const isHovered = hoveredCell === shot.id;
            const hasImage = shot.imageAssetIds?.length > 0;
            const hasVideo = shot.videoAssetIds?.length > 0;

            return (
              <div
                key={shot.id}
                onClick={() => onSelectShot(shot)}
                onMouseEnter={() => setHoveredCell(shot.id)}
                onMouseLeave={() => setHoveredCell(null)}
                className={cn(
                  "group relative aspect-video cursor-pointer overflow-hidden rounded-lg border transition-all",
                  isSelected
                    ? "border-brand ring-2 ring-brand/20"
                    : "border-surface-border hover:border-brand/40"
                )}
              >
                {/* 缩略图或占位 */}
                {hasImage ? (
                  <img
                    src={shot.imageAssetIds[0]}
                    alt={shot.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-surface-elevated">
                    <ImageIcon className="h-8 w-8 text-surface-border" />
                  </div>
                )}

                {/* 悬停遮罩 */}
                {isHovered && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 backdrop-blur-sm">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onGenerateImage(shot);
                      }}
                      className="flex items-center gap-1.5 rounded bg-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/30"
                    >
                      <Wand2 className="h-3 w-3" />
                      生图
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onGenerateVideo(shot);
                      }}
                      className="flex items-center gap-1.5 rounded bg-brand/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand"
                    >
                      <Play className="h-3 w-3" />
                      生视频
                    </button>
                  </div>
                )}

                {/* 状态标签 */}
                <div className="absolute left-2 top-2 flex gap-1">
                  <span className="rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {rowIndex + 1}-{colIndex + 1}
                  </span>
                  {hasVideo && (
                    <span className="rounded bg-brand/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      视频
                    </span>
                  )}
                </div>

                {/* 底部信息 */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <div className="text-[10px] font-medium text-white">
                    {shot.title}
                  </div>
                  <div className="flex items-center gap-1.5 text-[9px] text-white/70">
                    <span>{shot.shotType}</span>
                    <span>·</span>
                    <Clock className="h-2.5 w-2.5" />
                    <span>{shot.duration}s</span>
                  </div>
                </div>

                {/* 选中指示 */}
                {isSelected && (
                  <div className="absolute right-2 top-2 h-2 w-2 rounded-full bg-brand" />
                )}
              </div>
            );
          })
        )}

        {/* 空位填充（保持4×3布局） */}
        {Array.from({ length: 12 - shots.length }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-surface-border bg-surface-elevated/50"
          >
            <span className="text-xs text-text-tertiary">空</span>
          </div>
        ))}
      </div>

      {/* 镜头信息面板 */}
      {selectedShotId && (
        <div className="rounded-lg border border-surface-border bg-surface-card p-3">
          {(() => {
            const shot = shots.find((s) => s.id === selectedShotId);
            if (!shot) return null;
            return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-primary">
                    {shot.title}
                  </span>
                  <span className="text-xs text-text-tertiary">
                    {shot.shotType} · {shot.cameraMove}
                  </span>
                </div>
                <p className="text-xs text-text-secondary line-clamp-2">
                  {shot.scene}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => onGenerateImage(shot)}
                    className="flex items-center gap-1.5 rounded bg-surface-elevated px-2 py-1 text-xs text-text-secondary hover:bg-brand/10 hover:text-brand"
                  >
                    <ImageIcon className="h-3 w-3" />
                    生成图片
                  </button>
                  <button
                    onClick={() => onGenerateVideo(shot)}
                    className="flex items-center gap-1.5 rounded bg-brand/10 px-2 py-1 text-xs text-brand hover:bg-brand/20"
                  >
                    <Play className="h-3 w-3" />
                    生成视频
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
