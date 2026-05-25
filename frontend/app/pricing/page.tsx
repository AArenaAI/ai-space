import Link from "next/link";
import { Check, Coffee, Flame, Star, Infinity } from "lucide-react";

const plans = [
  {
    id: "free",
    name: "免费版",
    price: "0",
    priceDisplay: "免费",
    icon: Coffee,
    iconColor: "text-amber-400",
    bgGradient: "from-amber-500/5 to-transparent",
    border: "border-amber-500/20",
    features: [
      "每日 30 基础积分",
      "基础模型可用",
      "标准响应速度",
      "每日自动重置配额",
    ],
    credits: { basic: 30, advanced: 0, elite: 0 },
    cta: "开始使用",
    current: true,
  },
  {
    id: "basic",
    name: "Basic",
    price: "***",
    priceDisplay: "***",
    icon: Flame,
    iconColor: "text-orange-400",
    bgGradient: "from-orange-500/5 to-transparent",
    border: "border-orange-500/20",
    features: [
      "100 基础积分 / 月",
      "20 高级积分 / 月",
      "5 精英积分 / 月",
      "高级模型可用",
      "无广告体验",
    ],
    credits: { basic: 100, advanced: 20, elite: 5 },
    cta: "选择 Basic",
    popular: false,
  },
  {
    id: "plus",
    name: "Plus",
    price: "***",
    priceDisplay: "***",
    icon: Star,
    iconColor: "text-purple-400",
    bgGradient: "from-purple-500/5 to-transparent",
    border: "border-purple-500/20",
    features: [
      "300 基础积分 / 月",
      "80 高级积分 / 月",
      "20 精英积分 / 月",
      "精英模型可用",
      "优先响应速度",
      "无广告体验",
    ],
    credits: { basic: 300, advanced: 80, elite: 20 },
    cta: "选择 Plus",
    popular: true,
  },
  {
    id: "ultra",
    name: "Ultra",
    price: "***",
    priceDisplay: "***",
    icon: Infinity,
    iconColor: "text-emerald-400",
    bgGradient: "from-emerald-500/5 to-transparent",
    border: "border-emerald-500/20",
    features: [
      "无限基础积分",
      "200 高级积分 / 月",
      "60 精英积分 / 月",
      "全部模型可用",
      "最快响应速度",
      "无广告体验",
    ],
    credits: { basic: -1, advanced: 200, elite: 60 },
    cta: "选择 Ultra",
    popular: false,
  },
];

const tierBadges = [
  { icon: "☕", label: "基础", color: "text-amber-400", bg: "bg-amber-500/10" },
  { icon: "🔥", label: "高级", color: "text-orange-400", bg: "bg-orange-500/10" },
  { icon: "⭐", label: "精英", color: "text-purple-400", bg: "bg-purple-500/10" },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-surface">
      {/* 导航栏 */}
      <nav className="h-14 border-b border-surface-border flex items-center justify-between px-6">
        <Link href="/chat" className="text-sm font-semibold text-text-primary tracking-tight hover:text-amber-400 transition-colors">
          ← 返回 AI Space
        </Link>
        <span className="text-xs text-text-tertiary">定价方案</span>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* 头部 */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-text-primary mb-3">选择适合你的方案</h1>
          <p className="text-sm text-text-secondary max-w-lg mx-auto">
            根据你的使用需求选择套餐，获取更多高级模型使用额度
          </p>

          {/* 积分说明 */}
          <div className="mt-6 flex items-center justify-center gap-4">
            {tierBadges.map((t) => (
              <div key={t.label} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${t.bg}`}>
                <span>{t.icon}</span>
                <span className={`text-xs font-medium ${t.color}`}>{t.label}积分</span>
              </div>
            ))}
          </div>
        </div>

        {/* 套餐卡片 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const Icon = plan.icon;
            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl border ${plan.border} bg-gradient-to-b ${plan.bgGradient} p-5 flex flex-col transition-all duration-200 hover:shadow-lg hover:border-opacity-40`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-purple-500 text-white text-[10px] font-medium">
                    最受欢迎
                  </div>
                )}

                {/* 头部 */}
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`w-4 h-4 ${plan.iconColor}`} />
                  <span className="text-sm font-semibold text-text-primary">{plan.name}</span>
                </div>

                {/* 价格 */}
                <div className="mb-4">
                  <span className="text-2xl font-bold text-text-primary">{plan.priceDisplay}</span>
                  {plan.price !== "0" && plan.price !== "***" && (
                    <span className="text-xs text-text-tertiary ml-1">/ 月</span>
                  )}
                </div>

                {/* 积分摘要 */}
                <div className="flex items-center gap-2 mb-4 text-[11px]">
                  <span className="flex items-center gap-0.5 text-amber-400">
                    <span>☕</span>
                    <span className="font-mono">{plan.credits.basic < 0 ? "∞" : plan.credits.basic}</span>
                  </span>
                  <span className="flex items-center gap-0.5 text-orange-400">
                    <span>🔥</span>
                    <span className="font-mono">{plan.credits.advanced}</span>
                  </span>
                  <span className="flex items-center gap-0.5 text-purple-400">
                    <span>⭐</span>
                    <span className="font-mono">{plan.credits.elite}</span>
                  </span>
                </div>

                {/* 功能列表 */}
                <ul className="space-y-2 mb-5 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px] text-text-secondary">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <button
                  disabled={plan.current}
                  className={`w-full py-2 rounded-xl text-sm font-medium transition-colors ${
                    plan.current
                      ? "bg-surface-card border border-surface-border text-text-tertiary cursor-default"
                      : plan.popular
                      ? "bg-purple-500 hover:bg-purple-600 text-white"
                      : "bg-surface-card border border-surface-border text-text-primary hover:bg-surface-elevated"
                  }`}
                >
                  {plan.current ? "当前套餐" : plan.cta}
                </button>
              </div>
            );
          })}
        </div>

        {/* 模型等级说明 */}
        <div className="mt-12 rounded-2xl border border-surface-border bg-surface-elevated p-6">
          <h2 className="text-sm font-semibold text-text-primary mb-4">模型等级说明</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-amber-400">☕</span>
                <span className="text-sm font-medium text-text-primary">基础模型</span>
              </div>
              <p className="text-[12px] text-text-tertiary">
                GPT 5.4 Mini、DeepSeek V4 Flash、Gemini 3.1 Flash
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-orange-400">🔥</span>
                <span className="text-sm font-medium text-text-primary">高级模型</span>
              </div>
              <p className="text-[12px] text-text-tertiary">
                GPT 5.4、GPT 5.5、Gemini 3.1 Pro、Kimi K2.5
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-purple-400">⭐</span>
                <span className="text-sm font-medium text-text-primary">精英模型</span>
              </div>
              <p className="text-[12px] text-text-tertiary">
                GPT 5.5 Pro、DeepSeek V4 Pro、Kimi K2.6
              </p>
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="mt-8 text-center">
          <p className="text-[11px] text-text-tertiary">
            积分每月初重置，未用完的积分不累积。如需更多配额请联系管理员。
          </p>
        </div>
      </div>
    </div>
  );
}
