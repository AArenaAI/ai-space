"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Star, X, MessageSquare, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFavorites, FavoriteItem } from "@/hooks/useFavorites";
import { useI18n } from "@/lib/i18n";
import { buildChatTargetHref } from "@/lib/chatTargetHref";

interface FavoriteListProps {
  open: boolean;
  onClose: () => void;
}

export default function FavoriteList({ open, onClose }: FavoriteListProps) {
  const { t } = useI18n();
  const { favoriteList, listLoading, fetchList, removeFavorite } = useFavorites();
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (open) {
      fetchList(page, 20);
    }
  }, [open, page, fetchList]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
            <h2 className="text-lg font-semibold text-text-primary">{t("favorites.title")}</h2>
            <span className="text-xs text-text-tertiary bg-surface-card px-2 py-0.5 rounded-full">
              {favoriteList.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {listLoading && favoriteList.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-surface-border border-t-brand rounded-full animate-spin" />
            </div>
          ) : favoriteList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Star className="w-10 h-10 text-text-tertiary/30 mb-3" />
              <p className="text-sm text-text-secondary">{t("favorites.empty.title")}</p>
              <p className="text-xs text-text-tertiary mt-1">{t("favorites.empty.desc")}</p>
            </div>
          ) : (
            favoriteList.map((item) => (
              <FavoriteCard
                key={item.id}
                item={item}
                onRemove={() => removeFavorite(item.message_id)}
              />
            ))
          )}
        </div>

        {/* Footer - pagination placeholder */}
        {favoriteList.length > 0 && (
          <div className="px-6 py-3 border-t border-surface-border flex items-center justify-between">
            <span className="text-xs text-text-tertiary">{t("favorites.count", { count: String(favoriteList.length) })}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function FavoriteCard({ item, onRemove }: { item: FavoriteItem; onRemove: () => void }) {
  const { t, language } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();

  const contentPreview = item.content.length > 200 && !expanded
    ? item.content.slice(0, 200) + "..."
    : item.content;

  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-4 transition-all hover:border-surface-border/80">
      {/* Query */}
      {item.user_query && (
        <div className="mb-3 border-l-2 border-surface-border pl-3">
          <div className="mb-1 text-xs text-text-tertiary">{t("favorites.quotedUserInput")}</div>
          <p className="line-clamp-2 text-sm text-text-secondary">{item.user_query}</p>
        </div>
      )}

      {/* Content */}
      <div className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
        {contentPreview}
      </div>

      {item.content.length > 200 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-brand mt-1 hover:underline"
        >
          {expanded ? t("favorites.collapse") : t("favorites.expand")}
        </button>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-border/40">
        <div className="flex items-center gap-3 text-xs text-text-tertiary">
          <span>{item.model_id}</span>
          <span>{new Date(item.created_at).toLocaleDateString(language)}</span>
          {item.conv_title && <span className="max-w-[120px] truncate">{item.conv_title}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => router.push(buildChatTargetHref({ conversationId: item.conv_id, messageId: item.message_id, blockId: item.block_id || item.matched_block_id }), { scroll: false })}
            className="p-1.5 rounded-md text-text-tertiary hover:text-brand hover:bg-brand/10 transition-colors"
            title={t("favorites.backToConversation")}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRemove}
            className="p-1.5 rounded-md text-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title={t("chat.action.unfavorite")}
          >
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
