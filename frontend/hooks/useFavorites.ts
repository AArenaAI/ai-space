"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { apiFetch } from "@/lib/api/client";
import { readAuthState } from "@/lib/auth/state";
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
  block_id?: string;
  matched_block_id?: string;
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

export function useFavorites() {
  const { t } = useI18n();
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
    if (!readAuthState().user) return;
    ids.forEach((id) => checkedIdsRef.current.add(id));
    try {
      const res = await apiFetch(`/favorites/check-batch?message_ids=${ids.join(",")}`);
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
    if (!readAuthState().user) {
      if (!options?.silent) toast.warning(t("chat.toast.favoriteLoginRequired"));
      return false;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/favorites", {
        method: "POST",
        body: JSON.stringify({ message_id: messageId, conv_id: convId }),
      });
      if (res.ok || res.status === 409) {
        setFavorites((prev) => {
          const next = new Set(prev);
          next.add(messageId);
          return next;
        });
        if (!options?.silent) toast.success(t("chat.toast.favorited"));
        return true;
      }
      if (!options?.silent) toast.error(t("chat.toast.favoriteFailed"));
      return false;
    } catch {
      if (!options?.silent) toast.error(t("chat.toast.favoriteFailed"));
      return false;
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 取消收藏
  const removeFavorite = useCallback(async (messageId: number) => {
    if (!readAuthState().user) {
      toast.warning(t("chat.toast.favoriteLoginRequired"));
      return false;
    }
    setLoading(true);
    try {
      const res = await apiFetch(`/favorites/${messageId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setFavorites((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
        setFavoriteList((prev) => prev.filter((f) => f.message_id !== messageId));
        toast.success(t("chat.toast.unfavorited"));
        return true;
      }
      toast.error(t("chat.toast.unfavoriteFailed"));
      return false;
    } catch {
      toast.error(t("chat.toast.unfavoriteFailed"));
      return false;
    } finally {
      setLoading(false);
    }
  }, [t]);

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
    if (!readAuthState().user) return;
    setListLoading(true);
    try {
      let url = `/favorites?page=${page}&page_size=${pageSize}`;
      if (keyword?.trim()) {
        url += `&q=${encodeURIComponent(keyword.trim())}`;
      }
      const res = await apiFetch(url);
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
