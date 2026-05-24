"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AppSidebar from "@/components/sidebar/AppSidebar";
import MobileNav from "@/components/mobile/MobileNav";
import ChatInterface from "@/components/chat/ChatInterface";
import { useModels } from "@/hooks/useModels";
import { ChatModel } from "@/hooks/useChat";
import {
  Sparkles, ArrowLeft, Zap, Search, Shield, FileCode, BookOpen,
  Wrench, PenTool, MessageSquare, Globe, Briefcase, Code2,
  BarChart3, Mail, ClipboardList, Terminal, GraduationCap, Languages,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface GoSkill {
  key: string;
  display_name: string;
  description: string;
  icon: string;
  category: string;
  version: string;
  recommended_model?: string;
  co_skills?: string[];
  is_meta?: boolean;
}

interface Skill {
  key: string;
  title: string;
  description: string;
  icon: string;
  tags: string[];
  version: string;
  co_skills?: string[];
  is_meta?: boolean;
}

const ICON_MAP: Record<string, React.ElementType> = {
  zap: Zap,
  search: Search,
  shield: Shield,
  "file-code": FileCode,
  "book-open": BookOpen,
  wrench: Wrench,
  "pen-tool": PenTool,
  "message-square": MessageSquare,
  globe: Globe,
  briefcase: Briefcase,
  "code-2": Code2,
  "bar-chart": BarChart3,
  mail: Mail,
  "clipboard-list": ClipboardList,
  terminal: Terminal,
  "graduation-cap": GraduationCap,
  languages: Languages,
};

const COLOR_MAP: Record<string, string> = {
  developer: "text-emerald-400",
  researcher: "text-blue-400",
  writer: "text-amber-400",
  "tech-lead": "text-purple-400",
  analyst: "text-cyan-400",
  general: "text-slate-400",
  business: "text-amber-400",
  code: "text-emerald-400",
  content: "text-pink-400",
  data: "text-violet-400",
  productivity: "text-teal-400",
  ai: "text-orange-400",
  academic: "text-blue-400",
  language: "text-indigo-400",
};

// 每个技能专属的欢迎示例
const SKILL_EXAMPLES: Record<string, { title: string; desc: string; prompt: string }[]> = {
  "ceo-strategist": [
    { title: "SWOT 分析", desc: "为我的 SaaS 初创公司做一份完整的 SWOT 分析", prompt: "为我的 SaaS 初创公司做一份完整的 SWOT 分析，包括优势、劣势、机会和威胁" },
    { title: "商业计划书", desc: "帮我撰写一份进入东南亚市场的商业计划书", prompt: "帮我撰写一份进入东南亚市场的商业计划书，包括市场分析、竞争对手、运营策略和财务预测" },
    { title: "竞争分析", desc: "分析当前 AI 教育赛道的竞争格局和发展趋势", prompt: "分析当前 AI 教育赛道的竞争格局，识别主要玩家、它们的差异化策略和未来发展趋势" },
  ],
  "code-reviewer": [
    { title: "性能审查", desc: "审查这段 Python 代码的性能瓶颈并给出优化建议", prompt: "审查这段 Python 代码的性能瓶颈，指出具体问题并给出优化方案" },
    { title: "安全检查", desc: "检查这个 React 组件是否有安全漏洞和内存泄漏", prompt: "检查这个 React 组件是否有安全漏洞、内存泄漏或资源管理问题" },
    { title: "代码重构", desc: "重构这个函数使其更简洁易读并遵循最佳实践", prompt: "重构这个函数使其更简洁易读，遵循 SOLID 原则和最佳实践" },
  ],
  "creative-writer": [
    { title: "科幻短篇", desc: "写一个关于时间旅行的科幻短篇开头", prompt: "写一个关于时间旅行的科幻短篇开头，要有悬念感和灵感爆发力" },
    { title: "产品文案", desc: "为我的新产品写一段吸引人的营销文案", prompt: "为我的新产品写一段吸引人的营销文案，突出核心价值和用户痛点" },
    { title: "风格改写", desc: "把这段平淡的描述改写成悬疑风格", prompt: "把这段平淡的描述改写成悬疑风格，增加氛围感和紧张感" },
  ],
  "data-analyst": [
    { title: "趋势分析", desc: "分析这组销售数据的季节性趋势", prompt: "分析这组销售数据的季节性趋势，指出峰谷和季节性规律" },
    { title: "Dashboard 设计", desc: "帮我设计一个用户留存率的 Dashboard 方案", prompt: "帮我设计一个用户留存率的 Dashboard 方案，包括核心指标和可视化建议" },
    { title: "业务预测", desc: "根据这些数据给出下季度的业务预测", prompt: "根据这些历史数据给出下季度的业务预测和关键建议" },
  ],
  "email-drafter": [
    { title: "催款邮件", desc: "写一封礼貌但坚定的催款邮件", prompt: "写一封礼貌但坚定的催款邮件，保持专业关系同时明确表达付款要求" },
    { title: "投资人汇报", desc: "起草一封给投资人的项目进展汇报邮件", prompt: "起草一封给投资人的项目进展汇报邮件，突出里程碑、财务状况和下一步计划" },
    { title: "拒绝邮件", desc: "写一封拒绝合作但保持关系的商务邮件", prompt: "写一封拒绝合作但保持友好关系的商务邮件，表达谢意并留有未来合作空间" },
  ],
  "meeting-minutes": [
    { title: "产品评审纪要", desc: "把这次产品评审会议的要点整理成结构化纪要", prompt: "把这次产品评审会议的要点整理成结构化纪要，包括决策、行动项和负责人" },
    { title: "提取行动项", desc: "从会议记录中提取所有行动项和截止日期", prompt: "从这段会议记录中提取所有行动项、负责人和截止日期" },
    { title: "季度复盘", desc: "帮我总结季度复盘会议的决策和关键结论", prompt: "总结季度复盘会议的核心决策、关键结论和下一步战略方向" },
  ],
  "prompt-engineer": [
    { title: "提示词优化", desc: "优化这个提示词让它输出更结构化的结果", prompt: "优化这个提示词，让 AI 输出更结构化、可操作的结果" },
    { title: "系统 Prompt 设计", desc: "把这个模糊需求改写成一个精确的 system prompt", prompt: "把这个模糊需求改写成一个精确的 system prompt，包括角色、输出格式和约束" },
    { title: "多轮对话框架", desc: "设计一个多轮对话的提示词框架", prompt: "设计一个多轮对话的提示词框架，支持上下文保持和状态管理" },
  ],
  "thesis-assistant": [
    { title: "文献综述润色", desc: "帮我改写这段文献综述使其更学术化", prompt: "帮我改写这段文献综述，提升学术性、增加论证强度" },
    { title: "摘要提炼", desc: "为我的论文摘要提炼核心创新点", prompt: "为我的论文摘要提炼核心创新点，突出研究贡献" },
    { title: "引用格式", desc: "检查这段引用是否符合 APA 标准", prompt: "检查这段引用是否符合 APA 标准，指出格式错误并给出修正" },
  ],
  "translator": [
    { title: "技术翻译", desc: "把这段技术文档翻译成地道的中文", prompt: "把这段技术文档翻译成地道的中文，保持术语准确性" },
    { title: "法律合同", desc: "将这份合同翻译成英文并保持法律术语准确", prompt: "将这份合同翻译成英文，确保法律术语准确并保持语境完整" },
    { title: "产品本地化", desc: "帮我本地化这段产品说明到日语市场", prompt: "帮我本地化这段产品说明到日语市场，适应日本文化习惯和用户偏好" },
  ],
};

function mapGoSkill(go: GoSkill): Skill {
  return {
    key: go.key,
    title: go.display_name,
    description: go.description,
    icon: go.icon,
    tags: [go.category || "general"],
    version: go.version || "1.0.0",
    co_skills: go.co_skills,
    is_meta: go.is_meta,
  };
}

function ChatSkeleton() {
  return (
    <div className="flex flex-col h-full bg-surface items-center justify-center">
      <div className="animate-pulse text-text-tertiary text-sm">加载中...</div>
    </div>
  );
}

export default function SkillChatContent() {
  const searchParams = useSearchParams();
  const urlSkillKey = searchParams.get("key") || "";
  const conversationId = searchParams.get("id")
    ? Number(searchParams.get("id"))
    : undefined;

  const [skillKey, setSkillKey] = useState(urlSkillKey);
  const [skill, setSkill] = useState<Skill | null>(null);
  const [recommendedModelId, setRecommendedModelId] = useState<string | undefined>(undefined);
  const [recommendedModel, setRecommendedModel] = useState<ChatModel | undefined>(undefined);
  const [skillLoading, setSkillLoading] = useState(true);
  const { models, loading: modelsLoading } = useModels();

  // 当 URL 只有 id 没有 key 时，从对话 API 恢复 skillKey
  useEffect(() => {
    if (urlSkillKey || !conversationId) return;
    const token = localStorage.getItem("token");
    if (!token) return;

    fetch(`/api/conversations/${conversationId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.skill_key) {
          setSkillKey(data.skill_key);
        } else {
          // 对话没有关联 skill，不再加载
          setSkillLoading(false);
        }
      })
      .catch(() => setSkillLoading(false));
  }, [urlSkillKey, conversationId]);

  useEffect(() => {
    if (!skillKey) {
      setSkillLoading(false);
      return;
    }
    setSkillLoading(true);
    fetch(`/api/skills/${skillKey}`)
      .then((r) => {
        if (!r.ok) throw new Error("Skill not found");
        return r.json();
      })
      .then((data: GoSkill) => {
        setSkill(mapGoSkill(data));
        setRecommendedModelId(data.recommended_model || undefined);
      })
      .catch(() => {
        setSkill(null);
        setRecommendedModelId(undefined);
        setRecommendedModel(undefined);
      })
      .finally(() => setSkillLoading(false));
  }, [skillKey]);

  useEffect(() => {
    if (!recommendedModelId) {
      setRecommendedModel(undefined);
      return;
    }
    const model = models.find((m) => m.id === recommendedModelId);
    setRecommendedModel(model);
  }, [recommendedModelId, models]);

  const Icon = skill ? ICON_MAP[skill.icon] || Sparkles : Sparkles;
  const iconColor = skill
    ? COLOR_MAP[skill.tags[0]] || COLOR_MAP.general
    : COLOR_MAP.general;

  return (
    <div className="flex flex-col h-screen bg-surface overflow-hidden">
      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
      <div className="flex flex-1 min-h-0">
        <div className="hidden md:block shrink-0">
          <Suspense fallback={null}>
            <AppSidebar skillKey={skillKey} />
          </Suspense>
        </div>
        <main className="flex-1 min-w-0 flex flex-col">
          {/* 顶部栏 */}
          <header className="shrink-0 h-12 flex items-center justify-between px-4 border-b border-surface-border">
            <div className="flex items-center gap-2.5">
              <Link
                href="/skills"
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </Link>
              {skillLoading ? (
                <div className="h-4 w-24 bg-surface-card rounded animate-pulse" />
              ) : skill ? (
                <div className="flex items-center gap-2">
                  <Icon className={cn("w-4 h-4", iconColor)} />
                  <span className="text-sm font-semibold text-text-primary">
                    {skill.title}
                  </span>
                  {/* 协同 Skill 标记 */}
                  {skill.co_skills && skill.co_skills.length > 0 && (
                    <div className="flex items-center gap-1">
                      {skill.co_skills.map((co) => (
                        <span
                          key={co}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20"
                          title="自动协同激活的质量控制 Skill"
                        >
                          +协同: {co}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* 元约束标记 */}
                  {skill.is_meta && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      元约束层
                    </span>
                  )}
                  <span className="text-[11px] text-text-tertiary hidden sm:inline">
                    {skill.description}
                  </span>
                </div>
              ) : (
                <span className="text-sm text-text-secondary">技能不存在</span>
              )}
            </div>
          </header>

          {/* 聊天区域 */}
          {modelsLoading || skillLoading ? (
            <ChatSkeleton />
          ) : !skill ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <Sparkles className="w-10 h-10 text-text-tertiary mb-3" />
              <p className="text-sm text-text-secondary">
                技能不存在或已被移除
              </p>
              <Link
                href="/skills"
                className="mt-4 px-4 py-2 rounded-xl bg-brand/10 text-brand text-sm hover:bg-brand/20 transition-colors"
              >
                返回技能中心
              </Link>
            </div>
          ) : (
            <ChatInterface
              key={skillKey || "chat"}
              conversationId={conversationId}
              models={models}
              skillKey={skillKey}
              recommendedModel={recommendedModel}
              welcomeTitle={skill.title}
              welcomeSubtitle={skill.description}
              welcomeExamples={SKILL_EXAMPLES[skillKey]}
            />
          )}
        </main>
      </div>
    </div>
  );
}
