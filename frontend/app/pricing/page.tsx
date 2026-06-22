"use client";

import Link from "next/link";
import { Check, Coffee, Flame, Star, Infinity, PenLine, Languages, Mic, FileText, ImageIcon, Video, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
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
    credits: { basic: 30, advanced: 0 },
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
    featureKeys: ["pricing.basic.feature.basic", "pricing.basic.feature.advanced", "pricing.feature.advancedModels", "pricing.feature.noAds"],
    credits: { basic: 100, advanced: 25 },
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
    featureKeys: ["pricing.plus.feature.basic", "pricing.plus.feature.advanced", "pricing.feature.advancedModels", "pricing.feature.prioritySpeed", "pricing.feature.noAds"],
    credits: { basic: 300, advanced: 100 },
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
    featureKeys: ["pricing.ultra.feature.basic", "pricing.ultra.feature.advanced", "pricing.feature.allModels", "pricing.feature.fastestSpeed", "pricing.feature.noAds"],
    credits: { basic: -1, advanced: 260 },
    ctaKey: "pricing.chooseUltra",
    popular: false,
  },
];

const tierBadges = [
  { icon: "☕", labelKey: "pricing.badge.basic", color: "text-amber-400", bg: "bg-amber-500/10" },
  { icon: "🔥", labelKey: "pricing.badge.advanced", color: "text-orange-400", bg: "bg-orange-500/10" },
];

type TierKey = "basic" | "advanced";
type TierModel = { id: string; name: string; provider?: string; tier?: TierKey };

const fallbackTierModels: Record<TierKey, TierModel[]> = {
  basic: [
    { id: "gpt-5.4-mini", name: "GPT 5.4 Mini" },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "deepseek-v4-flash", name: "DeepSeek-V4 Flash" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash" },
  ],
  advanced: [
    { id: "gpt-5.4", name: "GPT 5.4" },
    { id: "gpt-5.5", name: "GPT 5.5" },
    { id: "gpt-5.5-pro", name: "GPT 5.5 Pro" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "deepseek-v4-pro", name: "DeepSeek-V4 Pro" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
  ],
};

const tierInfo: Array<{ key: TierKey; icon: string; color: string; labelKey: string }> = [
  { key: "basic", icon: "☕", color: "text-amber-400", labelKey: "pricing.modelTiers.basic" },
  { key: "advanced", icon: "🔥", color: "text-orange-400", labelKey: "pricing.modelTiers.advanced" },
];

const advancedFeatureGroups = [
  {
    title: "AI 工作",
    subtitle: "面向日常办公、资料处理与跨语言协作",
    accent: "from-blue-500/10 to-cyan-500/5",
    border: "border-blue-500/20",
    items: [
      { icon: PenLine, name: "写作助手", desc: "文章、邮件、方案与长文改写" },
      { icon: Languages, name: "文本翻译", desc: "多语言文本翻译与润色" },
      { icon: Mic, name: "实时语音翻译", desc: "会议与对话场景实时转译" },
      { icon: FileText, name: "文档阅读器", desc: "PDF / Word / PPT 资料阅读、摘要与问答" },
    ],
  },
  {
    title: "AI 创作",
    subtitle: "面向图像、视频、漫剧与视觉编辑工作流",
    accent: "from-purple-500/10 to-pink-500/5",
    border: "border-purple-500/20",
    items: [
      { icon: ImageIcon, name: "图像生成", desc: "文生图、参考图与创意视觉生成" },
      { icon: Video, name: "视频生成", desc: "Seedance 视频生成与分段成片" },
      { icon: Sparkles, name: "漫剧 Studio", desc: "剧情、资产、分镜、视频一体化生产" },
      { icon: Wand2, name: "图像编辑工具", desc: "去背景、换背景、文字移除、放大与局部重绘" },
    ],
  },
];

export default function PricingPage() {
  const { t } = useI18n();
  const [tierModels, setTierModels] = useState<Record<TierKey, TierModel[]>>(fallbackTierModels);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/models/tiers")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        const incoming = data?.tier_models;
        if (!incoming || cancelled) return;
        setTierModels({
          basic: Array.isArray(incoming.basic) && incoming.basic.length ? incoming.basic : fallbackTierModels.basic,
          advanced: Array.isArray(incoming.advanced) && incoming.advanced.length ? incoming.advanced : fallbackTierModels.advanced,
        });
      })
      .catch(() => {
        if (!cancelled) setTierModels(fallbackTierModels);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {tierInfo.map((tier) => (
              <div key={tier.key} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={tier.color}>{tier.icon}</span>
                  <span className="text-sm font-medium text-text-primary">{t(tier.labelKey)}</span>
                </div>
                <p className="text-[12px] text-text-tertiary">
                  {tierModels[tier.key].map((model) => model.name).join("、")}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-surface-border bg-surface-elevated p-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-5">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand mb-2">Advanced features</div>
              <h2 className="text-sm font-semibold text-text-primary">高级功能</h2>
            </div>
            <p className="text-[12px] text-text-tertiary max-w-xl sm:text-right">
              会员额度不仅用于模型对话，也覆盖侧边栏里的 AI 工作与 AI 创作入口。
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {advancedFeatureGroups.map((group) => (
              <div key={group.title} className={`rounded-2xl border ${group.border} bg-gradient-to-br ${group.accent} p-4`}>
                <div className="mb-4">
                  <div className="text-sm font-semibold text-text-primary">{group.title}</div>
                  <p className="mt-1 text-[12px] text-text-tertiary">{group.subtitle}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.name} className="rounded-xl border border-surface-border/70 bg-surface-card/70 p-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Icon className="w-4 h-4 text-brand" />
                          <span className="text-[12px] font-medium text-text-primary">{item.name}</span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-text-tertiary">{item.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-[11px] text-text-tertiary">{t("pricing.footerNote")}</p>
        </div>
      </div>
    </div>
  );
}
