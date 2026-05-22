"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface VideoGeneration {
  id: number;
  prompt: string;
  model: string;
  ratio: string;
  duration: number;
  generate_audio: boolean;
  watermark: boolean;
  task_id: string;
  status: string;
  video_url: string;
  error_message: string;
  created_at: string;
  updated_at: string;
}

interface UseVideoReturn {
  videos: VideoGeneration[];
  loading: boolean;
  generating: boolean;
  currentVideo: VideoGeneration | null;
  generateVideo: (payload: {
    prompt: string;
    model: string;
    ratio?: string;
    duration?: number;
    generate_audio?: boolean;
    watermark?: boolean;
    reference_image_urls?: string[];
    reference_video_urls?: string[];
    reference_audio_urls?: string[];
  }) => Promise<void>;
  refreshVideo: (id: number) => Promise<VideoGeneration | null>;
  deleteVideo: (id: number) => Promise<void>;
  pollVideoStatus: (id: number) => Promise<void>;
}

export function useVideo(): UseVideoReturn {
  const [videos, setVideos] = useState<VideoGeneration[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<VideoGeneration | null>(null);
  const pollTimers = useRef<Map<number, NodeJS.Timeout>>(new Map());

  const fetchVideos = useCallback(async () => {
    try {
      const res = await fetch("/api/videos", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.videos)) {
        setVideos(data.videos);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVideos();
    return () => {
      pollTimers.current.forEach((t) => clearInterval(t));
      pollTimers.current.clear();
    };
  }, [fetchVideos]);

  const generateVideo = useCallback(
    async (payload: {
      prompt: string;
      model: string;
      ratio?: string;
      duration?: number;
      generate_audio?: boolean;
      watermark?: boolean;
      reference_image_urls?: string[];
      reference_video_urls?: string[];
      reference_audio_urls?: string[];
    }) => {
      setGenerating(true);
      try {
        const res = await fetch("/api/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "生成失败");
        }
        const data = await res.json();
        const newVideo: VideoGeneration = {
          ...data,
          id: data.id,
          status: data.status || "pending",
          video_url: "",
          error_message: "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setCurrentVideo(newVideo);
        setVideos((prev) => [newVideo, ...prev]);
        // auto start polling
        startPolling(newVideo.id);
      } finally {
        setGenerating(false);
      }
    },
    []
  );

  const refreshVideo = useCallback(async (id: number): Promise<VideoGeneration | null> => {
    try {
      const res = await fetch(`/api/videos/${id}/refresh`, { credentials: "include" });
      if (!res.ok) return null;
      const data: VideoGeneration = await res.json();
      setVideos((prev) => prev.map((v) => (v.id === id ? data : v)));
      if (currentVideo?.id === id) setCurrentVideo(data);
      return data;
    } catch {
      return null;
    }
  }, [currentVideo]);

  const deleteVideo = useCallback(async (id: number) => {
    const res = await fetch(`/api/videos/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setVideos((prev) => prev.filter((v) => v.id !== id));
      if (currentVideo?.id === id) setCurrentVideo(null);
      stopPolling(id);
    }
  }, [currentVideo]);

  const startPolling = useCallback(
    (id: number) => {
      if (pollTimers.current.has(id)) return;
      const timer = setInterval(async () => {
        const video = await refreshVideo(id);
        if (video && (video.status === "succeeded" || video.status === "failed")) {
          stopPolling(id);
        }
      }, 8000);
      pollTimers.current.set(id, timer);
    },
    [refreshVideo]
  );

  const stopPolling = useCallback((id: number) => {
    const t = pollTimers.current.get(id);
    if (t) {
      clearInterval(t);
      pollTimers.current.delete(id);
    }
  }, []);

  const pollVideoStatus = useCallback(
    async (id: number) => {
      startPolling(id);
    },
    [startPolling]
  );

  return {
    videos,
    loading,
    generating,
    currentVideo,
    generateVideo,
    refreshVideo,
    deleteVideo,
    pollVideoStatus,
  };
}
