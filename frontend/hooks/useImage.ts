"use client";

import { useState, useCallback, useRef, useEffect } from "react";

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
      const response = await fetch(`${API_BASE_URL}/api/images`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const err = await safeJSON(response);
        throw new Error(err.error || `获取图片列表失败 (${response.status})`);
      }
      const data = await safeJSON(response);
      setImages(data.images || []);
      cachedImages = data.images || [];
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取图片列表失败");
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
    async (prompt: string, aspectRatio: string, resolution: string, quality: string = "medium", referenceImageUrl?: string) => {
      setIsGenerating(true);
      setError(null);

      try {
        const token = localStorage.getItem("token");
        const body: Record<string, any> = { prompt, aspect_ratio: aspectRatio, resolution, quality };
        if (referenceImageUrl) {
          body.reference_image_url = referenceImageUrl;
        }
        const response = await fetch(`${API_BASE_URL}/api/images/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const err = await safeJSON(response);
          throw new Error(err.error || `生成图片失败 (${response.status})`);
        }

        const data = await safeJSON(response);
        // 立即将 pending 记录加入列表并更新缓存
        const next = [data, ...images];
        setImages(next);
        cachedImages = next;
        // 启动轮询
        startPolling();
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : "生成图片失败");
        throw err;
      } finally {
        setIsGenerating(false);
      }
    },
    [startPolling, images]
  );

  const deleteImage = useCallback(async (id: number) => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/api/images/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const err = await safeJSON(response);
        throw new Error(err.error || "删除失败");
      }
      const next = images.filter((img) => img.id !== id);
      setImages(next);
      cachedImages = next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }, [images]);

  return {
    images,
    isGenerating,
    error,
    fetchImages,
    generateImage,
    deleteImage,
  };
}
