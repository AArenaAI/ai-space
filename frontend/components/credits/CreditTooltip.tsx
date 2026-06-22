"use client";

import { CreditsData } from "@/hooks/useCredits";

interface CreditTooltipProps {
  credits: CreditsData | null;
  onUpgrade?: () => void;
}

export default function CreditTooltip({ credits, onUpgrade }: CreditTooltipProps) {
  if (!credits) return null;

  const tiers = [
    { key: "basic", label: "基础", icon: "☕", color: "#fbbf24", bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400" },
    { key: "advanced", label: "高级", icon: "🔥", color: "#fb923c", bg: "bg-orange-500/10", border: "border-orange-500/20", text: "text-orange-400" },
  ];

  const displayCredits = (displayValue?: number, rawValue?: number) =>
    (displayValue ?? (rawValue ?? 0) / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 });

  const planNames: Record<string, string> = {
    free: "免费版",
    basic: "Basic",
    plus: "Plus",
    ultra: "Ultra",
  };

  return (
    <div className="absolute bottom-full left-0 mb-2 w-[260px] rounded-xl border border-surface-border bg-surface-elevated shadow-2xl overflow-hidden z-50">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-surface-border">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary">积分余额</span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-card border border-surface-border text-text-secondary">
            {planNames[credits.plan_tier] || credits.plan_tier}
          </span>
        </div>
      </div>

      {/* 积分条目 */}
      <div className="px-3 py-2 space-y-1">
        {tiers.map((t) => {
          const value = t.key === "basic" ? credits.basic_credits : credits.advanced_credits;
          const displayValue = t.key === "basic"
            ? displayCredits(credits.basic_credits_display, credits.basic_credits)
            : displayCredits(credits.advanced_credits_display, credits.advanced_credits);
          const quota = credits.daily_quota?.[t.key] ?? 0;
          const quotaDisplay = quota < 0 ? "∞" : displayCredits(undefined, quota);
          const isUnlimited = quota < 0;
          const percent = isUnlimited ? 100 : quota > 0 ? Math.min(100, (value / quota) * 100) : 0;

          return (
            <div key={t.key} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-card/60 transition-colors">
              <span className="text-sm shrink-0">{t.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[12px] text-text-secondary">{t.label}</span>
                  <span className={`text-[12px] font-mono font-medium ${t.text}`}>
                    {isUnlimited ? "∞" : displayValue}
                    {!isUnlimited && <span className="text-text-tertiary">/{quotaDisplay}</span>}
                  </span>
                </div>
                {/* 进度条 */}
                {!isUnlimited && (
                  <div className="h-1 rounded-full bg-surface-border overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${percent}%`,
                        backgroundColor: t.color,
                        opacity: percent < 20 ? 0.6 : 1,
                      }}
                    />
                  </div>
                )}
                {isUnlimited && (
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: `linear-gradient(90deg, ${t.color}40, ${t.color})` }} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部 */}
      <div className="px-3 py-2 border-t border-surface-border">
        <button
          onClick={onUpgrade}
          className="w-full py-1.5 rounded-lg bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 text-[12px] font-medium text-amber-400 hover:from-amber-500/30 hover:to-orange-500/30 transition-colors"
        >
          升级套餐 →
        </button>
      </div>
    </div>
  );
}
