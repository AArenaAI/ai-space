"use client";

import { useState, useCallback } from "react";

export interface CompareResult {
  model_id: string;
  model_name: string;
  content: string;
  error?: string;
  elapsed_ms: number;
}

export interface CompareResponse {
  results: CompareResult[];
  conversation_id?: number;
}

export function useCompare() {
  const [results, setResults] = useState<CompareResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | undefined>(undefined);

  const compareChat = useCallback(async (
    query: string,
    modelIDs: string[],
    options?: { templateId?: number; reasoning?: boolean; search?: boolean; conversationId?: number }
  ): Promise<{ results: CompareResult[]; conversation_id?: number }> => {
    setLoading(true);
    setError(null);
    setResults([]);
    setConversationId(undefined);

    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/chat/compare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query,
          models: modelIDs,
          template_id: options?.templateId || 0,
          reasoning: options?.reasoning || false,
          search: options?.search || false,
          conversation_id: options?.conversationId || 0,
        }),
      });

      if (!res.ok) {
        const err = await tryParseError(res);
        throw new Error(err || `对比请求失败 (${res.status})`);
      }

      const data = await res.json();
      setResults(data.results || []);
      if (data.conversation_id) {
        setConversationId(data.conversation_id);
      }

      return { results: data.results || [], conversation_id: data.conversation_id };
    } catch (err: any) {
      setError(err.message);
      return { results: [] };
    } finally {
      setLoading(false);
    }
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
    setError(null);
    setConversationId(undefined);
  }, []);

  return { results, loading, error, conversationId, compareChat, clearResults };
}

async function tryParseError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return "";
    const json = JSON.parse(text);
    return json.error || json.message || text.slice(0, 200);
  } catch {
    return `HTTP ${res.status}`;
  }
}
