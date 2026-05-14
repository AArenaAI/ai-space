"use client";

import { useState } from "react";
import { useCredits, getModelTier, getTierName, getTierIcon, getTierColor, CreditsData } from "@/hooks/useCredits";
import CreditTooltip from "./CreditTooltip";
import { Zap } from "lucide-react";

interface CreditBarProps {
  selectedModelId: string;
}

export default function CreditBar({ selectedModelId }: CreditBarProps) {
  const { credits, loading } = useCredits();
  const [tooltipOpen, setTooltipOpen] = useState(false);

  const tier = getModelTier(selectedModelId);
  const tierName = getTierName(tier);
  const tierIcon = getTierIcon(tier);
  const tierColor = getTierColor(tier);

  const tierValue = credits
    ? tier === "basic"
      ? credits.basic_credits
      : tier === "advanced"
      ? credits.advanced_credits
      : credits.elite_credits
    : 0;

  const quota = credits?.daily_quota?.[tier] ?? 0;
  const isUnlimited = quota < 0;
  const isLow = !isUnlimited && quota > 0 && tierValue / quota < 0.2;

  const handleUpgrade = () => {
    window.open("/pricing", "_blank");
  };

  return (
    <div
      className="relative flex items-center justify-between px-4 py-1.5 border-t border-surface-border/60 bg-surface/80 backdrop-blur-sm"
      onMouseEnter={() => setTooltipOpen(true)}
      onMouseLeave={() => setTooltipOpen(false)}
    >
      {/* 左侧：当前模型等级提示 */}
      <div className="flex items-center gap-2">
        <span
          className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border"
          style={{
            color: tierColor,
            borderColor: `${tierColor}30`,
            backgroundColor: `${tierColor}10`,
          }}
        >
          <span>{tierIcon}</span>
          <span>
            {tierName}模型</span>
          <span className="opacity-60">|</span>
          <span className="font-mono tabular-nums">
            {isUnlimited ? "∞" : tierValue}
            {!isUnlimited && <span className="opacity-50">/{quota}</span>}
          </span>
        </span>
          {/* 【积分限制已临时取消】积分不足提示已禁用 */}
          {/*
          {isLow && (
            <span className="text-[10px] text-red-400 font-medium animate-pulse shrink-0">
              积分不足
            </span>
          )}
          */}
      </div>

      {/* 右侧：全部积分摘要 */}
      <div className="flex items-center gap-3">
        {credits && (
          <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
            <span className="flex items-center gap-0.5">
              <span className="text-amber-400">☕</span>
              <span className="font-mono tabular-nums">{credits.basic_credits}</span>
            </span>
            <span className="flex items-center gap-0.5">
              <span className="text-orange-400">🔥</span>
              <span className="font-mono tabular-nums">{credits.advanced_credits}</span>
            </span>
            <span className="flex items-center gap-0.5">
              <span className="text-purple-400">⭐</span>
              <span className="font-mono tabular-nums">{credits.elite_credits}</span>
            </span>
          </div>
        )}

        <button
          onClick={handleUpgrade}
          className="flex items-center gap-1 text-[11px] font-medium text-amber-400 hover:text-amber-300 transition-colors"
        >
          <Zap className="w-3 h-3" />
          <span>升级</span>
        </button>
      </div>

      {/* 悬浮面板 */}
      {tooltipOpen && (
        <CreditTooltip credits={credits} onUpgrade={handleUpgrade} />
      )}
    </div>
  );
}
