"use client";

import { cn } from "@/lib/utils";
import { Sparkles, LayoutGrid, Film, Grid3X3 } from "lucide-react";

interface SeedreamHeaderProps {
  projectName: string;
  activeTab: string;
  onTabChange: (tab: "assets" | "workflow" | "image" | "video") => void;
  onStoryboardClick: () => void;
}

export function SeedreamHeader({
  projectName,
  activeTab,
  onTabChange,
  onStoryboardClick,
}: SeedreamHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-surface-border bg-surface-elevated px-4 py-2.5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">漫剧 Studio</h1>
          <p className="truncate text-xs text-text-tertiary">当前项目：{projectName}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onTabChange("assets")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            activeTab === "assets"
              ? "bg-brand/10 text-brand"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          资产库
        </button>
        <button
          onClick={() => onTabChange("workflow")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            activeTab === "workflow"
              ? "bg-brand/10 text-brand"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          <Film className="h-3.5 w-3.5" />
          工作台
        </button>
        <button
          onClick={onStoryboardClick}
          className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-card px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-brand/40 hover:text-text-primary"
        >
          <Grid3X3 className="h-3.5 w-3.5" />
          故事板
        </button>
      </div>
    </header>
  );
}
