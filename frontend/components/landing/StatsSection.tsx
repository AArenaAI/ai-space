"use client";

import { MessageSquare, ImageIcon, Users, Zap } from "lucide-react";
import ScrollReveal from "./ScrollReveal";
import { useI18n } from "@/lib/i18n";

const stats = [
  { icon: MessageSquare, value: "10+", labelKey: "landing.stats.models", color: "text-brand" },
  { icon: ImageIcon, value: "4", labelKey: "landing.stats.tools", color: "text-purple-500" },
  { icon: Users, value: "10K+", labelKey: "landing.stats.users", color: "text-green-500" },
  { icon: Zap, value: "<1s", labelKey: "landing.stats.speed", color: "text-amber-500" },
];

export default function StatsSection() {
  const { t } = useI18n();

  return (
    <section id="stats" className="py-20 lg:py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <ScrollReveal className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-semibold text-text-primary mb-4">
            {t("landing.stats.title")}
          </h2>
          <p className="text-sm sm:text-[15px] text-text-secondary leading-7 max-w-xl mx-auto">
            {t("landing.stats.subtitle")}
          </p>
        </ScrollReveal>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s, i) => {
            const Icon = s.icon;
            return (
              <ScrollReveal key={s.labelKey} delay={i * 80}>
                <div className="group p-6 rounded-2xl bg-surface-card border border-surface-border text-center hover:-translate-y-1 transition-all duration-300 hover:shadow-lg">
                  <div className="w-12 h-12 rounded-xl bg-surface-elevated border border-surface-border flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                    <Icon className={`w-5 h-5 ${s.color}`} />
                  </div>
                  <div className="text-3xl font-semibold text-text-primary mb-1">{s.value}</div>
                  <div className="text-sm text-text-secondary">{t(s.labelKey)}</div>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
