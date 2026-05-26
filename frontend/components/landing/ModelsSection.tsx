"use client";

import { Check } from "lucide-react";
import ScrollReveal from "./ScrollReveal";
import { useI18n } from "@/lib/i18n";

interface Model {
  name: string;
  provider: string;
  featureKeys: string[];
  color: string;
}

const models: Model[] = [
  { name: "GPT 5.5 Pro", provider: "OpenAI", featureKeys: ["landing.models.feature.flagship", "landing.models.feature.reasoning", "landing.models.feature.webSearch"], color: "from-green-500/20 to-emerald-500/10" },
  { name: "GPT 5.4", provider: "OpenAI", featureKeys: ["landing.models.feature.writing", "landing.models.feature.code", "landing.models.feature.analysis"], color: "from-amber-500/20 to-orange-500/10" },
  { name: "Gemini 3.1 Pro", provider: "Google", featureKeys: ["landing.models.feature.multimodal", "landing.models.feature.longContext", "landing.models.feature.retrieval"], color: "from-blue-500/20 to-cyan-500/10" },
  { name: "GPT Image 2", provider: "OpenAI", featureKeys: ["landing.models.feature.textToImage", "landing.models.feature.imageEdit", "landing.models.feature.highRes"], color: "from-purple-500/20 to-pink-500/10" },
  { name: "DeepSeek-V4 Pro", provider: "DeepSeek", featureKeys: ["landing.models.feature.chinese", "landing.models.feature.math", "landing.models.feature.coding"], color: "from-rose-500/20 to-red-500/10" },
  { name: "Kimi K2.6", provider: "Moonshot", featureKeys: ["landing.models.feature.multimodalShort", "landing.models.feature.longContext", "landing.models.feature.reasoningBoost"], color: "from-indigo-500/20 to-violet-500/10" },
];

export default function ModelsSection() {
  const { t } = useI18n();

  return (
    <section id="models" className="py-24 lg:py-32 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-brand/[0.02] rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <ScrollReveal className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-500 text-xs font-medium mb-4">
            {t("landing.models.badge")}
          </div>
          <h2 className="text-3xl sm:text-4xl font-semibold text-text-primary mb-4">
            {t("landing.models.title")}
          </h2>
          <p className="text-sm sm:text-[15px] text-text-secondary leading-7 max-w-2xl mx-auto">
            {t("landing.models.subtitle")}
          </p>
        </ScrollReveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map((model, i) => (
            <ScrollReveal key={model.name} delay={i * 60}>
              <div className="group relative p-5 rounded-2xl bg-surface-card border border-surface-border hover:border-surface-border/80 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg">
                <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${model.color} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                <div className="relative">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-[15px] font-semibold text-text-primary">{model.name}</h3>
                      <p className="text-xs text-text-tertiary">{model.provider}</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center">
                      <span className="text-xs font-semibold text-brand">✓</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {model.featureKeys.map((f) => (
                      <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-elevated border border-surface-border text-[11px] text-text-secondary">
                        <Check className="w-3 h-3 text-brand" />
                        {t(f)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
