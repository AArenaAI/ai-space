"use client";

import { useEffect, useCallback, useState } from "react";
import { X, Download, ZoomIn, ZoomOut } from "lucide-react";

interface ImageLightboxProps {
  isOpen: boolean;
  imageUrl: string;
  alt?: string;
  onClose: () => void;
  onDownload?: () => void;
}

export default function ImageLightbox({
  isOpen,
  imageUrl,
  alt = "",
  onClose,
  onDownload,
}: ImageLightboxProps) {
  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    } else {
      document.body.style.overflow = "";
      setScale(1);
      setPos({ x: 0, y: 0 });
    }
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const zoomIn = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setScale((s) => Math.min(s * 1.25, 4));
  };

  const zoomOut = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setScale((s) => Math.max(s / 1.25, 0.5));
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  if (!isOpen || !imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center select-none"
      onClick={onClose}
    >
      {/* 背景 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* 顶部工具栏 */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3">
        {/* 左：关闭 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm flex items-center justify-center text-white/90 hover:text-white transition-all"
          title="关闭 (ESC)"
        >
          <X className="w-5 h-5" />
        </button>

        {/* 右：缩放 + 下载 */}
        <div className="flex items-center gap-2">
          <button
            onClick={zoomOut}
            className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm flex items-center justify-center text-white/80 hover:text-white transition-all"
            title="缩小"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="text-xs text-white/60 font-mono w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm flex items-center justify-center text-white/80 hover:text-white transition-all"
            title="放大"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          {onDownload && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
              className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm flex items-center justify-center text-white/80 hover:text-white transition-all ml-1"
              title="下载"
            >
              <Download className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* 图片区域 */}
      <div
        className="relative w-full h-full flex items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in" }}
      >
        <img
          src={imageUrl}
          alt={alt}
          className="max-w-[90vw] max-h-[85vh] object-contain select-none"
          draggable={false}
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
            transition: isDragging ? "none" : "transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      </div>

      {/* 底部提示 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/40 text-[11px] pointer-events-none">
        滚轮缩放 / 拖拽移动 / ESC 关闭
      </div>
    </div>
  );
}
