"use client";

import Link from "next/link";
import { Check, Coffee, Flame, Star, Infinity } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const plans = [
  {
    id: "free",
    nameKey: "pricing.free.name",
    price: "0",
    priceDisplayKey: "pricing.free.price",
    icon: Coffee,
    iconColor: "text-amber-400",
    bgGradient: "from-amber-500/5 to-transparent",
    border: "border-amber-500/20",
    featureKeys: ["pricing.free.feature.dailyBasic", "pricing.free.feature.basicModels", "pricing.free.feature.standardSpeed", "pricing.free.feature.reset"],
    credits: { basic: 30, advanced: 0, elite: 0 },
    ctaKey: "pricing.free.cta",
    current: true,
  },
  {
    id: "basic",
    nameKey: "pricing.basic.name",
    price: "***",
    priceDisplayKey: "pricing.placeholderPrice",
    icon: Flame,
    iconColor: "text-orange-400",
    bgGradient: "from-orange-500/5 to-transparent",
    border: "border-orange-500/20",
    featureKeys: ["pricing.basic.feature.basic", "pricing.basic.feature.advanced", "pricing.basic.feature.elite", "pricing.feature.advancedModels", "pricing.feature.noAds"],
    credits: { basic: 100, advanced: 20, elite: 5 },
    ctaKey: "pricing.chooseBasic",
    popular: false,
  },
  {
    id: "plus",
    nameKey: "pricing.plus.name",
    price: "***",
    priceDisplayKey: "pricing.placeholderPrice",
    icon: Star,
    iconColor: "text-purple-400",
    bgGradient: "from-purple-500/5 to-transparent",
    border: "border-purple-500/20",
    featureKeys: ["pricing.plus.feature.basic", "pricing.plus.feature.advanced", "pricing.plus.feature.elite", "pricing.feature.eliteModels", "pricing.feature.prioritySpeed", "pricing.feature.noAds"],
    credits: { basic: 300, advanced: 80, elite: 20 },
    ctaKey: "pricing.choosePlus",
    popular: true,
  },
  {
    id: "ultra",
    nameKey: "pricing.ultra.name",
    price: "***",
    priceDisplayKey: "pricing.placeholderPrice",
    icon: Infinity,
    iconColor: "text-emerald-400",
    bgGradient: "from-emerald-500/5 to-transparent",
    border: "border-emerald-500/20",
    featureKeys: ["pricing.ultra.feature.basic", "pricing.ultra.feature.advanced", "pricing.ultra.feature.elite", "pricing.feature.allModels", "pricing.feature.fastestSpeed", "pricing.feature.noAds"],
    credits: { basic: -1, advanced: 200, elite: 60 },
    ctaKey: "pricing.chooseUltra",
    popular: false,
  },
];

const tierBadges = [
  { icon: "☕", labelKey: "pricing.badge.basic", color: "text-amber-400", bg: "bg-amber-500/10" },
  { icon: "🔥", labelKey: "pricing.badge.advanced", color: "text-orange-400", bg: "bg-orange-500/10" },
  { icon: "⭐", labelKey: "pricing.badge.elite", color: "text-purple-400", bg: "bg-purple-500/10" },
];

export default function PricingPage() {
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-surface">
      <nav className="h-14 border-b border-surface-border flex items-center justify-between px-6">
        <Link href="/chat" className="text-sm font-semibold text-text-primary tracking-tight hover:text-amber-400 transition-colors">
          {t("pricing.back")}
        </Link>
        <span className="text-xs text-text-tertiary">{t("pricing.navTitle")}</span>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-text-primary mb-3">{t("pricing.title")}</h1>
          <p className="text-sm text-text-secondary max-w-lg mx-auto">{t("pricing.subtitle")}</p>

          <div className="mt-6 flex items-center justify-center gap-4">
            {tierBadges.map((tier) => (
              <div key={tier.labelKey} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${tier.bg}`}>
                <span>{tier.icon}</span>
                <span className={`text-xs font-medium ${tier.color}`}>{t(tier.labelKey)}{t("pricing.badge.credits")}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const Icon = plan.icon;
            const name = t(plan.nameKey);
            const priceDisplay = t(plan.priceDisplayKey);
            return (
              <div key={plan.id} className={`relative rounded-2xl border ${plan.border} bg-gradient-to-b ${plan.bgGradient} p-5 flex flex-col transition-all duration-200 hover:shadow-lg hover:border-opacity-40`}>
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-purple-500 text-white text-[10px] font-medium">
                    {t("pricing.popular")}
                  </div>
                )}

                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`w-4 h-4 ${plan.iconColor}`} />
                  <span className="text-sm font-semibold text-text-primary">{name}</span>
                </div>

                <div className="mb-4">
                  <span className="text-2xl font-bold text-text-primary">{priceDisplay}</span>
                  {plan.price !== "0" && plan.price !== "***" && (
                    <span className="text-xs text-text-tertiary ml-1">{t("pricing.perMonth")}</span>
                  )}
                </div>

                <div className="flex items-center gap-2 mb-4 text-[11px]">
                  <span className="flex items-center gap-0.5 text-amber-400"><span>☕</span><span className="font-mono">{plan.credits.basic < 0 ? "∞" : plan.credits.basic}</span></span>
                  <span className="flex items-center gap-0.5 text-orange-400"><span>🔥</span><span className="font-mono">{plan.credits.advanced}</span></span>
                  <span className="flex items-center gap-0.5 text-purple-400"><span>⭐</span><span className="font-mono">{plan.credits.elite}</span></span>
                </div>

                <ul className="space-y-2 mb-5 flex-1">
                  {plan.featureKeys.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[12px] text-text-secondary">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{t(f)}</span>
                    </li>
                  ))}
                </ul>

                <button disabled={plan.current} className={`w-full py-2 rounded-xl text-sm font-medium transition-colors ${plan.current ? "bg-surface-card border border-surface-border text-text-tertiary cursor-default" : plan.popular ? "bg-purple-500 hover:bg-purple-600 text-white" : "bg-surface-card border border-surface-border text-text-primary hover:bg-surface-elevated"}`}>
                  {plan.current ? t("pricing.currentPlan") : t(plan.ctaKey)}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-12 rounded-2xl border border-surface-border bg-surface-elevated p-6">
          <h2 className="text-sm font-semibold text-text-primary mb-4">{t("pricing.modelTiers.title")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2"><div className="flex items-center gap-2"><span className="text-amber-400">☕</span><span className="text-sm font-medium text-text-primary">{t("pricing.modelTiers.basic")}</span></div><p className="text-[12px] text-text-tertiary">GPT 5.4 Mini、DeepSeek V4 Flash、Gemini 3.1 Flash</p></div>
            <div className="space-y-2"><div className="flex items-center gap-2"><span className="text-orange-400">🔥</span><span className="text-sm font-medium text-text-primary">{t("pricing.modelTiers.advanced")}</span></div><p className="text-[12px] text-text-tertiary">GPT 5.4、GPT 5.5、Gemini 3.1 Pro、Kimi K2.5</p></div>
            <div className="space-y-2"><div className="flex items-center gap-2"><span className="text-purple-400">⭐</span><span className="text-sm font-medium text-text-primary">{t("pricing.modelTiers.elite")}</span></div><p className="text-[12px] text-text-tertiary">GPT 5.5 Pro、DeepSeek V4 Pro、Kimi K2.6</p></div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-[11px] text-text-tertiary">{t("pricing.footerNote")}</p>
        </div>
      </div>
    </div>
  );
}
