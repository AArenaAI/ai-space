"use client";

import { useState, useEffect, useCallback } from "react";

export interface Workspace {
  id: number;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// 模块级缓存
let cachedWorkspaces: Workspace[] | null = null;
let cachedCurrentWS: Workspace | null = null;

const WS_KEY = "current-workspace";

function getStoredId(): number {
  if (typeof window === "undefined") return 0;
  const stored = localStorage.getItem(WS_KEY);
  return stored ? Number(stored) : 0;
}

function storeId(id: number) {
  localStorage.setItem(WS_KEY, String(id));
}

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(cachedWorkspaces || []);
  const [currentWS, setCurrentWS] = useState<Workspace | null>(cachedCurrentWS);
  const [loading, setLoading] = useState(cachedWorkspaces === null);

  const fetchWorkspaces = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setWorkspaces([]);
      setCurrentWS(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/workspaces", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.workspaces || []);
      setWorkspaces(list);
      cachedWorkspaces = list;

      // 恢复选中的 workspace
      const storedId = getStoredId();
      const target = list.find((w: Workspace) => w.id === storedId) || list.find((w: Workspace) => w.is_default) || list[0];
      if (target) {
        setCurrentWS(target);
        cachedCurrentWS = target;
        storeId(target.id);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const switchWorkspace = useCallback((ws: Workspace) => {
    setCurrentWS(ws);
    cachedCurrentWS = ws;
    storeId(ws.id);
    // 通知侧边栏刷新对话列表
    window.dispatchEvent(new CustomEvent("workspace-changed", { detail: ws }));
  }, []);

  const createWorkspace = useCallback(async (name: string): Promise<Workspace | null> => {
    const token = localStorage.getItem("token");
    if (!token) return null;
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return null;
      const wsBody = await res.json();
      const ws = wsBody.workspace || wsBody;
      // 刷新列表
      await fetchWorkspaces();
      return ws;
    } catch {
      return null;
    }
  }, [fetchWorkspaces]);

  const deleteWorkspace = useCallback(async (id: number) => {
    const token = localStorage.getItem("token");
    if (!token) return false;
    try {
      const res = await fetch(`/api/workspaces/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      // 如果删除的是当前 workspace，切换到默认
      if (currentWS?.id === id) {
        const remaining = workspaces.filter(w => w.id !== id);
        const defaultWS = remaining.find(w => w.is_default) || remaining[0];
        if (defaultWS) switchWorkspace(defaultWS);
      }
      await fetchWorkspaces();
      return true;
    } catch {
      return false;
    }
  }, [fetchWorkspaces, currentWS, workspaces, switchWorkspace]);

  const renameWorkspace = useCallback(async (id: number, name: string) => {
    const token = localStorage.getItem("token");
    if (!token) return false;
    try {
      const res = await fetch(`/api/workspaces/${id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return false;
      await fetchWorkspaces();
      return true;
    } catch {
      return false;
    }
  }, [fetchWorkspaces]);

  // 初始加载
  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  // 监听登录变化
  useEffect(() => {
    const handler = () => fetchWorkspaces();
    window.addEventListener("user-login", handler);
    window.addEventListener("user-logout", handler);
    window.addEventListener("conversation-created", handler);
    return () => {
      window.removeEventListener("user-login", handler);
      window.removeEventListener("user-logout", handler);
      window.removeEventListener("conversation-created", handler);
    };
  }, [fetchWorkspaces]);

  return { workspaces, currentWS, loading, switchWorkspace, createWorkspace, deleteWorkspace, renameWorkspace, refresh: fetchWorkspaces };
}
