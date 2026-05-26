"use client";

import { MessageSquare, Palette, Presentation, Brain, Globe, Sparkles, Zap, Layers } from "lucide-react";
import ScrollReveal from "./ScrollReveal";
import { useI18n } from "@/lib/i18n";

const featureItems = [
  { icon: MessageSquare, titleKey: "landing.features.chat.title", descKey: "landing.features.chat.desc", color: "text-brand", bg: "bg-brand/10", border: "border-brand/20" },
  { icon: Palette, titleKey: "landing.features.image.title", descKey: "landing.features.image.desc", color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  { icon: Presentation, titleKey: "landing.features.ppt.title", descKey: "landing.features.ppt.desc", color: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  { icon: Brain, titleKey: "landing.features.reasoning.title", descKey: "landing.features.reasoning.desc", color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  { icon: Globe, titleKey: "landing.features.search.title", descKey: "landing.features.search.desc", color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/20" },
  { icon: Sparkles, titleKey: "landing.features.skills.title", descKey: "landing.features.skills.desc", color: "text-cyan-500", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
];

export default function FeaturesSection() {
  const { t } = useI18n();
  const more = [
    { icon: Layers, label: t("landing.features.more.compare"), color: "text-brand" },
    { icon: MessageSquare, label: t("landing.features.more.streaming"), color: "text-purple-500" },
    { icon: Zap, label: t("landing.features.more.templates"), color: "text-amber-500" },
  ];

  return (
    <section id="features" className="py-24 lg:py-32 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <ScrollReveal className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand/10 border border-brand/20 text-brand text-xs font-medium mb-4">
            <Zap className="w-3.5 h-3.5" />
            {t("landing.features.badge")}
          </div>
          <h2 className="text-3xl sm:text-4xl font-semibold text-text-primary mb-4">{t("landing.features.title")}</h2>
          <p className="text-sm sm:text-[15px] text-text-secondary leading-7 max-w-2xl mx-auto">{t("landing.features.subtitle")}</p>
        </ScrollReveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {featureItems.map((feat, i) => {
            const Icon = feat.icon;
            return (
              <ScrollReveal key={feat.titleKey} delay={i * 80}>
                <div className="group relative p-6 rounded-2xl bg-surface-card border border-surface-border hover:border-surface-border/80 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/5">
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-brand/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative">
                    <div className={`w-11 h-11 rounded-xl ${feat.bg} ${feat.border} border flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                      <Icon className={`w-5 h-5 ${feat.color}`} />
                    </div>
                    <h3 className="text-[15px] font-semibold text-text-primary mb-2">{t(feat.titleKey)}</h3>
                    <p className="text-sm text-text-secondary leading-relaxed">{t(feat.descKey)}</p>
                  </div>
                </div>
              </ScrollReveal>
            );
          })}
        </div>

        <ScrollReveal delay={200} className="mt-12 text-center">
          <div className="inline-flex items-center gap-6 px-6 py-3 rounded-2xl bg-surface-card border border-surface-border">
            {more.map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="contents">
                  {i > 0 && <div className="w-px h-4 bg-surface-border" />}
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Icon className={`w-4 h-4 ${item.color}`} />
                    <span>{item.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
