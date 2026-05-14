"use client";

import { Check } from "lucide-react";
import ScrollReveal from "./ScrollReveal";

interface Model {
  name: string;
  provider: string;
  features: string[];
  color: string;
}

const models: Model[] = [
  {
    name: "GPT-4.1",
    provider: "OpenAI",
    features: ["文本对话", "代码生成", "联网搜索"],
    color: "from-green-500/20 to-emerald-500/10",
  },
  {
    name: "Claude 4",
    provider: "Anthropic",
    features: ["深度推理", "文档分析", "创意写作"],
    color: "from-amber-500/20 to-orange-500/10",
  },
  {
    name: "Gemini 2.5",
    provider: "Google",
    features: ["多模态理解", "长上下文", "实时检索"],
    color: "from-blue-500/20 to-cyan-500/10",
  },
  {
    name: "GPT-image-2",
    provider: "OpenAI",
    features: ["文生图", "图片编辑", "高分辨率"],
    color: "from-purple-500/20 to-pink-500/10",
  },
  {
    name: "DeepSeek-V3",
    provider: "DeepSeek",
    features: ["中文优化", "数学推导", "编程辅助"],
    color: "from-rose-500/20 to-red-500/10",
  },
  {
    name: "Qwen3-235B",
    provider: "Alibaba",
    features: ["多语言", "代码执行", "工具调用"],
    color: "from-indigo-500/20 to-violet-500/10",
  },
];

export default function ModelsSection() {
  return (
    <section id="models" className="py-24 lg:py-32 relative overflow-hidden">
      {/* 背景 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-brand/[0.02] rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <ScrollReveal className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-500 text-xs font-medium mb-4">
            模型聚合
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-4">
            20+ 顶级模型，一站式调用
          </h2>
          <p className="text-text-secondary max-w-2xl mx-auto">
            无需切换多个平台，一个入口即可访问全球领先的 AI 模型
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
                      <h3 className="text-base font-semibold text-text-primary">{model.name}</h3>
                      <p className="text-xs text-text-tertiary">{model.provider}</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center">
                      <span className="text-xs font-bold text-brand">✓</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {model.features.map((f) => (
                      <span
                        key={f}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-elevated border border-surface-border text-[11px] text-text-secondary"
                      >
                        <Check className="w-3 h-3 text-brand" />
                        {f}
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
