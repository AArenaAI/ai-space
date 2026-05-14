"use client";

import {
  MessageSquare,
  Palette,
  Presentation,
  Brain,
  Globe,
  Sparkles,
  Zap,
  Layers,
} from "lucide-react";
import ScrollReveal from "./ScrollReveal";

const features = [
  {
    icon: MessageSquare,
    title: "多模型聚合聊天",
    desc: "同时调用 GPT-4.1、Claude 4、Gemini 2.5 等 20+ 顶级大模型，一键切换，对比回答，找到最佳答案。",
    color: "text-brand",
    bg: "bg-brand/10",
    border: "border-brand/20",
  },
  {
    icon: Palette,
    title: "AI 画图",
    desc: "支持 GPT-image-2、DALL-E、Ideogram 等多种图像生成模型，从文字描述到艺术创作，一句话即可生成高质量图像。",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
  },
  {
    icon: Presentation,
    title: "AI PPT",
    desc: "输入主题即可自动生成完整的演示文稿大纲，包含结构化内容、配色方案和设计建议，让演讲准备事半功倍。",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
  },
  {
    icon: Brain,
    title: "深度思考",
    desc: "启用 Reasoning 模式，AI 将进行多步推理和自我校验，适合复杂问题分析、代码审查、数学推导等高难度任务。",
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  {
    icon: Globe,
    title: "联网搜索",
    desc: "实时获取互联网最新信息，打破知识截止日期限制，让 AI 回答始终保持时效性和准确性。",
    color: "text-green-500",
    bg: "bg-green-500/10",
    border: "border-green-500/20",
  },
  {
    icon: Sparkles,
    title: "Skills 智能体",
    desc: "创建和使用自定义 AI 角色与技能，从编程助手到文案专家，让每个 AI 都有专属的专业能力。",
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="py-24 lg:py-32 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <ScrollReveal className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand/10 border border-brand/20 text-brand text-xs font-medium mb-4">
            <Zap className="w-3.5 h-3.5" />
            核心功能
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-4">
            一个平台，全面覆盖
          </h2>
          <p className="text-text-secondary max-w-2xl mx-auto">
            从对话到创作，从思考到搜索，AI Space 整合了你需要的所有 AI 工具
          </p>
        </ScrollReveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((feat, i) => {
            const Icon = feat.icon;
            return (
              <ScrollReveal key={feat.title} delay={i * 80}>
                <div className="group relative p-6 rounded-2xl bg-surface-card border border-surface-border hover:border-surface-border/80 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/5">
                  {/* hover 光晕 */}
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-brand/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                  <div className="relative">
                    <div
                      className={`w-11 h-11 rounded-xl ${feat.bg} ${feat.border} border flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}
                    >
                      <Icon className={`w-5 h-5 ${feat.color}`} />
                    </div>
                    <h3 className="text-base font-semibold text-text-primary mb-2">
                      {feat.title}
                    </h3>
                    <p className="text-sm text-text-secondary leading-relaxed">
                      {feat.desc}
                    </p>
                  </div>
                </div>
              </ScrollReveal>
            );
          })}
        </div>

        {/* 更多功能提示 */}
        <ScrollReveal delay={200} className="mt-12 text-center">
          <div className="inline-flex items-center gap-6 px-6 py-3 rounded-2xl bg-surface-card border border-surface-border">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Layers className="w-4 h-4 text-brand" />
              <span>模型对比</span>
            </div>
            <div className="w-px h-4 bg-surface-border" />
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <MessageSquare className="w-4 h-4 text-purple-500" />
              <span>流式对话</span>
            </div>
            <div className="w-px h-4 bg-surface-border" />
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Zap className="w-4 h-4 text-amber-500" />
              <span>模板快速开始</span>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
