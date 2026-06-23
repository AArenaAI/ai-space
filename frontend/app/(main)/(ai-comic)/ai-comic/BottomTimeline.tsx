"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Play, Image, Video, Clock, GripVertical, Pencil } from "lucide-react";

interface TimelineShot {
  id: string;
  index: number;
  title: string;
  scene?: string;
  duration: number;
  status: "empty" | "draft" | "done" | "error";
  hasImage: boolean;
  hasVideo: boolean;
}

interface BottomTimelineProps {
  shots: TimelineShot[];
  activeShotId?: string;
  onSelectShot: (id: string) => void;
  onReorderShots?: (newOrder: string[]) => void;
  onUpdateDuration?: (id: string, duration: number) => void;
  totalDuration: number;
  onPlayAll?: () => void;
}

const STATUS_COLORS = {
  empty: "bg-gray-300",
  draft: "bg-amber-400",
  done: "bg-emerald-500",
  error: "bg-red-500",
};

export default function BottomTimeline({
  shots,
  activeShotId,
  onSelectShot,
  onReorderShots,
  onUpdateDuration,
  totalDuration,
  onPlayAll,
}: BottomTimelineProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [editingDuration, setEditingDuration] = useState<string | null>(null);
  const [durationInput, setDurationInput] = useState("");

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("shotId", id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (id !== draggingId) setDragOverId(id);
  }, [draggingId]);

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData("shotId");
      if (sourceId && sourceId !== targetId && onReorderShots) {
        const newOrder = shots.map((s) => s.id);
        const sourceIdx = newOrder.indexOf(sourceId);
        const targetIdx = newOrder.indexOf(targetId);
        if (sourceIdx !== -1 && targetIdx !== -1) {
          newOrder.splice(sourceIdx, 1);
          newOrder.splice(targetIdx, 0, sourceId);
          onReorderShots(newOrder);
        }
      }
      setDraggingId(null);
      setDragOverId(null);
    },
    [shots, onReorderShots]
  );

  const handleDurationEdit = (shot: TimelineShot) => {
    setEditingDuration(shot.id);
    setDurationInput(String(shot.duration));
  };

  const handleDurationSubmit = (id: string) => {
    const val = parseInt(durationInput, 10);
    if (!isNaN(val) && val > 0 && onUpdateDuration) {
      onUpdateDuration(id, val);
    }
    setEditingDuration(null);
  };

  if (shots.length === 0) return null;

  return (
    <div className="flex h-16 shrink-0 items-center gap-3 border-t border-surface-border bg-surface-elevated px-4">
      {/* 总时长 */}
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-text-tertiary">
        <Clock className="h-3.5 w-3.5" />
        <span>{totalDuration}s</span>
      </div>

      <div className="mx-1 h-6 w-px bg-surface-border" />

      {/* 镜头时间轴 - 可拖拽 */}
      <div className="flex flex-1 items-center gap-1 overflow-x-auto">
        {shots.map((shot) => (
          <div
            key={shot.id}
            draggable
            onDragStart={(e) => handleDragStart(e, shot.id)}
            onDragOver={(e) => handleDragOver(e, shot.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, shot.id)}
            className={cn(
              "group relative flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 transition-colors",
              activeShotId === shot.id
                ? "bg-brand/10"
                : "hover:bg-surface-card",
              dragOverId === shot.id && "bg-brand/5 ring-1 ring-brand/20",
              draggingId === shot.id && "opacity-50"
            )}
          >
            {/* 拖拽手柄 */}
            <GripVertical className="h-2.5 w-2.5 text-text-tertiary/30" />

            {/* 缩略图条 */}
            <div className="relative h-6 w-12 overflow-hidden rounded">
              <div className={cn("h-full w-full", STATUS_COLORS[shot.status])} />
              {shot.hasVideo && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Video className="h-3 w-3 text-white/80" />
                </div>
              )}
              {shot.hasImage && !shot.hasVideo && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Image className="h-3 w-3 text-white/80" />
                </div>
              )}
            </div>

            {/* 镜头编号 */}
            <span
              className={cn(
                "text-[10px] font-medium",
                activeShotId === shot.id ? "text-brand" : "text-text-tertiary"
              )}
            >
              {shot.index}
            </span>

            {/* 时长 - 可编辑 */}
            {editingDuration === shot.id ? (
              <input
                type="number"
                value={durationInput}
                onChange={(e) => setDurationInput(e.target.value)}
                onBlur={() => handleDurationSubmit(shot.id)}
                onKeyDown={(e) => e.key === "Enter" && handleDurationSubmit(shot.id)}
                className="w-10 rounded border border-brand/30 bg-surface-base px-1 text-center text-[9px] text-text-primary outline-none"
                autoFocus
                min={1}
                max={60}
              />
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDurationEdit(shot);
                }}
                className="flex items-center gap-0.5 rounded px-1 text-[9px] text-text-tertiary/60 hover:bg-surface-card hover:text-text-secondary"
                title="点击编辑时长"
              >
                {shot.duration}s
                <Pencil className="h-2 w-2 opacity-0 group-hover:opacity-100" />
              </button>
            )}

            {/* 场景提示 */}
            {shot.scene && (
              <div className="absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-surface-card px-1.5 py-0.5 text-[9px] text-text-secondary shadow-sm group-hover:block">
                {shot.scene}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 播放按钮 */}
      <button
        type="button"
        onClick={onPlayAll}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand/90"
        title="播放全部"
      >
        <Play className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
