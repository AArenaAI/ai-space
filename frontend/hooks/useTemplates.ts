"use client";

import { useState, useEffect, useCallback } from "react";

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
      if (!res.ok) throw new Error(`获取模板失败 (${res.status})`);
      const data = await res.json();
      setTemplates(data);
    } catch (err: any) {
      setError(err.message);
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
      const err = await res.json();
      throw new Error(err.error || "创建模板失败");
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
      const err = await res.json();
      throw new Error(err.error || "更新模板失败");
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
      const err = await res.json();
      throw new Error(err.error || "删除模板失败");
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
