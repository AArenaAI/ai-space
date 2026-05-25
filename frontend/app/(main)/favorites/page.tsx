"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Loader2, MessageSquare, Search, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FavoriteItem, useFavorites } from "@/hooks/useFavorites";
import { toast } from "sonner";

export default function FavoritesPage() {
  const { favoriteList, listLoading, fetchList, removeFavorite } = useFavorites();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPage, setTotalPage] = useState(1);
  const pageSize = 20;
  const hasMore = page < totalPage;

  const applyPageData = (data: Awaited<ReturnType<typeof fetchList>>) => {
    if (!data) return;
    setTotal(data.total);
    setTotalPage(Math.max(1, data.total_page));
    setPage(data.page);
  };

  const loadInitialFavorites = useCallback(async () => {
    applyPageData(await fetchList(1, pageSize, false));
  }, [fetchList]);

  const loadMoreFavorites = useCallback(async () => {
    if (listLoading || !hasMore) return;
    applyPageData(await fetchList(page + 1, pageSize, true));
  }, [fetchList, hasMore, listLoading, page]);

  useEffect(() => {
    loadInitialFavorites();
  }, [loadInitialFavorites]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return favoriteList;
    return favoriteList.filter((item) =>
      [item.content, item.user_query, item.conv_title, item.model_id]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(keyword))
    );
  }, [favoriteList, query]);

  const handleRemove = async (messageId: number) => {
    const ok = await removeFavorite(messageId);
    if (ok) setTotal((value) => Math.max(0, value - 1));
  };

  return (
    <div className="flex h-full flex-col bg-surface-elevated">
      <div className="flex-1 overflow-y-auto px-6 py-4 md:px-10 md:py-6">
        <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col">
          <section className="relative overflow-hidden rounded-2xl border border-surface-border bg-surface-card px-5 py-4 md:px-6 md:py-5">
            <div className="pointer-events-none absolute right-8 top-4 hidden h-28 w-28 rounded-full bg-brand/10 blur-3xl md:block" />
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-surface-border bg-surface-elevated px-3 py-1 text-xs text-text-secondary">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  高价值回答库
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-semibold tracking-tight text-text-primary md:text-3xl">我的收藏</h1>
                  <span className="rounded-full bg-brand px-3 py-1 text-sm font-medium text-white">{total}</span>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">沉淀高价值回答，随时回到原对话继续追问。</p>
              </div>

              <div className="relative w-full lg:w-[420px]">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索收藏内容"
                  className="h-12 w-full rounded-2xl border border-surface-border bg-surface px-11 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
                />
              </div>
            </div>
          </section>

          <section className="mt-6 flex flex-1 flex-col rounded-2xl border border-surface-border bg-surface-card/70 p-4 md:p-5">
            {listLoading && favoriteList.length === 0 ? (
              <div className="flex min-h-[420px] flex-1 items-center justify-center text-text-secondary">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                加载收藏中...
              </div>
            ) : favoriteList.length === 0 ? (
              <div className="flex min-h-[460px] flex-1 items-center justify-center rounded-2xl border border-dashed border-surface-border bg-surface-elevated px-8 text-center">
                <div className="max-w-lg">
                  <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-surface-card shadow-sm">
                    <Star className="h-10 w-10 text-text-tertiary/45" />
                  </div>
                  <h2 className="text-2xl font-semibold text-text-primary">还没有收藏</h2>
                  <p className="mt-3 text-sm leading-6 text-text-secondary">在对话回答右侧点击星标，就能把重要答案收进这里。后续可以搜索、复制、回到原对话继续追问。</p>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-surface-border bg-surface-elevated text-sm text-text-secondary">没有匹配的收藏内容</div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {filtered.map((item) => (
                  <FavoritePageCard key={item.id} item={item} onRemove={() => handleRemove(item.message_id)} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {favoriteList.length > 0 && (
        <div className="shrink-0 border-t border-surface-border px-6 py-4 md:px-10">
          <div className="mx-auto flex max-w-7xl items-center justify-between text-sm text-text-secondary">
            <span>已加载 {favoriteList.length} / {total} 条</span>
            <button
              type="button"
              disabled={!hasMore || listLoading}
              onClick={loadMoreFavorites}
              className="inline-flex items-center gap-2 rounded-xl border border-surface-border px-4 py-2 transition-colors hover:bg-surface-card disabled:cursor-not-allowed disabled:opacity-40"
            >
              {listLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {hasMore ? "加载更多" : "已全部加载"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FavoritePageCard({ item, onRemove }: { item: FavoriteItem; onRemove: () => void }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const content = item.content.length > 520 && !expanded ? `${item.content.slice(0, 520)}...` : item.content;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(item.content);
    toast.success("回答已复制");
  };

  return (
    <article className="flex min-h-[280px] flex-col rounded-2xl border border-surface-border bg-surface p-5 transition-colors hover:border-brand/30">
      {item.user_query && (
        <div className="mb-4 rounded-xl bg-surface-elevated px-4 py-3">
          <div className="mb-1 flex items-center gap-2 text-xs text-text-tertiary">
            <MessageSquare className="h-3.5 w-3.5" />
            原问题
          </div>
          <p className="line-clamp-2 text-sm text-text-secondary">{item.user_query}</p>
        </div>
      )}

      <div className="flex-1 whitespace-pre-wrap text-sm leading-7 text-text-primary">{content}</div>
      {item.content.length > 520 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-sm text-brand hover:underline"
        >
          {expanded ? "收起" : "展开全部"}
        </button>
      )}

      <div className="mt-5 flex flex-col gap-3 border-t border-surface-border/60 pt-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
          <span className="rounded-full bg-surface-elevated px-2 py-1 text-text-secondary">{item.model_id || "AI"}</span>
          <span>{new Date(item.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
          {item.conv_title && <span className="max-w-[260px] truncate">{item.conv_title}</span>}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-surface-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-brand/40 hover:text-brand"
          >
            <Copy className="h-4 w-4" />
            复制
          </button>
          <button
            type="button"
            onClick={() => router.push(`/chat?id=${item.conv_id}&message=${item.message_id}`, { scroll: false })}
            className="inline-flex items-center gap-1.5 rounded-xl border border-surface-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-brand/40 hover:text-brand"
          >
            <ExternalLink className="h-4 w-4" />
            回到对话
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1.5 rounded-xl border border-surface-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
            取消收藏
          </button>
        </div>
      </div>
    </article>
  );
}
