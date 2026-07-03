"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emitTaskFinished, registerBackgroundTask } from "@/lib/taskNotifications";
import { normalizeError, readApiError } from "@/lib/errors";
import { refreshVideoTaskThrottled } from "@/lib/videoRefreshThrottle";
import { apiFetch } from "@/lib/api/client";
import { readAuthState } from "@/lib/auth/state";

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
    resolution?: string;
    generate_audio?: boolean;
    watermark?: boolean;
    reference_image_urls?: string[];
    reference_image_roles?: Array<"reference_image" | "first_frame" | "last_frame">;
    reference_video_urls?: string[];
    reference_image_role_mode?: "reference" | "first_frame" | "first_last_frame";
  }) => Promise<VideoGeneration>;
  refreshVideo: (id: number) => Promise<VideoGeneration | null>;
  deleteVideo: (id: number) => Promise<void>;
  pollVideoStatus: (id: number) => Promise<void>;
}

function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = typeof window !== "undefined" ? readAuthState().token : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function useVideo(): UseVideoReturn {
  const [videos, setVideos] = useState<VideoGeneration[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<VideoGeneration | null>(null);
  const pollTimers = useRef<Map<number, NodeJS.Timeout>>(new Map());

  const fetchVideos = useCallback(async () => {
    try {
      const res = await apiFetch("/videos");
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
      resolution?: string;
      generate_audio?: boolean;
      watermark?: boolean;
      reference_image_urls?: string[];
      reference_image_roles?: Array<"reference_image" | "first_frame" | "last_frame">;
      reference_video_urls?: string[];
      reference_audio_urls?: string[];
    }): Promise<VideoGeneration> => {
      setGenerating(true);
      try {
        const res = await apiFetch("/videos", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const apiError = await readApiError(res);
          if (typeof apiError === "object" && apiError !== null) {
            const record = apiError as { message?: unknown; error?: unknown; debug?: unknown };
            const rawMessage = typeof record.message === "string"
              ? record.message
              : typeof record.error === "string"
                ? record.error
                : typeof record.debug === "string"
                  ? record.debug
                  : "";
            throw new Error(rawMessage.trim() ? `视频任务提交失败（HTTP ${res.status}）：${rawMessage.trim()}` : `视频任务提交失败（HTTP ${res.status}），接口未返回错误详情。`);
          }
          throw new Error(`视频任务提交失败（HTTP ${res.status}），接口未返回错误详情。`);
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
        registerBackgroundTask({
          type: "video",
          id: newVideo.id,
          title: "视频生成中",
          description: payload.prompt,
          href: "/video",
        });
        // auto start polling
        startPolling(newVideo.id);
        return newVideo;
      } catch (err) {
        if (typeof err === "object" && err !== null) {
          const record = err as { message?: unknown; error?: unknown; debug?: unknown };
          const rawMessage = typeof record.message === "string"
            ? record.message
            : typeof record.error === "string"
              ? record.error
              : typeof record.debug === "string"
                ? record.debug
                : "";
          if (rawMessage.trim()) throw new Error(rawMessage.trim());
        }
        if (typeof err === "string" && err.trim()) throw new Error(err.trim());
        throw normalizeError(err, { module: "video", fallbackMessage: "视频任务提交失败：浏览器请求没有成功发出或接口无响应。请检查登录状态、反向代理和网络连接。" });
      } finally {
        setGenerating(false);
      }
    },
    []
  );

  const refreshVideo = useCallback(async (id: number): Promise<VideoGeneration | null> => {
    try {
      const result = await refreshVideoTaskThrottled(id, getAuthHeaders());
      if (result.kind !== "ok") return null;
      const data: VideoGeneration = result.video;
      setVideos((prev) => prev.map((v) => (v.id === id ? data : v)));
      setCurrentVideo((prev) => (prev?.id === id ? data : prev));
      if (data.status === "succeeded" || data.status === "failed") {
        emitTaskFinished({
          key: `video:${data.id}`,
          type: "video",
          title: data.status === "succeeded" ? "视频任务已完成" : "视频任务未完成",
          description: data.status === "succeeded" ? data.prompt : data.error_message || "后端未返回具体失败原因，请检查视频任务日志或重试。",
          href: "/video",
          ok: data.status === "succeeded",
        });
      }
      return data;
    } catch {
      return null;
    }
  }, []);

  const deleteVideo = useCallback(async (id: number) => {
    const res = await apiFetch(`/videos/${id}`, {
      method: "DELETE",
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
      const scheduleNext = (delayMs: number) => {
        const timer = setTimeout(async () => {
          pollTimers.current.delete(id);
          const video = await refreshVideo(id);
          if (video && (video.status === "succeeded" || video.status === "failed")) {
            stopPolling(id);
            return;
          }
          const staggerMs = 20_000 + (id % 7) * 2_000;
          scheduleNext(video ? staggerMs : Math.max(staggerMs, 45_000));
        }, delayMs);
        pollTimers.current.set(id, timer);
      };
      scheduleNext(4_000 + (id % 5) * 1_500);
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
