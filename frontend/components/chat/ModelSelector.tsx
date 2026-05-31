"use client";

import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Check, ChevronDown, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatModel } from "@/lib/chatTypes";
import { getModelCapabilitySummary, getPrimaryModelCapabilities } from "@/lib/models/modelCapabilities";
import { ModelCapabilityBadges } from "./ModelCapabilityBadge";

interface ModelSelectorProps {
  models: ChatModel[];
  selected: ChatModel;
  onSelect: (model: ChatModel) => void;
}

// 厂商品牌色
const PROVIDER_COLORS: Record<string, string> = {
  DeepSeek: "#4d6bfa",
  OpenAI: "#10a37f",
  Anthropic: "#cc785c",
  Google: "#4285f4",
  Moonshot: "#00b96b",
};

// 厂商显示名
const PROVIDER_LABELS: Record<string, string> = {
  DeepSeek: "深度求索",
  OpenAI: "OpenAI",
  Anthropic: "Anthropic",
  Google: "Google",
  Moonshot: "月之暗面",
};

// 厂商图标 (简写字母)
const PROVIDER_ICONS: Record<string, string> = {
  DeepSeek: "D",
  OpenAI: "O",
  Anthropic: "A",
  Google: "G",
  Moonshot: "K",
};

// 分组顺序（DeepSeek 排第一，因为面向国内用户）
const GROUP_ORDER = ["DeepSeek", "OpenAI", "Anthropic", "Google", "Moonshot"];

const RECENT_KEY = "recent-models";
const FAVORITE_KEY = "favorite-models";
const RECENT_LIMIT = 5;

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
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, RECENT_LIMIT)));
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
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [hoveredProvider, setHoveredProvider] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => getFavoriteModels());
  const [recentIds, setRecentIds] = useState<string[]>(() => getRecentModels());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const modelById = useMemo(() => {
    const map = new Map<string, ChatModel>();
    models.forEach((model) => map.set(model.id, model));
    return map;
  }, [models]);

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
    return items.length > 0
      ? {
          provider,
          label: PROVIDER_LABELS[provider] || provider,
          icon: PROVIDER_ICONS[provider] || provider[0],
          color: PROVIDER_COLORS[provider] || "#999",
          items,
        }
      : null;
  }).filter(Boolean) as {
    provider: string;
    label: string;
    icon: string;
    color: string;
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
    const next = favoriteIds.includes(model.id)
      ? favoriteIds.filter((id) => id !== model.id)
      : [model.id, ...favoriteIds].slice(0, 8);
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
    const capabilities = getPrimaryModelCapabilities(model, 2);
    const favorited = favoriteIds.includes(model.id);

    return (
      <button
        key={model.id}
        onClick={() => handleSelect(model)}
        className={cn(
          "flex items-start gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors group/shortcut",
          selected.id === model.id
            ? "bg-surface-card text-text-primary"
            : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
        )}
      >
        <div
          className="mt-1.5 w-1 h-3 rounded-full shrink-0"
          style={{ backgroundColor: model.color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs truncate">{model.name}</span>
            {selected.id === model.id && <Check className="w-3 h-3 text-text-primary shrink-0" />}
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
              "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
              favorited
                ? "text-amber-400 hover:bg-amber-400/10"
                : "text-text-tertiary opacity-0 group-hover/shortcut:opacity-100 hover:bg-surface-card hover:text-amber-400"
            )}
            aria-label={favorited ? "取消收藏模型" : "收藏模型"}
            title={favorited ? "取消收藏" : "收藏模型"}
          >
            <Star className={cn("w-3 h-3", favorited && "fill-amber-400")} />
          </span>
        )}
      </button>
    );
  };

  const renderModelItem = (model: ChatModel) => {
    const capabilities = getPrimaryModelCapabilities(model, 4);
    const favorited = favoriteIds.includes(model.id);

    return (
      <button
        key={model.id}
        onClick={() => handleSelect(model)}
        className={cn(
          "flex items-start gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-colors duration-150 group",
          selected.id === model.id
            ? "bg-surface-card"
            : "hover:bg-surface-card"
        )}
      >
        <div
          className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: model.color }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-sm truncate",
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
          </div>
          <p className="text-[11px] text-text-tertiary mt-0.5 leading-snug line-clamp-2">
            {model.description || getModelCapabilitySummary(model)}
          </p>
          <ModelCapabilityBadges capabilities={capabilities} compact className="mt-1.5" />
        </div>
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => toggleFavorite(model, event)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") toggleFavorite(model, event);
          }}
          className={cn(
            "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
            favorited
              ? "text-amber-400 hover:bg-amber-400/10"
              : "text-text-tertiary opacity-0 group-hover:opacity-100 hover:bg-surface-card hover:text-amber-400"
          )}
          aria-label={favorited ? "取消收藏模型" : "收藏模型"}
          title={favorited ? "取消收藏" : "收藏模型"}
        >
          <Star className={cn("w-3.5 h-3.5", favorited && "fill-amber-400")} />
        </span>
      </button>
    );
  };

  return (
    <div className="relative max-w-[200px] sm:max-w-none" ref={dropdownRef}>
      {/* 触发按钮 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 px-2 py-1 text-sm font-medium transition-all duration-200 w-full",
          "rounded-lg",
          open
            ? "bg-surface-card text-text-primary"
            : "bg-transparent text-text-secondary hover:bg-surface-card hover:text-text-primary"
        )}
        title={getModelCapabilitySummary(selected)}
      >
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
          style={{
            backgroundColor: `${selected.color}18`,
            color: selected.color,
          }}
        >
          {PROVIDER_ICONS[selected.provider] || selected.provider[0]}
        </div>
        <span className="truncate">{selected.name}</span>
        {favoriteIds.includes(selected.id) && <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />}
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 shrink-0 transition-transform duration-200",
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
          <div className="absolute top-full left-0 mt-2 z-[90] flex rounded-xl border border-surface-border bg-surface-elevated shadow-xl overflow-hidden">
            {/* 左侧：提供商列表 */}
            <div className="w-[200px] py-2">
              <div className="px-3 py-1.5 text-[11px] font-medium text-text-tertiary uppercase tracking-wider border-b border-surface-border mb-1">
                选择模型
              </div>

              {/* 收藏模型 */}
              {favoriteModels.length > 0 && (
                <div className="px-1 pb-1 border-b border-surface-border mb-1">
                  <div className="px-2 py-1 text-[10px] font-medium text-text-tertiary tracking-wider flex items-center gap-1">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />收藏模型
                  </div>
                  {favoriteModels.map((m) => renderShortcutModelItem(m, { showFavorite: true }))}
                </div>
              )}

              {/* 最近使用 */}
              {recentModels.length > 0 && (
                <div className="px-1 pb-1 border-b border-surface-border mb-1">
                  <div className="px-2 py-1 text-[10px] font-medium text-text-tertiary tracking-wider flex items-center gap-1">
                    <span>🕘</span>最近使用
                  </div>
                  {recentModels.slice(0, RECENT_LIMIT).map((m) => renderShortcutModelItem(m))}
                </div>
              )}

              {/* 厂商分组列表 */}
              <div className="px-1">
                {groups.map((group) => (
                  <div
                    key={group.provider}
                    onMouseEnter={() => handleProviderEnter(group.provider)}
                    onMouseLeave={handleProviderLeave}
                    className={cn(
                      "flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors",
                      hoveredProvider === group.provider
                        ? "bg-surface-card text-text-primary"
                        : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                    )}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                      style={{
                        backgroundColor: `${group.color}18`,
                        color: group.color,
                      }}
                    >
                      {group.icon}
                    </div>
                    <span className="flex-1 text-xs font-medium truncate">
                      {group.label}
                    </span>
                    <span className="text-[10px] text-text-tertiary/60 tabular-nums">
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
                className="w-[260px] border-l border-surface-border py-2"
                onMouseEnter={handlePopoverEnter}
                onMouseLeave={handlePopoverLeave}
              >
                <div className="px-3 py-1.5 text-[11px] font-medium text-text-tertiary uppercase tracking-wider border-b border-surface-border mb-1 flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
                    style={{
                      backgroundColor: `${activeGroup.color}18`,
                      color: activeGroup.color,
                    }}
                  >
                    {activeGroup.icon}
                  </div>
                  {activeGroup.label}
                  <span className="text-[10px] text-text-tertiary/60 tabular-nums ml-auto normal-case">
                    {activeGroup.items.length} 个模型
                  </span>
                </div>
                <div className="px-1 max-h-[320px] overflow-y-auto scrollbar-thin">
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
