"use client";

import { useState } from "react";
import {
  BookOpen,
  Bot,
  Check,
  Clapperboard,
  FileText,
  ImageIcon,
  Languages,
  Layers,
  Mic,
  Presentation,
  Search,
  Video,
  Zap,
} from "lucide-react";
import ScrollReveal from "./ScrollReveal";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

const featureBlocks = [
  {
    id: "chat",
    icon: Bot,
    eyebrow: "多模型对话",
    title: "一个入口，同时调用顶级模型",
    desc: "GPT 5.5、GPT 5.4、Gemini、Kimi、DeepSeek 等模型统一管理。支持流式输出、分叉对比、收藏、分享和会话搜索。",
    windowTitle: "AI Space · 多模型对话",
    videoSrc: "/home-materials/features/models.mp4?v=real-pages-20260620-en2",
    posterSrc: "/home-materials/features/posters/models.png?v=real-pages-20260620-en2",
    accent: "text-brand",
    border: "border-brand/45",
    glow: "from-brand/20 via-purple-500/10 to-brand/5",
    bg: "bg-brand/10",
    points: ["真实聊天页入口", "模型选择与工具开关", "文件上传、历史与收藏"],
  },
  {
    id: "studio",
    icon: Clapperboard,
    eyebrow: "漫剧 Studio",
    title: "从剧情到分镜，再到图片和视频",
    desc: "项目化管理本集剧情、角色场景资产、4×3 分镜、Seedream 图片和 Seedance 视频。每个镜头、资产、视频节点都有清晰状态。",
    windowTitle: "AI Space · 漫剧 Studio",
    videoSrc: "/home-materials/features/studio.mp4?v=real-pages-20260620-en2",
    posterSrc: "/home-materials/features/posters/studio.png?v=real-pages-20260620-en2",
    accent: "text-purple-500",
    border: "border-purple-500/45",
    glow: "from-purple-500/20 via-pink-500/10 to-purple-500/5",
    bg: "bg-purple-500/10",
    points: ["项目独立管理", "角色 / 场景资产绑定", "剧本、分镜、视频一条生产流"],
  },
  {
    id: "notebook",
    icon: BookOpen,
    eyebrow: "文档与知识整理",
    title: "把资料变成摘要、问答和结构化产物",
    desc: "文档阅读器与 Notebook 能承接 PDF、网页、笔记和资料库，生成摘要、问答、知识图谱、信息图、闪卡与结构化输出。",
    windowTitle: "AI Space · 文档阅读",
    videoSrc: "/home-materials/features/notebook.mp4?v=real-pages-20260620-en2",
    posterSrc: "/home-materials/features/posters/notebook.png?v=real-pages-20260620-en2",
    accent: "text-cyan-500",
    border: "border-cyan-500/45",
    glow: "from-cyan-500/20 via-blue-500/10 to-cyan-500/5",
    bg: "bg-cyan-500/10",
    points: ["PDF 上传与阅读", "自动摘要 / 提取数据 / 风险分析", "问答、知识图谱与信息图"],
  },
  {
    id: "creative",
    icon: ImageIcon,
    eyebrow: "图像与视频创作",
    title: "图像生成、视频入口和编辑工具集中管理",
    desc: "文生图、视频生成、去背景、换背景、文字移除、放大、局部重绘、区域画笔集中在创作中心，避免多平台反复搬运。",
    windowTitle: "AI Space · 图像创作",
    videoSrc: "/home-materials/features/creative.mp4?v=real-pages-20260620-en2",
    posterSrc: "/home-materials/features/posters/creative.png?v=real-pages-20260620-en2",
    accent: "text-pink-500",
    border: "border-pink-500/45",
    glow: "from-pink-500/20 via-rose-500/10 to-pink-500/5",
    bg: "bg-pink-500/10",
    points: ["真实创作中心页面", "模板发现与参数控制", "生成图片、生成视频和编辑工具入口"],
  },
  {
    id: "work",
    icon: Languages,
    eyebrow: "办公与翻译",
    title: "写作、翻译、文档阅读和 PPT 串起来",
    desc: "写作助手、文本翻译、实时语音翻译、文档阅读器、PPT 生成覆盖日常工作流，适合会议、跨语言协作和资料整理。",
    windowTitle: "AI Space · 翻译助手",
    videoSrc: "/home-materials/features/work.mp4?v=real-pages-20260620-en2",
    posterSrc: "/home-materials/features/posters/work.png?v=real-pages-20260620-en2",
    accent: "text-emerald-500",
    border: "border-emerald-500/45",
    glow: "from-emerald-500/20 via-teal-500/10 to-emerald-500/5",
    bg: "bg-emerald-500/10",
    points: ["文本翻译", "实时语音翻译", "写作、文档阅读与 PPT 生成"],
  },
];

const quickBadges = [
  { icon: Layers, label: "模型对比", color: "text-brand" },
  { icon: Video, label: "视频生成", color: "text-purple-500" },
  { icon: FileText, label: "文档解析", color: "text-cyan-500" },
  { icon: Mic, label: "实时翻译", color: "text-emerald-500" },
  { icon: Search, label: "联网搜索", color: "text-green-500" },
  { icon: Presentation, label: "AI PPT", color: "text-orange-500" },
];

type FeatureBlock = (typeof featureBlocks)[number];

function RealPageVideo({ item }: { item: FeatureBlock }) {
  const [canShowVideo, setCanShowVideo] = useState(false);

  return (
    <div className="relative">
      <div className={cn("absolute -inset-5 rounded-[2rem] bg-gradient-to-r blur-3xl animate-pulse-glow", item.glow)} />
      <div className={cn("relative overflow-hidden rounded-[1.35rem] border-2 bg-surface-card shadow-2xl shadow-black/10", item.border)}>
        <div className="relative aspect-[16/10] w-full bg-surface-elevated">
          <img
            src={item.posterSrc}
            alt={`${item.eyebrow}功能演示截图`}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
          <video
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
              canShowVideo ? "opacity-100" : "opacity-0"
            )}
            poster={item.posterSrc}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={`${item.eyebrow}功能演示视频`}
            onCanPlay={() => setCanShowVideo(true)}
            onLoadedData={() => setCanShowVideo(true)}
            onError={() => setCanShowVideo(false)}
          >
            <source src={item.videoSrc} type="video/mp4" />
          </video>
        </div>
      </div>
    </div>
  );
}

function FeatureShowcaseBlock({ item, index }: { item: FeatureBlock; index: number }) {
  const Icon = item.icon;
  const reversed = index % 2 === 1;

  return (
    <ScrollReveal delay={index * 80}>
      <div className="grid items-center gap-8 py-14 lg:grid-cols-2 lg:gap-14 lg:py-20">
        <div className={cn(reversed && "lg:order-2")}>
          <RealPageVideo item={item} />
        </div>
        <div className={cn("max-w-xl", reversed && "lg:order-1")}>
          <div className={cn("mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium", item.bg, item.border, item.accent)}>
            <Icon className="h-3.5 w-3.5" />
            {item.eyebrow}
          </div>
          <h3 className="mb-4 text-3xl font-semibold leading-tight tracking-tight text-text-primary sm:text-4xl">
            {item.title}
          </h3>
          <p className="text-sm leading-7 text-text-secondary sm:text-[15px]">
            {item.desc}
          </p>
          <div className="mt-6 grid gap-2">
            {item.points.map((point) => (
              <div key={point} className="flex items-center gap-2 text-sm text-text-secondary">
                <span className={cn("flex h-5 w-5 items-center justify-center rounded-full", item.bg)}>
                  <Check className={cn("h-3 w-3", item.accent)} />
                </span>
                {point}
              </div>
            ))}
          </div>
        </div>
      </div>
    </ScrollReveal>
  );
}

export default function FeaturesSection() {
  const { t } = useI18n();

  return (
    <section id="features" className="relative overflow-hidden py-24 lg:py-32">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-1/2 top-20 h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-brand/[0.03] blur-3xl" />
        <div className="absolute bottom-1/4 right-0 h-[420px] w-[520px] rounded-full bg-purple-500/[0.035] blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal className="mx-auto mb-10 max-w-3xl text-center lg:mb-16">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand">
            <Zap className="h-3.5 w-3.5" />
            {t("landing.features.badge")}
          </div>
          <h2 className="mb-4 text-3xl font-semibold text-text-primary sm:text-4xl lg:text-5xl">
            从灵感到成品，AI Space 覆盖完整创作与办公流程
          </h2>
          <p className="mx-auto max-w-2xl text-sm leading-7 text-text-secondary sm:text-[15px]">
            所有展示素材都来自当前产品真实页面：多模型对话、漫剧生产、知识整理、图像视频创作、写作翻译与文档处理集中在一个平台。
          </p>
        </ScrollReveal>

        <div className="divide-y divide-surface-border/60">
          {featureBlocks.map((item, index) => (
            <FeatureShowcaseBlock key={item.id} item={item} index={index} />
          ))}
        </div>

        <ScrollReveal delay={240} className="mt-10 text-center">
          <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-surface-border bg-surface-card px-4 py-3 sm:gap-4 sm:px-6">
            {quickBadges.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-center gap-2 rounded-xl bg-surface-elevated px-3 py-1.5 text-sm text-text-secondary">
                  <Icon className={cn("h-4 w-4", item.color)} />
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
