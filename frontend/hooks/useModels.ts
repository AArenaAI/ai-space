"use client";

import { useEffect, useState } from "react";

export interface ChatModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  color: string;
  capabilities?: string[];
  supported_inputs?: string[];
  supported_file_extensions?: string[];
  supported_file_mime_types?: string[];
  file_accept?: string;
}

const DEFAULT_CHAT: ChatModel[] = [
  { id: "gpt-5.4-mini", name: "GPT 5.4 Mini", provider: "OpenAI", description: "载入中...", color: "#10a37f", capabilities: ["chat", "reasoning"] },
];

const DEFAULT_IMAGE: ChatModel[] = [
  { id: "gpt-image-2", name: "GPT Image 2", provider: "OpenAI", description: "载入中...", color: "#10a37f", capabilities: ["image"] },
];

const DEFAULT_VIDEO: ChatModel[] = [
  { id: "doubao-seedance-2-0-fast-260128", name: "Seedance 2.0 Fast", provider: "Volcengine", description: "载入中...", color: "#ff6a00", capabilities: ["video"] },
  { id: "doubao-seedance-2-0-260128", name: "Seedance 2.0", provider: "Volcengine", description: "载入中...", color: "#ff0050", capabilities: ["video"] },
];

function loadCached(key: string, fallback: ChatModel[]): ChatModel[] {
  if (typeof window === "undefined") return fallback;
  try { const raw = localStorage.getItem(key); if (raw) return JSON.parse(raw); } catch {}
  return fallback;
}

function cacheModels(key: string, models: ChatModel[]) {
  try { localStorage.setItem(key, JSON.stringify(models)); } catch {}
}

function useModelList(endpoint: string, cacheKey: string, fallback: ChatModel[]) {
  const [models, setModels] = useState<ChatModel[]>(() => loadCached(cacheKey, fallback));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(endpoint)
      .then((res) => res.json())
      .then((data: ChatModel[]) => {
        if (cancelled || !Array.isArray(data) || data.length === 0) return;
        cacheModels(cacheKey, data);
        setModels(data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [endpoint, cacheKey]);

  return { models, loading };
}

/** 聊天模型列表 */
export function useModels() {
  return useModelList("/api/models/chat", "cached-chat-models", DEFAULT_CHAT);
}

/** 画图模型列表 */
export function useImageModels() {
  return useModelList("/api/models/image", "cached-image-models", DEFAULT_IMAGE);
}

/** 视频模型列表 */
export function useVideoModels() {
  return useModelList("/api/models/video", "cached-video-models", DEFAULT_VIDEO);
}
