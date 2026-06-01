"use client";

import { memo, useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";

export type ChatScrollProgressProps = {
  scrollRatio: number;
  visible: boolean;
  onJumpToRatio: (ratio: number) => void;
  onDragStateChange: (dragging: boolean) => void;
};

const ChatScrollProgress = memo(function ChatScrollProgress({
  scrollRatio,
  visible,
  onJumpToRatio,
  onDragStateChange,
}: ChatScrollProgressProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const clampedRatio = Math.min(1, Math.max(0, Number.isFinite(scrollRatio) ? scrollRatio : 0));
  const thumbHeightPercent = 14;
  const thumbTopPercent = clampedRatio * (100 - thumbHeightPercent);

  const ratioFromClientY = useCallback((clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return clampedRatio;
    const usableHeight = rect.height * (1 - thumbHeightPercent / 100);
    if (usableHeight <= 0) return 0;
    return Math.min(1, Math.max(0, (clientY - rect.top - (rect.height * thumbHeightPercent / 200)) / usableHeight));
  }, [clampedRatio]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    setIsDragging(true);
    onDragStateChange(true);
    onJumpToRatio(ratioFromClientY(event.clientY));
  }, [onDragStateChange, onJumpToRatio, ratioFromClientY]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    onJumpToRatio(ratioFromClientY(event.clientY));
  }, [onJumpToRatio, ratioFromClientY]);

  const finishDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
    onDragStateChange(false);
  }, [onDragStateChange]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-1 z-[95] hidden w-7 justify-center sm:flex"
      data-testid="chat-scroll-progress-layer"
      aria-hidden="false"
    >
      <div
        ref={trackRef}
        role="scrollbar"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clampedRatio * 100)}
        aria-label="聊天阅读进度"
        tabIndex={0}
        className="group pointer-events-auto relative h-full w-5 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        data-testid="chat-scroll-progress-track"
      >
        <div
          className={cn(
            "absolute left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-slate-500/45 shadow-[0_0_0_1px_rgba(255,255,255,0.25)] transition-all duration-200 ease-out",
            "group-hover:w-1.5 group-hover:bg-slate-500/70 group-hover:shadow-sm group-focus-visible:w-1.5 group-focus-visible:bg-slate-500/70",
            "dark:bg-slate-200/38 dark:group-hover:bg-slate-200/68 green:bg-[#405E3D]/46 green:group-hover:bg-[#405E3D]/72",
            isDragging && "w-1.5 bg-slate-600/75 dark:bg-slate-100/75 green:bg-[#405E3D]/82"
          )}
          style={{ top: `${thumbTopPercent}%`, height: `${thumbHeightPercent}%` }}
          data-testid="chat-scroll-progress-thumb"
        />
      </div>
    </div>
  );
});

export default ChatScrollProgress;
