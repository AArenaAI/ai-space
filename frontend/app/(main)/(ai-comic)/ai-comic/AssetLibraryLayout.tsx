"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  Film,
  ImageIcon,
  Box,
  Users,
  TreePine,
  Wand2,
  ChevronRight,
  Search,
  Filter,
  Grid3X3,
  List,
  Clock,
  Type,
  Sparkles,
} from "lucide-react";
import type { SemanticAsset, StoredAsset } from "./types";

export type AssetLibraryLayoutProps = {
  semanticAssets: SemanticAsset[];
  storedAssets: StoredAsset[];
  selectedAssetIds: string[];
  onSelectAsset: (id: string) => void;
  onGenerateAssetImage: (asset: SemanticAsset) => void;
  onSearch: (query: string) => void;
  onFilterByKind: (kind: string | null) => void;
  activeKind: string | null;
};

export default function AssetLibraryLayout({
  semanticAssets,
  storedAssets,
  selectedAssetIds,
  onSelectAsset,
  onGenerateAssetImage,
  onSearch,
  onFilterByKind,
  activeKind,
}: AssetLibraryLayoutProps) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");

  const kinds = [
    { id: "character", label: "角色", icon: Users, color: "text-blue-500" },
    { id: "scene", label: "场景", icon: TreePine, color: "text-green-500" },
    { id: "prop", label: "道具", icon: Box, color: "text-amber-500" },
    { id: "style", label: "风格", icon: Sparkles, color: "text-purple-500" },
  ];

  const filteredAssets = semanticAssets.filter((asset) => {
    if (activeKind && asset.kind !== activeKind) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        asset.name.toLowerCase().includes(q) ||
        asset.summary?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-brand" />
          <span className="text-sm font-semibold text-text-primary">
            资产库
          </span>
          <span className="text-xs text-text-tertiary">
            ({filteredAssets.length} / {semanticAssets.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 搜索 */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              placeholder="搜索资产..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                onSearch(e.target.value);
              }}
              className="h-8 w-48 rounded-lg border border-surface-border bg-surface-card pl-7 pr-3 text-xs text-text-primary placeholder:text-text-tertiary focus:border-brand focus:outline-none"
            />
          </div>
          {/* 视图切换 */}
          <div className="flex rounded-lg border border-surface-border bg-surface-card p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "rounded p-1.5",
                viewMode === "grid"
                  ? "bg-brand/10 text-brand"
                  : "text-text-tertiary hover:text-text-secondary"
              )}
            >
              <Grid3X3 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "rounded p-1.5",
                viewMode === "list"
                  ? "bg-brand/10 text-brand"
                  : "text-text-tertiary hover:text-text-secondary"
              )}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧分类导航 */}
        <div className="w-48 border-r border-surface-border bg-surface-elevated/50 p-3">
          <div className="mb-3 text-xs font-medium text-text-tertiary">
            分类
          </div>
          <div className="space-y-1">
            <button
              onClick={() => onFilterByKind(null)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors",
                !activeKind
                  ? "bg-brand/10 text-brand"
                  : "text-text-secondary hover:bg-surface-card"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              全部
              <span className="ml-auto text-[10px] text-text-tertiary">
                {semanticAssets.length}
              </span>
            </button>
            {kinds.map((kind) => {
              const count = semanticAssets.filter(
                (a) => a.kind === kind.id
              ).length;
              return (
                <button
                  key={kind.id}
                  onClick={() => onFilterByKind(kind.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors",
                    activeKind === kind.id
                      ? "bg-brand/10 text-brand"
                      : "text-text-secondary hover:bg-surface-card"
                  )}
                >
                  <kind.icon className={cn("h-3.5 w-3.5", kind.color)} />
                  {kind.label}
                  <span className="ml-auto text-[10px] text-text-tertiary">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 资产网格/列表 */}
        <div className="flex-1 overflow-y-auto p-4">
          {viewMode === "grid" ? (
            <div className="grid grid-cols-3 gap-3">
              {filteredAssets.map((asset) => {
                const stored = storedAssets.find((s) => asset.linkedAssetIds.includes(s.id));
                const storedUrl = stored?.url || "";
                const isSelected = selectedAssetIds.includes(asset.id);
                const hasImage = Boolean(storedUrl);

                return (
                  <div
                    key={asset.id}
                    onClick={() => onSelectAsset(asset.id)}
                    className={cn(
                      "group cursor-pointer rounded-xl border p-3 transition-all",
                      isSelected
                        ? "border-brand bg-brand/5"
                        : "border-surface-border bg-surface-card hover:border-brand/30"
                    )}
                  >
                    {/* 缩略图 */}
                    <div className="relative mb-2 aspect-square overflow-hidden rounded-lg bg-surface-elevated">
                      {hasImage ? (
                        <img
                          src={storedUrl}
                          alt={asset.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          {asset.kind === "character" && (
                            <Users className="h-8 w-8 text-blue-300" />
                          )}
                          {asset.kind === "scene" && (
                            <TreePine className="h-8 w-8 text-green-300" />
                          )}
                          {asset.kind === "prop" && (
                            <Box className="h-8 w-8 text-amber-300" />
                          )}
                          {asset.kind === "style" && (
                            <Sparkles className="h-8 w-8 text-purple-300" />
                          )}
                        </div>
                      )}
                      {/* 悬停生成按钮 */}
                      {!hasImage && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onGenerateAssetImage(asset);
                            }}
                            className="flex items-center gap-1 rounded bg-brand px-2 py-1 text-xs text-white"
                          >
                            <Wand2 className="h-3 w-3" />
                            生成
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 信息 */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded px-1 py-0.5 text-[10px] font-medium",
                            asset.kind === "character" &&
                              "bg-blue-100 text-blue-700",
                            asset.kind === "scene" &&
                              "bg-green-100 text-green-700",
                            asset.kind === "prop" &&
                              "bg-amber-100 text-amber-700",
                            asset.kind === "style" &&
                              "bg-purple-100 text-purple-700"
                          )}
                        >
                          {asset.kind}
                        </span>
                        <span className="truncate text-xs font-medium text-text-primary">
                          {asset.name}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-[10px] text-text-tertiary">
                        {asset.summary}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredAssets.map((asset) => {
                const stored = storedAssets.find((s) => asset.linkedAssetIds.includes(s.id));
                const storedUrl = stored?.url || "";
                const isSelected = selectedAssetIds.includes(asset.id);
                const hasImage = Boolean(storedUrl);

                return (
                  <div
                    key={asset.id}
                    onClick={() => onSelectAsset(asset.id)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-2 transition-all",
                      isSelected
                        ? "border-brand bg-brand/5"
                        : "border-surface-border bg-surface-card hover:border-brand/30"
                    )}
                  >
                    {hasImage ? (
                      <img
                        src={storedUrl}
                        alt=""
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded bg-surface-elevated">
                        {asset.kind === "character" && (
                          <Users className="h-5 w-5 text-blue-300" />
                        )}
                        {asset.kind === "scene" && (
                          <TreePine className="h-5 w-5 text-green-300" />
                        )}
                        {asset.kind === "prop" && (
                          <Box className="h-5 w-5 text-amber-300" />
                        )}
                        {asset.kind === "style" && (
                          <Sparkles className="h-5 w-5 text-purple-300" />
                        )}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-text-primary">
                          {asset.name}
                        </span>
                        <span
                          className={cn(
                            "rounded px-1 py-0.5 text-[9px]",
                            asset.kind === "character" &&
                              "bg-blue-100 text-blue-700",
                            asset.kind === "scene" &&
                              "bg-green-100 text-green-700",
                            asset.kind === "prop" &&
                              "bg-amber-100 text-amber-700",
                            asset.kind === "style" &&
                              "bg-purple-100 text-purple-700"
                          )}
                        >
                          {asset.kind}
                        </span>
                      </div>
                      <p className="truncate text-[10px] text-text-tertiary">
                        {asset.summary}
                      </p>
                    </div>
                    {!hasImage && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onGenerateAssetImage(asset);
                        }}
                        className="rounded bg-brand/10 px-2 py-1 text-xs text-brand hover:bg-brand/20"
                      >
                        生成
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
