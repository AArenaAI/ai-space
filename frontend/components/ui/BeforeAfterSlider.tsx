"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";

interface BeforeAfterSliderProps {
  beforeImage: string;
  afterImage: string;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}

export default function BeforeAfterSlider({
  beforeImage,
  afterImage,
  beforeLabel = "原始",
  afterLabel = "处理后",
  className,
}: BeforeAfterSliderProps) {
  const [sliderPos, setSliderPos] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSliderPos(pct);
    },
    []
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    handleMove(e.clientX);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    handleMove(e.touches[0].clientX);
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => handleMove(e.touches[0].clientX);
    const onUp = () => setIsDragging(false);

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [isDragging, handleMove]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative select-none overflow-hidden rounded-2xl border border-surface-border bg-surface-card cursor-ew-resize",
        className
      )}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Before (底层 - 原始图) */}
      <div className="relative w-full aspect-[4/3] max-h-[inherit]">
        <img
          src={beforeImage}
          alt={beforeLabel}
          className="absolute inset-0 w-full h-full object-contain bg-surface"
          draggable={false}
        />
        <span className="absolute top-3 left-3 px-2 py-1 rounded-md bg-black/50 text-white text-xs font-medium backdrop-blur-sm">
          {beforeLabel}
        </span>
      </div>

      {/* After (上层 - 处理后的图，用 clipPath 裁剪) */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
      >
        <div className="relative w-full h-full">
          <img
            src={afterImage}
            alt={afterLabel}
            className="absolute inset-0 w-full h-full object-contain bg-surface"
            draggable={false}
          />
          <span className="absolute top-3 right-3 px-2 py-1 rounded-md bg-brand/80 text-white text-xs font-medium backdrop-blur-sm">
            {afterLabel}
          </span>
        </div>
      </div>

      {/* 滑动条分割线 */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white/80 shadow-[0_0_8px_rgba(0,0,0,0.3)] z-10"
        style={{ left: `${sliderPos}%`, transform: "translateX(-50%)" }}
      >
        {/* 滑块手柄 */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center border border-surface-border">
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
            <path d="M1 5H13M1 5L4 2M1 5L4 8M13 5L10 2M13 5L10 8" stroke="currentColor" strokeWidth="1.5" className="text-text-primary" />
          </svg>
        </div>
      </div>
    </div>
  );
}
