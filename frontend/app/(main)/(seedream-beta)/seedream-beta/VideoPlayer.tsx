"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Play, Pause, X, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";

interface VideoPlayerProps {
  videos: Array<{
    id: string;
    url: string;
    title: string;
    duration: number;
  }>;
  onClose: () => void;
}

export default function VideoPlayer({ videos, onClose }: VideoPlayerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [mounted, setMounted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentVideo = videos[currentIndex];

  const handlePlay = useCallback(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(() => {});
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  const handleNext = useCallback(() => {
    if (currentIndex < videos.length - 1) {
      setCurrentIndex((i) => i + 1);
      setProgress(0);
      setIsPlaying(true);
    }
  }, [currentIndex, videos.length]);

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      setProgress(0);
      setIsPlaying(true);
    }
  }, [currentIndex]);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current && videoRef.current.duration) {
      const p = (videoRef.current.currentTime / videoRef.current.duration) * 100;
      setProgress(p);
    }
  }, []);

  const handleEnded = useCallback(() => {
    if (currentIndex < videos.length - 1) {
      handleNext();
    } else {
      setIsPlaying(false);
    }
  }, [currentIndex, videos.length, handleNext]);

  useEffect(() => {
    if (videoRef.current && isPlaying) {
      videoRef.current.play().catch(() => {});
    }
  }, [currentIndex, isPlaying]);

  if (!mounted) return null;

  if (!currentVideo) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="rounded-xl bg-surface-elevated p-6 shadow-2xl">
          <div className="flex items-center gap-2">
            <X className="h-5 w-5 text-text-tertiary" />
            <span className="text-sm text-text-secondary">没有可播放的视频</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full rounded-lg bg-surface-card py-2 text-sm text-text-secondary hover:bg-surface-border"
          >
            关闭
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="flex w-full max-w-4xl flex-col rounded-xl bg-surface-elevated shadow-2xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">
              播放序列 ({currentIndex + 1}/{videos.length})
            </span>
            <span className="text-xs text-text-tertiary">{currentVideo.title}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-text-tertiary hover:bg-surface-card"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 视频区域 */}
        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            src={currentVideo.url}
            className="h-full w-full"
            muted={muted}
            autoPlay={isPlaying}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
            playsInline
          />
        </div>

        {/* 控制栏 */}
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-card disabled:opacity-30"
          >
            <SkipBack className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handlePlay}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white hover:bg-brand/90"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={handleNext}
            disabled={currentIndex === videos.length - 1}
            className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-card disabled:opacity-30"
          >
            <SkipForward className="h-4 w-4" />
          </button>

          {/* 进度条 */}
          <div className="flex flex-1 items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-card">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[10px] text-text-tertiary">
              {currentIndex + 1}/{videos.length}
            </span>
          </div>

          {/* 静音 */}
          <button
            type="button"
            onClick={() => setMuted((v) => !v)}
            className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-card"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>

        {/* 镜头列表 */}
        <div className="max-h-32 overflow-y-auto border-t border-surface-border px-4 py-2">
          <div className="flex gap-2">
            {videos.map((v, i) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setCurrentIndex(i);
                  setProgress(0);
                  setIsPlaying(true);
                }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg px-2 py-1 transition-colors",
                  i === currentIndex ? "bg-brand/10" : "hover:bg-surface-card"
                )}
              >
                <div className="h-8 w-12 rounded bg-surface-card" />
                <span className={cn(
                  "text-[9px]",
                  i === currentIndex ? "font-medium text-brand" : "text-text-tertiary"
                )}>
                  {i + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
