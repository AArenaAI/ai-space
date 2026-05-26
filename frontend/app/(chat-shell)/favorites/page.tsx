"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Loader2, Search, Star, Trash2 } from "lucide-react";
import { FavoriteItem, useFavorites } from "@/hooks/useFavorites";
import MarkdownRenderer from "@/components/chat/MarkdownRenderer";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export default function FavoritesPage() {
  const { t } = useI18n();
  const { favoriteList, listLoading, fetchList, removeFavorite } = useFavorites();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPage, setTotalPage] = useState(1);
  const pageSize = 20;
  const hasMore = page < totalPage;
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyPageData = (data: Awaited<ReturnType<typeof fetchList>>) => {
    if (!data) return;
    setTotal(data.total);
    setTotalPage(Math.max(1, data.total_page));
    setPage(data.page);
  };

  const loadInitialFavorites = useCallback(async (keyword?: string) => {
    applyPageData(await fetchList(1, pageSize, false, keyword));
  }, [fetchList]);

  const loadMoreFavorites = useCallback(async () => {
    if (listLoading || !hasMore) return;
    applyPageData(await fetchList(page + 1, pageSize, true, query));
  }, [fetchList, hasMore, listLoading, page, query]);

  useEffect(() => {
    loadInitialFavorites();
  }, [loadInitialFavorites]);

  // 搜索词变化时 debounce 调用后端搜索
  const handleSearchChange = useCallback((value: string) => {
    setQuery(value);
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = setTimeout(() => {
      loadInitialFavorites(value);
    }, 400);
  }, [loadInitialFavorites]);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const handleRemove = async (messageId: number) => {
    const ok = await removeFavorite(messageId);
    if (ok) setTotal((value) => Math.max(0, value - 1));
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* 固定头部 */}
      <div className="shrink-0 px-6 md:px-10">
        <div className="mx-auto w-full max-w-7xl">
          <section className="relative overflow-hidden px-5 py-4 md:px-6 md:py-5">
            <div className="pointer-events-none absolute right-8 top-4 hidden h-28 w-28 rounded-full bg-brand/10 blur-3xl md:block" />
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-surface-border bg-surface-elevated px-3 py-1 text-xs text-text-secondary">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {t("favorites.badge")}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-semibold tracking-tight text-text-primary md:text-3xl">{t("favorites.title")}</h1>
                  <span className="rounded-full bg-brand px-3 py-1 text-sm font-medium text-white">{total}</span>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">{t("favorites.subtitle")}</p>
              </div>

              <div className="relative w-full lg:w-[420px]">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                <input
                  value={query}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder={t("favorites.searchPlaceholder")}
                  className="h-12 w-full rounded-2xl border border-surface-border bg-surface px-11 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
                />
              </div>
            </div>
          </section>
          <div className="border-b border-surface-border" />
        </div>
      </div>

      {/* 滚动列表 */}
      <div className="flex-1 overflow-y-auto px-6 pb-4 md:px-10 md:pb-6">
        <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col">
          <section className="flex flex-1 flex-col p-4 md:p-5">
            {listLoading && favoriteList.length === 0 ? (
              <div className="flex min-h-[420px] flex-1 items-center justify-center text-text-secondary">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                {t("favorites.loading")}
              </div>
            ) : favoriteList.length === 0 ? (
              <div className="flex min-h-[460px] flex-1 items-center justify-center rounded-2xl border border-dashed border-surface-border bg-surface-elevated px-8 text-center">
                <div className="max-w-lg">
                  <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-surface-card shadow-sm">
                    <Star className="h-10 w-10 text-text-tertiary/45" />
                  </div>
                  <h2 className="text-2xl font-semibold text-text-primary">
                    {query.trim() ? t("favorites.empty.search") : t("favorites.empty.noFavorites")}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-text-secondary">
                    {query.trim()
                      ? t("favorites.empty.searchHint")
                      : t("favorites.empty.hint")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {favoriteList.map((item) => (
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
            <span>{t("favorites.loaded").replace("{count}", String(favoriteList.length)).replace("{total}", String(total))}</span>
            <button
              type="button"
              disabled={!hasMore || listLoading}
              onClick={loadMoreFavorites}
              className="inline-flex items-center gap-2 rounded-xl border border-surface-border px-4 py-2 transition-colors hover:bg-surface-card disabled:cursor-not-allowed disabled:opacity-40"
            >
              {listLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {hasMore ? t("favorites.loadMore") : t("favorites.allLoaded")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function parseThinkContent(content: string): { answer: string; hasReasoning: boolean } {
  const startIdx = content.indexOf("<think>");
  if (startIdx === -1) return { answer: content.trim(), hasReasoning: false };

  const endIdx = content.indexOf("</think>", startIdx);
  if (endIdx === -1) {
    return { answer: content.slice(0, startIdx).trim(), hasReasoning: true };
  }

  return {
    answer: (content.slice(0, startIdx) + content.slice(endIdx + 8)).trim(),
    hasReasoning: true,
  };
}

function FavoritePageCard({ item, onRemove }: { item: FavoriteItem; onRemove: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const { answer, hasReasoning } = useMemo(() => parseThinkContent(item.content), [item.content]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(item.content);
    toast.success(t("favorites.toast.copied"));
  };

  return (
    <article className="flex min-h-[260px] flex-col rounded-2xl border border-surface-border bg-surface p-5 transition-all hover:border-brand/30 hover:shadow-lg">
      {item.user_query && (
        <div className="mb-4 shrink-0 border-l-2 border-surface-border pl-3">
          <div className="mb-1 text-xs text-text-tertiary">{t("favorites.card.userQuery")}</div>
          <p className="line-clamp-2 text-sm text-text-secondary">{item.user_query}</p>
        </div>
      )}

      <div className="relative shrink-0 overflow-hidden">
        {hasReasoning && (
          <div className="mb-3 inline-flex items-center rounded-full bg-surface-elevated px-2.5 py-1 text-xs text-text-tertiary">
            {t("favorites.card.hiddenReasoning")}
          </div>
        )}
        <div className="max-h-[52px] overflow-hidden">
          <div className="prose prose-sm max-w-none text-text-primary">
            <MarkdownRenderer content={answer || item.content} />
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface to-transparent" />
      </div>

      <div className="mt-auto flex flex-col gap-3 border-t border-surface-border/60 pt-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
          <span className="rounded-full bg-surface-elevated px-2 py-1 text-text-secondary">{item.model_id || "AI"}</span>
          <span>{new Date(item.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
          {item.conv_title && <span className="max-w-[260px] truncate">{item.conv_title}</span>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-surface-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-brand/40 hover:text-brand"
          >
            <Copy className="h-4 w-4" />
            {t("favorites.card.copy")}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/chat?id=${item.conv_id}&message=${item.message_id}`, { scroll: false })}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-surface-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-brand/40 hover:text-brand"
          >
            <ExternalLink className="h-4 w-4" />
            {t("favorites.card.backToChat")}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-surface-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
            {t("favorites.card.unfavorite")}
          </button>
        </div>
      </div>
    </article>
  );
}
