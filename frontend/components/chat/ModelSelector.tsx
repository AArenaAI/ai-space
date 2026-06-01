"use client";

import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Check, ChevronDown, Star } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ChatModel } from "@/lib/chatTypes";
import { getModelAvatarMeta, type ModelAvatarMeta } from "@/lib/models/modelAvatars";
import { getModelCapabilitySummary, getPrimaryModelCapabilities } from "@/lib/models/modelCapabilities";
import { getModelRecommendation, getRecommendedModels, isModelRecommended, type ModelRecommendationContext } from "@/lib/models/modelRecommendations";
import { getModelStatusBadge, getModelStatusLabel, isModelAvailable } from "@/lib/models/modelAvailability";
import { ModelCapabilityBadges } from "./ModelCapabilityBadge";

interface ModelSelectorProps {
  models: ChatModel[];
  selected: ChatModel;
  onSelect: (model: ChatModel) => void;
  recommendationContext?: ModelRecommendationContext;
}

// 分组顺序（DeepSeek 排第一，因为面向国内用户）
const GROUP_ORDER = ["DeepSeek", "OpenAI", "Anthropic", "Google", "Moonshot"];

const RECENT_KEY = "recent-models";
const FAVORITE_KEY = "favorite-models";
const SHORTCUT_LIMIT = 3;

function ModelAvatar({ meta, size = "md" }: { meta: ModelAvatarMeta; size?: "sm" | "md" | "lg" }) {
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold",
        size === "sm" && "h-5 w-5 text-[9px]",
        size === "md" && "h-6 w-6 text-[10px]",
        size === "lg" && "h-7 w-7 text-[11px]"
      )}
      style={{ backgroundColor: meta.background, color: meta.color }}
      title={meta.label}
    >
      {Icon ? <Icon className="h-[74%] w-[74%]" /> : meta.fallback}
    </span>
  );
}

function getRecentModels(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function pushRecentModel(modelId: string) {
  try {
    let recent = getRecentModels().filter((id) => id !== modelId);
    recent.unshift(modelId);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, SHORTCUT_LIMIT)));
  } catch {}
}

function getFavoriteModels(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FAVORITE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setFavoriteModels(modelIds: string[]) {
  try {
    localStorage.setItem(FAVORITE_KEY, JSON.stringify(modelIds));
  } catch {}
}

export default function ModelSelector({
  models,
  selected,
  onSelect,
  recommendationContext,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [hoveredProvider, setHoveredProvider] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => getFavoriteModels().slice(0, SHORTCUT_LIMIT));
  const [recentIds, setRecentIds] = useState<string[]>(() => getRecentModels().slice(0, SHORTCUT_LIMIT));
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const modelById = useMemo(() => {
    const map = new Map<string, ChatModel>();
    models.forEach((model) => map.set(model.id, model));
    return map;
  }, [models]);

  const recommendation = useMemo(
    () => getModelRecommendation(recommendationContext),
    [recommendationContext]
  );
  const recommendedModels = useMemo(
    () => getRecommendedModels(models, recommendation, 2),
    [models, recommendation]
  );
  const selectedMatchesRecommendation = isModelRecommended(selected, recommendation);
  const selectedAvailable = isModelAvailable(selected);
  const selectedStatusLabel = getModelStatusLabel(selected);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
        setHoveredProvider(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // 构建分组：保留既有厂商顺序，同时兼容后端新增 provider。
  const providerOrder = [
    ...GROUP_ORDER,
    ...Array.from(new Set(models.map((model) => model.provider))).filter((provider) => !GROUP_ORDER.includes(provider)),
  ];
  const groups = providerOrder.map((provider) => {
    const items = models.filter((m) => m.provider === provider);
    const avatar = getModelAvatarMeta(items[0] || provider);
    return items.length > 0
      ? {
          provider,
          label: avatar.label || provider,
          avatar,
          items,
        }
      : null;
  }).filter(Boolean) as {
    provider: string;
    label: string;
    avatar: ModelAvatarMeta;
    items: ChatModel[];
  }[];

  // 收藏 / 最近使用
  const favoriteModels = favoriteIds
    .map((id) => modelById.get(id))
    .filter(Boolean) as ChatModel[];
  const recentModels = recentIds
    .filter((id) => !favoriteIds.includes(id))
    .map((id) => modelById.get(id))
    .filter(Boolean) as ChatModel[];

  const handleSelect = useCallback(
    (model: ChatModel) => {
      if (!isModelAvailable(model)) return;
      onSelect(model);
      pushRecentModel(model.id);
      setRecentIds(getRecentModels());
      setOpen(false);
      setHoveredProvider(null);
    },
    [onSelect]
  );

  const toggleFavorite = useCallback((model: ChatModel, event: ReactMouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!favoriteIds.includes(model.id) && favoriteIds.length >= SHORTCUT_LIMIT) {
      toast.info("最多收藏 3 个模型，请先取消一个收藏。", {
        position: "top-center",
        duration: 3000,
        id: "model-favorite-limit",
      });
      return;
    }
    const next = favoriteIds.includes(model.id)
      ? favoriteIds.filter((id) => id !== model.id)
      : [model.id, ...favoriteIds].slice(0, SHORTCUT_LIMIT);
    setFavoriteIds(next);
    setFavoriteModels(next);
  }, [favoriteIds]);

  const handleProviderEnter = (provider: string) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoveredProvider(provider);
  };

  const handleProviderLeave = () => {
    hoverTimerRef.current = setTimeout(() => {
      setHoveredProvider(null);
    }, 150);
  };

  const handlePopoverEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  };

  const handlePopoverLeave = () => {
    hoverTimerRef.current = setTimeout(() => {
      setHoveredProvider(null);
    }, 150);
  };

  const activeGroup = groups.find((g) => g.provider === hoveredProvider);

  const renderShortcutModelItem = (model: ChatModel, options?: { showFavorite?: boolean }) => {
    const capabilities = getPrimaryModelCapabilities(model, 4);
    const favorited = favoriteIds.includes(model.id);
    const available = isModelAvailable(model);
    const statusBadge = getModelStatusBadge(model);
    const avatar = getModelAvatarMeta(model);

    return (
      <button
        key={model.id}
        onClick={() => handleSelect(model)}
        disabled={!available}
        className={cn(
          "flex items-start gap-2.5 w-full px-3 py-2 rounded-lg text-left transition-colors group/shortcut",
          !available && "cursor-not-allowed opacity-55",
          selected.id === model.id
            ? "bg-surface-card text-text-primary"
            : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
        )}
        title={statusBadge || getModelCapabilitySummary(model)}
      >
        <div className="mt-0.5">
          <ModelAvatar meta={avatar} size="md" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-medium truncate">{model.name}</span>
            {selected.id === model.id && <Check className="w-3.5 h-3.5 text-text-primary shrink-0" />}
            {statusBadge && <span className="text-[10px] text-rose-500 shrink-0">{statusBadge}</span>}
          </div>
          <ModelCapabilityBadges capabilities={capabilities} compact className="mt-1" />
        </div>
        {options?.showFavorite && (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => toggleFavorite(model, event)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") toggleFavorite(model, event);
            }}
            className={cn(
              "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
              favorited
                ? "text-amber-400 hover:bg-amber-400/10"
                : "text-text-tertiary opacity-0 group-hover/shortcut:opacity-100 hover:bg-surface-card hover:text-amber-400"
            )}
            aria-label={favorited ? "取消收藏模型" : "收藏模型"}
            title={favorited ? "取消收藏" : "收藏模型"}
          >
            <Star className={cn("w-4 h-4", favorited && "fill-amber-400")} />
          </span>
        )}
      </button>
    );
  };

  const renderModelItem = (model: ChatModel) => {
    const capabilities = getPrimaryModelCapabilities(model, 4);
    const favorited = favoriteIds.includes(model.id);
    const available = isModelAvailable(model);
    const statusBadge = getModelStatusBadge(model);
    const avatar = getModelAvatarMeta(model);

    return (
      <button
        key={model.id}
        onClick={() => handleSelect(model)}
        disabled={!available}
        className={cn(
          "flex items-start gap-3.5 w-full px-4 py-3.5 rounded-xl text-left transition-colors duration-150 group",
          !available && "cursor-not-allowed opacity-55",
          selected.id === model.id
            ? "bg-surface-card"
            : "hover:bg-surface-card"
        )}
        title={statusBadge || getModelCapabilitySummary(model)}
      >
        <div className="mt-1">
          <ModelAvatar meta={avatar} size="lg" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-[15px] truncate",
                selected.id === model.id
                  ? "font-medium text-text-primary"
                  : "text-text-secondary group-hover:text-text-primary"
              )}
            >
              {model.name}
            </span>
            {selected.id === model.id && (
              <Check className="w-3.5 h-3.5 text-text-primary shrink-0" />
            )}
            {statusBadge && (
              <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-500 shrink-0">
                {statusBadge}
              </span>
            )}
          </div>
          <p className="text-xs text-text-tertiary mt-1 leading-relaxed line-clamp-2">
            {statusBadge || model.description || getModelCapabilitySummary(model)}
          </p>
          <ModelCapabilityBadges capabilities={capabilities} compact className="mt-2" />
        </div>
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => toggleFavorite(model, event)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") toggleFavorite(model, event);
          }}
          className={cn(
            "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
            favorited
              ? "text-amber-400 hover:bg-amber-400/10"
              : "text-text-tertiary opacity-0 group-hover:opacity-100 hover:bg-surface-card hover:text-amber-400"
          )}
          aria-label={favorited ? "取消收藏模型" : "收藏模型"}
          title={favorited ? "取消收藏" : "收藏模型"}
        >
          <Star className={cn("w-4 h-4", favorited && "fill-amber-400")} />
        </span>
      </button>
    );
  };

  return (
    <div className="relative max-w-[240px] sm:max-w-none" ref={dropdownRef}>
      {/* 触发按钮 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2.5 px-2.5 py-1.5 text-[15px] font-medium transition-all duration-200 w-full",
          "rounded-lg",
          !selectedAvailable && "text-rose-500",
          open
            ? "bg-surface-card text-text-primary"
            : "bg-transparent text-text-secondary hover:bg-surface-card hover:text-text-primary"
        )}
        title={selectedAvailable ? getModelCapabilitySummary(selected) : selectedStatusLabel}
      >
        <ModelAvatar meta={getModelAvatarMeta(selected)} size="md" />
        <span className="truncate">{selected.name}</span>
        {!selectedAvailable && (
          <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-500 shrink-0">
            {selectedStatusLabel}
          </span>
        )}
        {favoriteIds.includes(selected.id) && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 shrink-0" />}
        <ChevronDown
          className={cn(
            "w-4 h-4 shrink-0 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {/* 下拉面板 + 蒙版 */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-[80] bg-black/20 backdrop-blur-[2px]"
            onClick={() => {
              setOpen(false);
              setHoveredProvider(null);
            }}
          />
          <div className="absolute top-full left-0 mt-2 z-[90] flex rounded-2xl border border-surface-border bg-surface-elevated shadow-xl overflow-hidden">
            {/* 左侧：提供商列表 */}
            <div className="w-[260px] py-3">
              <div className="px-4 py-2 text-xs font-medium text-text-tertiary uppercase tracking-wider border-b border-surface-border mb-1.5">
                选择模型
              </div>

              {recommendation && (
                <div className="mx-2 mb-2 rounded-xl border border-amber-500/15 bg-amber-500/5 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-amber-600 dark:text-amber-400">
                    <span>✨</span>
                    <span>{recommendation.title}</span>
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-text-secondary">
                    {selectedMatchesRecommendation ? "当前模型适合这个任务。" : recommendation.message}
                  </p>
                  {!selectedMatchesRecommendation && recommendedModels.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {recommendedModels.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => handleSelect(model)}
                          className="rounded-full border border-amber-500/20 bg-surface-card px-2.5 py-1 text-[11px] font-medium text-text-primary transition-colors hover:border-amber-500/40 hover:bg-amber-500/10"
                          title={recommendation.reason}
                        >
                          {model.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 收藏模型 */}
              {favoriteModels.length > 0 && (
                <div className="px-2 pb-2 border-b border-surface-border mb-1.5">
                  <div className="px-2 py-1.5 text-[11px] font-medium text-text-tertiary tracking-wider flex items-center gap-1.5">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />收藏模型
                  </div>
                  {favoriteModels.map((m) => renderShortcutModelItem(m, { showFavorite: true }))}
                </div>
              )}

              {/* 最近使用 */}
              {recentModels.length > 0 && (
                <div className="px-2 pb-2 border-b border-surface-border mb-1.5">
                  <div className="px-2 py-1.5 text-[11px] font-medium text-text-tertiary tracking-wider flex items-center gap-1.5">
                    <span>🕘</span>最近使用
                  </div>
                  {recentModels.slice(0, SHORTCUT_LIMIT).map((m) => renderShortcutModelItem(m, { showFavorite: true }))}
                </div>
              )}

              {/* 厂商分组列表 */}
              <div className="px-2">
                {groups.map((group) => (
                  <div
                    key={group.provider}
                    onMouseEnter={() => handleProviderEnter(group.provider)}
                    onMouseLeave={handleProviderLeave}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors",
                      hoveredProvider === group.provider
                        ? "bg-surface-card text-text-primary"
                        : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                    )}
                  >
                    <ModelAvatar meta={group.avatar} size="lg" />
                    <span className="flex-1 text-sm font-medium truncate">
                      {group.label}
                    </span>
                    <span className="text-xs text-text-tertiary/60 tabular-nums">
                      {group.items.length}
                    </span>
                    <ChevronDown className="w-3 h-3 text-text-tertiary/60 -rotate-90 shrink-0" />
                  </div>
                ))}
              </div>
            </div>

            {/* 右侧：悬浮模型列表 */}
            {activeGroup && (
              <div
                className="w-[420px] border-l border-surface-border py-3"
                onMouseEnter={handlePopoverEnter}
                onMouseLeave={handlePopoverLeave}
              >
                <div className="px-4 py-2 text-xs font-medium text-text-tertiary uppercase tracking-wider border-b border-surface-border mb-1.5 flex items-center gap-2.5">
                  <ModelAvatar meta={activeGroup.avatar} size="sm" />
                  {activeGroup.label}
                  <span className="text-xs text-text-tertiary/60 tabular-nums ml-auto normal-case">
                    {activeGroup.items.length} 个模型
                  </span>
                </div>
                <div className="px-2 max-h-[440px] overflow-y-auto scrollbar-thin">
                  {activeGroup.items.map(renderModelItem)}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

