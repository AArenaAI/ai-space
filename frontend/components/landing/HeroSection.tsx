"use client";

import Link from "next/link";
import { GraduationCap, Sparkles } from "lucide-react";
import AuthAwareButton from "./AuthAwareButton";
import ChatDemo from "./ChatDemo";
import { useI18n } from "@/lib/i18n";

export default function HeroSection() {
  const { t } = useI18n();
  const tags = ["AI 高考志愿", "GPT 5.5", "GPT 5.4", "Gemini 3.1", "GPT Image 2", t("landing.hero.tag.deepThinking"), t("landing.hero.tag.webSearch")];

  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-brand/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand/[0.02] rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="space-y-8 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand/10 border border-brand/20 text-brand text-xs font-medium animate-fade-in">
              <Sparkles className="w-3.5 h-3.5" />
              {t("landing.hero.badge")}
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold text-text-primary leading-tight tracking-tight animate-fade-up">
              {t("landing.hero.titleLine1")}
              <br />
              <span className="bg-gradient-to-r from-brand via-purple-500 to-brand bg-[length:200%_auto] animate-gradient-shift bg-clip-text text-transparent">
                {t("landing.hero.titleLine2")}
              </span>
            </h1>

            <p className="text-[15px] sm:text-base text-text-secondary max-w-lg mx-auto lg:mx-0 leading-7 animate-fade-up" style={{ animationDelay: "150ms" }}>
              {t("landing.hero.subtitle")}
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start animate-fade-up" style={{ animationDelay: "300ms" }}>
              <AuthAwareButton href="/gaokao-volunteer" variant="primary" icon={<GraduationCap className="w-4 h-4" />}>
                AI 高考志愿
              </AuthAwareButton>
              <a href="#features" className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-surface-border bg-surface-card px-6 py-3 text-sm font-medium text-text-tertiary opacity-45 grayscale">
                {t("landing.hero.learnFeatures")}
              </a>
              <Link href="/pricing" onClick={(e) => e.preventDefault()} className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-6 py-3 text-sm font-medium text-amber-600 opacity-45 grayscale dark:text-amber-400">
                {t("landing.hero.viewPricing")}
              </Link>
            </div>

            <div className="flex flex-wrap gap-2 justify-center lg:justify-start animate-fade-up" style={{ animationDelay: "450ms" }}>
              {tags.map((tag) => (
                <span key={tag} className="px-2.5 py-1 rounded-lg bg-surface-card border border-surface-border text-xs text-text-secondary">{tag}</span>
              ))}
            </div>
          </div>

          <div className="relative animate-fade-up" style={{ animationDelay: "200ms" }}>
            <ChatDemo />
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-surface to-transparent pointer-events-none" />
    </section>
  );
}
