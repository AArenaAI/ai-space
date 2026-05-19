"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import AppSidebar from "@/components/sidebar/AppSidebar";
import MobileNav from "@/components/mobile/MobileNav";
import {
  Sparkles, ArrowRight, Zap, Search, Shield, FileCode, BookOpen,
  Wrench, PenTool, MessageSquare, Globe, Briefcase, Code2,
  BarChart3, Mail, ClipboardList, Terminal, GraduationCap, Languages,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface GoSkillMeta {
  key: string;
  display_name: string;
  description: string;
  icon: string;
  category: string;
  version: string;
  color?: string;
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
  developer: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  researcher: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  writer: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  "tech-lead": "text-purple-400 bg-purple-400/10 border-purple-400/20",
  analyst: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
  general: "text-slate-400 bg-slate-400/10 border-slate-400/20",
  business: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  code: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  content: "text-pink-400 bg-pink-400/10 border-pink-400/20",
  data: "text-violet-400 bg-violet-400/10 border-violet-400/20",
  productivity: "text-teal-400 bg-teal-400/10 border-teal-400/20",
  ai: "text-orange-400 bg-orange-400/10 border-orange-400/20",
  academic: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  language: "text-indigo-400 bg-indigo-400/10 border-indigo-400/20",
};

const TAG_LABELS: Record<string, string> = {
  developer: "开发",
  researcher: "研究",
  writer: "写作",
  "tech-lead": "技术管理",
  analyst: "分析",
  general: "通用",
  business: "商业",
  code: "代码",
  content: "内容",
  data: "数据",
  productivity: "效率",
  ai: "AI",
  academic: "学术",
  language: "语言",
};

function mapGoSkill(go: GoSkillMeta): Skill {
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

function SkillCard({ skill }: { skill: Skill }) {
  const Icon = ICON_MAP[skill.icon] || Sparkles;
  const colorClass = COLOR_MAP[skill.tags[0]] || COLOR_MAP.general;

  return (
    <Link
      href={`/skills/chat?key=${skill.key}`}
      className="group flex flex-col p-5 rounded-2xl border border-surface-border bg-surface-elevated hover:border-brand/30 hover:shadow-lg hover:shadow-brand/5 transition-all duration-200"
    >
      <div className="flex items-start justify-between mb-4">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", colorClass.split(" ")[1])}>
          <Icon className={cn("w-5 h-5", colorClass.split(" ")[0])} />
        </div>
        <div className="flex items-center gap-1 text-[11px] text-text-tertiary">
          <span>v{skill.version}</span>
          <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>

      <h3 className="text-sm font-semibold text-text-primary mb-1.5">{skill.title}</h3>
      <p className="text-xs text-text-secondary leading-relaxed mb-4 flex-1">{skill.description}</p>

      {/* 协同 Skill 标记 */}
      {skill.co_skills && skill.co_skills.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
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
        <div className="mb-2">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            元约束层
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {skill.tags.map((tag) => (
          <span
            key={tag}
            className={cn(
              "px-2 py-0.5 rounded-md text-[11px] font-medium border",
              COLOR_MAP[tag] || COLOR_MAP.general
            )}
          >
            {TAG_LABELS[tag] || tag}
          </span>
        ))}
      </div>
    </Link>
  );
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data) => {
        const systemSkills: GoSkillMeta[] = data.system_skills || [];
        const customSkills: GoSkillMeta[] = data.custom_skills || [];
        const all = [...systemSkills, ...customSkills]
          .filter((go) => !go.is_meta)  // 过滤元约束层，不独立显示
          .map(mapGoSkill);
        setSkills(all);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = skills.filter(
    (s) =>
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()) ||
      s.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex flex-col h-screen bg-surface overflow-hidden">
      <MobileNav />
      <div className="flex flex-1 min-h-0">
        <div className="hidden md:block shrink-0">
          <AppSidebar />
        </div>
        <main className="flex-1 min-w-0 flex flex-col">
          {/* 顶部栏 */}
          <header className="shrink-0 h-12 flex items-center justify-between px-4 border-b border-surface-border">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-400" />
              <span className="text-sm font-semibold text-text-primary tracking-tight">AI 技能中心</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-tertiary">{skills.length} 个技能</span>
            </div>
          </header>

          {/* 内容区 */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto px-4 py-8">
              {/* 搜索框 */}
              <div className="relative mb-8">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索技能..."
                  className="w-full h-10 pl-10 pr-4 rounded-xl bg-surface-elevated border border-surface-border text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand/40 transition-colors"
                />
              </div>

              {/* 技能网格 */}
              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="p-5 rounded-2xl border border-surface-border bg-surface-elevated animate-pulse">
                      <div className="w-10 h-10 rounded-xl bg-surface-card mb-4" />
                      <div className="h-4 bg-surface-card rounded mb-2 w-1/2" />
                      <div className="h-3 bg-surface-card rounded mb-1 w-full" />
                      <div className="h-3 bg-surface-card rounded w-2/3" />
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Sparkles className="w-10 h-10 text-text-tertiary mb-3" />
                  <p className="text-sm text-text-secondary">暂未找到匹配的技能</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filtered.map((skill) => (
                    <SkillCard key={skill.key} skill={skill} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
