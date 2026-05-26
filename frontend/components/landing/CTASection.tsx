"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import AuthAwareButton, { showLoginModal } from "./AuthAwareButton";
import ScrollReveal from "./ScrollReveal";
import { useI18n } from "@/lib/i18n";

export default function CTASection() {
  const { t } = useI18n();

  return (
    <section className="py-24 lg:py-32 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand/[0.03] rounded-full blur-3xl" />
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <ScrollReveal>
          <div className="relative p-8 sm:p-12 rounded-3xl bg-surface-card border border-surface-border text-center overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-brand/5 via-transparent to-purple-500/5" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand/10 border border-brand/20 text-brand text-xs font-medium mb-6">
                <Sparkles className="w-3.5 h-3.5" />
                {t("landing.cta.badge")}
              </div>
              <h2 className="text-3xl sm:text-4xl font-semibold text-text-primary mb-4">{t("landing.cta.title")}</h2>
              <p className="text-sm sm:text-[15px] text-text-secondary leading-7 max-w-lg mx-auto mb-8">{t("landing.cta.subtitle")}</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <AuthAwareButton variant="primary" className="!px-8 !py-3.5" icon={<ArrowRight className="w-4 h-4" />}>
                  {t("landing.cta.freeTry")}
                </AuthAwareButton>
                <button onClick={showLoginModal} className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-surface-elevated border border-surface-border text-text-primary text-sm font-medium hover:bg-surface-card transition-all duration-200 hover:-translate-y-0.5 cursor-pointer">
                  {t("landing.cta.register")}
                </button>
              </div>
              <p className="mt-6 text-xs text-text-tertiary">
                {t("landing.cta.hasAccount")}
                <button onClick={showLoginModal} className="text-brand hover:text-brand-hover ml-1 cursor-pointer">
                  {t("landing.cta.directLogin")}
                </button>
              </p>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
