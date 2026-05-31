"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { emitTaskFinished, registerBackgroundTask } from "@/lib/taskNotifications";
import { getErrorMessage, normalizeError, readApiError } from "@/lib/errors";

const API_BASE_URL = "";

// 模块级缓存：避免组件重新挂载时图片列表消失
let cachedImages: GeneratedImage[] | null = null;

export interface GeneratedImage {
  id: number;
  prompt: string;
  size: string;
  image_url: string;
  status: string;
  error_message?: string;
  created_at: string;
}

export function useImage() {
  const [images, setImages] = useState<GeneratedImage[]>(cachedImages || []);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 安全解析 JSON 响应
  async function safeJSON(res: Response): Promise<any> {
    const text = await res.text();
    if (!text || text.trim() === "") {
      throw new Error(`服务器返回空响应 (HTTP ${res.status})`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`服务器返回异常 (HTTP ${res.status}): ${text.slice(0, 100)}`);
    }
  }

  const fetchImages = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        setImages([]);
        cachedImages = [];
        return;
      }
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`${API_BASE_URL}/api/images`, { headers });
      if (!response.ok) {
        throw await readApiError(response);
      }
      const data = await safeJSON(response);
      const nextImages = data.images || [];
      setImages(nextImages);
      cachedImages = nextImages;
      nextImages.forEach((image: GeneratedImage) => {
        if (image.status === "succeeded" || image.status === "failed") {
          emitTaskFinished({
            key: `image:${image.id}`,
            type: "image",
            title: image.status === "succeeded" ? "图片任务已完成" : "图片任务未完成",
            description: image.status === "succeeded" ? image.prompt : image.error_message || image.prompt,
            href: "/image",
            ok: image.status === "succeeded",
          });
        }
      });
    } catch (err) {
      setError(getErrorMessage(err, { module: "image", fallbackMessage: "获取图片记录失败，请刷新重试。" }));
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    // 避免重复启动
    stopPolling();

    // 立即刷新一次
    fetchImages();

    // 每 3 秒刷新列表，有 pending 时一直轮询
    pollTimer.current = setInterval(() => {
      fetchImages();
    }, 3000);
  }, [fetchImages, stopPolling]);

  // 组件卸载时清理轮询
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // 初始加载：mount 时无条件刷新，但先显示缓存
  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  // 当没有 pending 图片时自动停止轮询
  useEffect(() => {
    const hasPending = images.some((img) => img.status === "pending");
    if (!hasPending && pollTimer.current) {
      stopPolling();
    }
  }, [images, stopPolling]);

  const generateImage = useCallback(
    async (prompt: string, aspectRatio: string, resolution: string, quality: string = "medium", referenceImageUrls?: string[]) => {
      setIsGenerating(true);
      setError(null);

      try {
        const token = localStorage.getItem("token");
        const body: Record<string, any> = { prompt, aspect_ratio: aspectRatio, resolution, quality };
        if (referenceImageUrls && referenceImageUrls.length > 0) {
          body.reference_image_urls = referenceImageUrls;
        }
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(`${API_BASE_URL}/api/images/generate`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw await readApiError(response);
        }

        const data = await safeJSON(response);
        registerBackgroundTask({
          type: "image",
          id: data.id,
          title: "图片生成中",
          description: prompt,
          href: "/image",
        });
        // 立即将 pending 记录加入列表并更新缓存
        const next = [data, ...images];
        setImages(next);
        cachedImages = next;
        // 启动轮询
        startPolling();
        return data;
      } catch (err) {
        const userError = normalizeError(err, { module: "image", fallbackMessage: "图片生成失败，请稍后重试。" });
        setError(userError.message);
        throw userError;
      } finally {
        setIsGenerating(false);
      }
    },
    [startPolling, images]
  );

  const upsertImage = useCallback((image: GeneratedImage) => {
    setImages((prev) => {
      const exists = prev.some((item) => item.id === image.id);
      const next = exists
        ? prev.map((item) => (item.id === image.id ? { ...item, ...image } : item))
        : [image, ...prev];
      cachedImages = next;
      return next;
    });
  }, []);

  const deleteImage = useCallback(async (id: number) => {
    try {
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`${API_BASE_URL}/api/images/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!response.ok) {
        throw await readApiError(response);
      }
      const next = images.filter((img) => img.id !== id);
      setImages(next);
      cachedImages = next;
    } catch (err) {
      setError(getErrorMessage(err, { module: "image", fallbackMessage: "删除失败，请稍后重试。" }));
    }
  }, [images]);

  return {
    images,
    isGenerating,
    error,
    fetchImages,
    startPolling,
    upsertImage,
    generateImage,
    deleteImage,
  };
}
