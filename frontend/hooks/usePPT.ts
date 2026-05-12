"use client";

import { useState, useCallback } from "react";

const API_BASE_URL = ""; // 使用相对路径，nginx 同域名代理 /api -> 后端

export interface Slide {
  title: string;
  content: string[];
  subtitle?: string;
}

export interface PPTGeneration {
  id: number;
  topic: string;
  template: string;
  slide_count: number;
  slides: Slide[];
  status: string;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  preview: string;
  primaryColor: string;
}

export function usePPT() {
  const [ppts, setPpts] = useState<PPTGeneration[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 获取模板列表
  const fetchTemplates = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/api/ppt/templates`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("获取模板列表失败");
      }

      const data = await response.json();
      setTemplates(data.templates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取模板列表失败");
    }
  }, []);

  // 获取PPT列表
  const fetchPPTs = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/api/ppt`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("获取PPT列表失败");
      }

      const data = await response.json();
      setPpts(data.ppts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取PPT列表失败");
    }
  }, []);

  // 生成PPT
  const generatePPT = useCallback(async (topic: string, slideCount: number, template: string) => {
    setIsGenerating(true);
    setError(null);

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/api/ppt/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ topic, slide_count: slideCount, template }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "生成PPT失败");
      }

      const data = await response.json();
      setPpts((prev) => [data, ...prev]);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成PPT失败");
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  // 删除PPT
  const deletePPT = useCallback(async (id: number) => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/api/ppt/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("删除失败");
      }

      setPpts((prev) => prev.filter((ppt) => ppt.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }, []);

  return {
    ppts,
    templates,
    isGenerating,
    error,
    fetchTemplates,
    fetchPPTs,
    generatePPT,
    deletePPT,
  };
}
