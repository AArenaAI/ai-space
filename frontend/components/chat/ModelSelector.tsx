"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatModel } from "@/hooks/useChat";

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
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 3)));
  } catch {}
}

const COLLAPSE_KEY = "model-group-collapsed";

function loadCollapsedGroups(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function persistCollapsedGroups(groups: Set<string>) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(groups)));
  } catch {}
}

export default function ModelSelector({
  models,
  selected,
  onSelect,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [collapsedGroups, _setCollapsedGroups] = useState<Set<string>>(loadCollapsedGroups);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // 构建分组
  const groups = GROUP_ORDER.map((provider) => {
    const items = models.filter((m) => m.provider === provider);
    return items.length > 0 ? { provider, label: PROVIDER_LABELS[provider] || provider, icon: PROVIDER_ICONS[provider] || provider[0], color: PROVIDER_COLORS[provider] || "#999", items } : null;
  }).filter(Boolean) as { provider: string; label: string; icon: string; color: string; items: ChatModel[] }[];

  // 最近使用
  const recentIds = getRecentModels();
  const recentModels = recentIds
    .map((id) => models.find((m) => m.id === id))
    .filter(Boolean) as ChatModel[];

  // 高亮的模型属于哪个分组 — 自动展开该分组（但不覆盖用户手动折叠的记忆）
  const selectedProvider = selected.provider;
  useEffect(() => {
    if (!open) return;
    _setCollapsedGroups((prev) => {
      // 只在用户之前没有手动折叠这个分组时才展开
      if (prev.has(selectedProvider)) return prev;
      return prev;
    });
  }, [open, selectedProvider]);

  const handleSelect = useCallback(
    (model: ChatModel) => {
      onSelect(model);
      pushRecentModel(model.id);
      setOpen(false);
    },
    [onSelect]
  );

  const toggleGroup = (provider: string) => {
    _setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      persistCollapsedGroups(next);
      return next;
    });
  };

  const renderModelItem = (model: ChatModel) => (
    <button
      key={model.id}
      onClick={() => handleSelect(model)}
      className={cn(
        "flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors duration-150 group",
        selected.id === model.id
          ? "bg-surface-card"
          : "hover:bg-surface-card"
      )}
    >
      <div
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: model.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-sm truncate",
              selected.id === model.id ? "font-medium text-text-primary" : "text-text-secondary group-hover:text-text-primary"
            )}
          >
            {model.name}
          </span>
          {selected.id === model.id && (
            <Check className="w-3.5 h-3.5 text-brand shrink-0" />
          )}
        </div>
        <p className="text-[11px] text-text-tertiary mt-0.5 leading-snug">
          {model.description}
        </p>
      </div>
    </button>
  );

  return (
    <div className="relative max-w-[200px] sm:max-w-none" ref={dropdownRef}>
      {/* 触发按钮 — 无边框点击式 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 px-2 py-1 text-sm font-medium transition-all duration-200 w-full",
          "rounded-lg",
          open
            ? "bg-surface-card text-text-primary"
            : "bg-transparent text-text-secondary hover:bg-surface-card hover:text-text-primary"
        )}
      >
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
          style={{ backgroundColor: `${selected.color}18`, color: selected.color }}
        >
          {PROVIDER_ICONS[selected.provider] || selected.provider[0]}
        </div>
        <span className="truncate">{selected.name}</span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 shrink-0 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {/* 下拉菜单 + 蒙版 */}
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-2 w-[280px] z-50 rounded-xl border border-surface-border bg-surface-elevated shadow-xl overflow-hidden">
            <div className="px-3 py-2 text-[11px] font-medium text-text-tertiary uppercase tracking-wider border-b border-surface-border">
              选择模型
            </div>
            <div className="py-1 max-h-[320px] overflow-y-auto scrollbar-thin">
              {/* 最近使用 */}
              {recentModels.length > 0 && (
                <div className="px-1 pb-1 border-b border-surface-border">
                  <div className="px-2 py-1 text-[10px] font-medium text-text-tertiary tracking-wider flex items-center gap-1">
                    <span>⭐</span>
                    最近使用
                  </div>
                  {recentModels.map(renderModelItem)}
                </div>
              )}

              {/* 分组列表 */}
              <div className="px-1 pt-1">
                {groups.map((group) => {
                  const isCollapsed = collapsedGroups.has(group.provider);
                  return (
                    <div key={group.provider}>
                      {/* 分组标题 */}
                      <button
                        onClick={() => toggleGroup(group.provider)}
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-surface-card transition-colors text-left"
                      >
                        <div
                          className="w-1 h-4 rounded-full shrink-0"
                          style={{ backgroundColor: group.color }}
                        />
                        <span className="flex-1 text-xs font-medium text-text-tertiary tracking-wide">
                          {group.label}
                        </span>
                        <span className="text-[10px] text-text-tertiary/60 tabular-nums">
                          {group.items.length}
                        </span>
                        <ChevronDown
                          className={cn(
                            "w-3 h-3 text-text-tertiary/60 transition-transform duration-200",
                            !isCollapsed && "rotate-180"
                          )}
                        />
                      </button>
                      {/* 模型列表 */}
                      {!isCollapsed && (
                        <div className="ml-1 pl-2 border-l border-surface-border/50">
                          {group.items.map(renderModelItem)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
