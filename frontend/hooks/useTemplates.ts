"use client";

import { useState, useEffect, useCallback } from "react";
import { getErrorMessage, readApiError } from "@/lib/errors";

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
    const token = localStorage.getItem("token");
    if (!token) return;

    setLoading(true);
    try {
      const res = await fetch("/api/templates", {
        headers: { Authorization: `Bearer ${token}` },
      });
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
    const token = localStorage.getItem("token");
    if (!token) return null;

    const res = await fetch("/api/templates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
    const token = localStorage.getItem("token");
    if (!token) return;

    const res = await fetch(`/api/templates/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
    const token = localStorage.getItem("token");
    if (!token) return;

    const res = await fetch(`/api/templates/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
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
