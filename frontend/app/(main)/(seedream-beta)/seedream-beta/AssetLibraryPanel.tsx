"use client";

import { Box, Image, Wand2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SemanticAsset } from "./types";

interface AssetLibraryPanelProps {
  assets: SemanticAsset[];
  onGenerateAsset?: (assetId: string) => void;
  onDeleteAsset?: (assetId: string) => void;
}

const KIND_LABELS: Record<string, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  style: "风格",
};

const KIND_COLORS: Record<string, string> = {
  character: "text-amber-600 bg-amber-50",
  scene: "text-emerald-600 bg-emerald-50",
  prop: "text-blue-600 bg-blue-50",
  style: "text-violet-600 bg-violet-50",
};

export default function AssetLibraryPanel({ assets, onGenerateAsset, onDeleteAsset }: AssetLibraryPanelProps) {
  if (assets.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <Box className="h-8 w-8 text-text-tertiary" />
        <p className="text-sm text-text-secondary">暂无资产</p>
        <p className="text-xs text-text-tertiary">在画布右键点击节点生成资产图</p>
      </div>
    );
  }

  const grouped = assets.reduce((acc, asset) => {
    const kind = asset.kind || "other";
    if (!acc[kind]) acc[kind] = [];
    acc[kind].push(asset);
    return acc;
  }, {} as Record<string, SemanticAsset[]>);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {Object.entries(grouped).map(([kind, items]) => (
        <div key={kind} className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", KIND_COLORS[kind] || "text-gray-600 bg-gray-50")}>
              {KIND_LABELS[kind] || kind}
            </span>
            <span className="text-[10px] text-text-tertiary">{items.length}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {items.map((asset) => (
              <div
                key={asset.id}
                className="group relative overflow-hidden rounded-xl border border-surface-border bg-surface-card"
              >
                {asset.imageUrl ? (
                  <div className="relative aspect-square">
                    <img src={asset.imageUrl} alt={asset.name} className="h-full w-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
                  </div>
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-surface-hover">
                    <Image className="h-6 w-6 text-text-tertiary" />
                  </div>
                )}
                <div className="p-1.5">
                  <div className="truncate text-[10px] font-medium text-text-primary">{asset.name}</div>
                  <div className="flex items-center gap-1 pt-1">
                    {!asset.imageUrl && onGenerateAsset && (
                      <button
                        type="button"
                        onClick={() => onGenerateAsset(asset.id)}
                        className="flex flex-1 items-center justify-center gap-1 rounded bg-brand/10 py-0.5 text-[10px] text-brand hover:bg-brand/20"
                      >
                        <Wand2 className="h-2.5 w-2.5" />
                        生成
                      </button>
                    )}
                    {onDeleteAsset && (
                      <button
                        type="button"
                        onClick={() => onDeleteAsset(asset.id)}
                        className="rounded p-0.5 text-text-tertiary hover:text-red-500"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
