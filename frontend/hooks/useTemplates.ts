"use client";

import { useState, useEffect, useCallback } from "react";
import { getErrorMessage, readApiError } from "@/lib/errors";
import { apiFetch } from "@/lib/api/client";
import { readAuthState } from "@/lib/auth/state";

export interface Template {
  id: number;
  user_id: number;
  name: string;
  prefix: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export function useTemplates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    if (!readAuthState().user) return;

    setLoading(true);
    try {
      const res = await apiFetch("/templates");
      if (!res.ok) throw await readApiError(res);
      const data = await res.json();
      setTemplates(data);
    } catch (err) {
      setError(getErrorMessage(err, { fallbackMessage: "获取模板失败，请刷新重试。" }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const createTemplate = useCallback(async (name: string, prefix: string, isDefault: boolean = false) => {
    if (!readAuthState().user) return null;

    const res = await apiFetch("/templates", {
      method: "POST",
      body: JSON.stringify({ name, prefix, is_default: isDefault }),
    });

    if (!res.ok) {
      throw await readApiError(res);
    }

    const tpl = await res.json();
    setTemplates((prev) => [...prev, tpl]);
    return tpl;
  }, []);

  const updateTemplate = useCallback(async (id: number, updates: Partial<Template>) => {
    if (!readAuthState().user) return;

    const res = await apiFetch(`/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      throw await readApiError(res);
    }

    const updated = await res.json();
    setTemplates((prev) => prev.map((t) => (t.id === id ? updated : t)));
    return updated;
  }, []);

  const deleteTemplate = useCallback(async (id: number) => {
    if (!readAuthState().user) return;

    const res = await apiFetch(`/templates/${id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      throw await readApiError(res);
    }

    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return {
    templates,
    loading,
    error,
    fetchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  };
}
