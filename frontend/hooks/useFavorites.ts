"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { getGuestId } from "@/lib/guestId";

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

  // 批量检查收藏状态
  const checkBatch = useCallback(async (messageIds: number[]) => {
    if (messageIds.length === 0) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const res = await fetch(`/api/favorites/check-batch?message_ids=${messageIds.join(",")}`, {
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
      // ignore
    }
  }, []);

  // 收藏消息
  const addFavorite = useCallback(async (messageId: number, convId: number) => {
    const token = localStorage.getItem("token");
    if (!token) {
      alert("请先登录");
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
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // 取消收藏
  const removeFavorite = useCallback(async (messageId: number) => {
    const token = localStorage.getItem("token");
    if (!token) return false;
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
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // 切换收藏
  const toggleFavorite = useCallback(async (messageId: number, convId: number) => {
    if (favorites.has(messageId)) {
      return removeFavorite(messageId);
    } else {
      return addFavorite(messageId, convId);
    }
  }, [favorites, addFavorite, removeFavorite]);

  // 获取收藏列表
  const fetchList = useCallback(async (page = 1, pageSize = 20) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setListLoading(true);
    try {
      const res = await fetch(`/api/favorites?page=${page}&page_size=${pageSize}`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data: FavoritesResponse = await res.json();
        setFavoriteList(data.items);
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
