"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { getGuestId } from "@/lib/guestId";
import { toast } from "sonner";

export interface FavoriteItem {
  id: number;
  message_id: number;
  group_id?: number;
  conv_id: number;
  user_msg_id: number;
  model_id: string;
  content: string;
  created_at: string;
  conv_title?: string;
  user_query?: string;
}

export interface FavoritesResponse {
  items: FavoriteItem[];
  total: number;
  page: number;
  page_size: number;
  total_page: number;
}

interface FavoriteOptions {
  silent?: boolean;
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = localStorage.getItem("token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    const guestId = getGuestId();
    if (guestId) headers["X-Guest-ID"] = guestId;
  }
  return headers;
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [favoriteList, setFavoriteList] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const fetchedRef = useRef(false);
  const checkedIdsRef = useRef<Set<number>>(new Set());
  const processingRef = useRef<Set<number>>(new Set());

  // 批量检查收藏状态
  const checkBatch = useCallback(async (messageIds: number[]) => {
    const ids = Array.from(new Set(messageIds.filter((id) => id > 0))).filter((id) => !checkedIdsRef.current.has(id));
    if (ids.length === 0) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    ids.forEach((id) => checkedIdsRef.current.add(id));
    try {
      const res = await fetch(`/api/favorites/check-batch?message_ids=${ids.join(",")}`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data: Record<number, boolean> = await res.json();
        setFavorites((prev) => {
          const next = new Set(prev);
          Object.entries(data).forEach(([id, fav]) => {
            const nid = Number(id);
            if (fav) next.add(nid);
            else next.delete(nid);
          });
          return next;
        });
      }
    } catch {
      ids.forEach((id) => checkedIdsRef.current.delete(id));
    }
  }, []);

  // 收藏消息
  const addFavorite = useCallback(async (messageId: number, convId: number, options?: FavoriteOptions) => {
    const token = localStorage.getItem("token");
    if (!token) {
      if (!options?.silent) toast.warning("请先登录后收藏");
      return false;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ message_id: messageId, conv_id: convId }),
      });
      if (res.ok || res.status === 409) {
        setFavorites((prev) => {
          const next = new Set(prev);
          next.add(messageId);
          return next;
        });
        if (!options?.silent) toast.success("已收藏");
        return true;
      }
      if (!options?.silent) toast.error("收藏失败");
      return false;
    } catch {
      if (!options?.silent) toast.error("收藏失败");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // 取消收藏
  const removeFavorite = useCallback(async (messageId: number) => {
    const token = localStorage.getItem("token");
    if (!token) {
      toast.warning("请先登录后操作收藏");
      return false;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/favorites/${messageId}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (res.ok) {
        setFavorites((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
        setFavoriteList((prev) => prev.filter((f) => f.message_id !== messageId));
        toast.success("已取消收藏");
        return true;
      }
      toast.error("取消收藏失败");
      return false;
    } catch {
      toast.error("取消收藏失败");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // 切换收藏
  const toggleFavorite = useCallback(async (messageId: number, convId: number) => {
    if (processingRef.current.has(messageId)) return false;
    processingRef.current.add(messageId);
    try {
      if (favorites.has(messageId)) {
        return await removeFavorite(messageId);
      } else {
        return await addFavorite(messageId, convId);
      }
    } finally {
      processingRef.current.delete(messageId);
    }
  }, [favorites, addFavorite, removeFavorite]);

  // 获取收藏列表
  const fetchList = useCallback(async (page = 1, pageSize = 20, append = false, keyword?: string) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setListLoading(true);
    try {
      let url = `/api/favorites?page=${page}&page_size=${pageSize}`;
      if (keyword?.trim()) {
        url += `&q=${encodeURIComponent(keyword.trim())}`;
      }
      const res = await fetch(url, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data: FavoritesResponse = await res.json();
        setFavoriteList((prev) => append ? [...prev, ...data.items] : data.items);
        // 同步到 favorites set
        setFavorites((prev) => {
          const next = new Set(prev);
          data.items.forEach((item) => next.add(item.message_id));
          return next;
        });
        return data;
      }
    } catch {
      // ignore
    } finally {
      setListLoading(false);
    }
    return null;
  }, []);

  const isFavorited = useCallback((messageId: number) => favorites.has(messageId), [favorites]);

  return {
    favorites,
    favoriteList,
    loading,
    listLoading,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    isFavorited,
    checkBatch,
    fetchList,
  };
}
