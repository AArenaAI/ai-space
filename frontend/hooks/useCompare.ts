"use client";

import { useState, useCallback } from "react";
import { getErrorMessage, readApiError } from "@/lib/errors";
import { apiFetch } from "@/lib/api/client";

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
      const res = await apiFetch("/chat/compare", {
        method: "POST",
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
        throw await readApiError(res);
      }

      const data = await res.json();
      setResults(data.results || []);
      if (data.conversation_id) {
        setConversationId(data.conversation_id);
      }

      return { results: data.results || [], conversation_id: data.conversation_id };
    } catch (err) {
      setError(getErrorMessage(err, { module: "chat", fallbackMessage: "对比请求失败，请稍后重试。" }));
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


