"use client";

import { useState, useCallback } from "react";

const API_BASE_URL = "";

export interface GeneratedImage {
  id: number;
  prompt: string;
  size: string;
  image_url: string;
  status: string;
  created_at: string;
}

export function useImage() {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取图片列表失败");
    }
  }, []);

  const generateImage = useCallback(async (prompt: string, size: string = "1024x1024") => {
    setIsGenerating(true);
    setError(null);

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/api/images/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt, size }),
      });

      if (!response.ok) {
        const err = await safeJSON(response);
        throw new Error(err.error || `生成图片失败 (${response.status})`);
      }

      const data = await safeJSON(response);
      setImages((prev) => [data, ...prev]);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成图片失败");
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, []);

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
      setImages((prev) => prev.filter((img) => img.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }, []);

  return {
    images,
    isGenerating,
    error,
    fetchImages,
    generateImage,
    deleteImage,
  };
}
