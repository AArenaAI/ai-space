"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Palette,
  FileText,
  Check,
  ChevronDown,
  Search,
  Sparkles,
  Send,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/components/theme/ThemeProvider";
import { cn } from "@/lib/utils";
import TemplatesPage from "@/app/(main)/(creative)/templates/page";

type Tab = "general" | "templates" | "feedback";

/* ═══════════════════ 账户 ═══════════════════ */

function AccountSection() {
  const { t } = useI18n();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const raw = localStorage.getItem("user");
    if (raw) {
      try {
        setUser(JSON.parse(raw));
      } catch { /* ignore */ }
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/");
  };

  const name = user?.name || "";
  const email = user?.email || "";

  return (
    <div>
      <h2 className="text-lg font-semibold text-text-primary">{t("account.title")}</h2>

      <div className="mt-6">
        <div className="flex items-center justify-between rounded-2xl bg-surface-card px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
              <span className="text-base font-semibold">
                {(name || email || "U")[0]?.toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-text-primary">
                {name || email}
              </div>
              <div className="truncate text-xs text-text-tertiary">{email}</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="shrink-0 rounded-xl border border-surface-border bg-surface-elevated px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-card hover:text-text-primary"
          >
            {t("account.logout")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ 外观 ═══════════════════ */

function ThemeDropdown() {
  const { t } = useI18n();
  const themeCtx = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const themes = [
    { id: "light" as const, label: t("appearance.theme.light") },
    { id: "dark" as const, label: t("appearance.theme.dark") },
    { id: "green" as const, label: t("appearance.theme.green") },
  ];

  const current = themes.find((th) => th.id === themeCtx?.theme);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between rounded-xl border border-surface-border bg-surface-card px-4 py-3 text-sm text-text-primary transition-colors hover:border-surface-border/80"
      >
        <span>{current?.label}</span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-text-tertiary transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full rounded-xl border border-surface-border bg-surface-elevated shadow-xl py-1 animate-fade-in">
          {themes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => {
                themeCtx?.setTheme(theme.id);
                setOpen(false);
              }}
              className={cn(
                "flex items-center justify-between w-full px-4 py-2.5 text-sm transition-colors",
                themeCtx?.theme === theme.id
                  ? "bg-purple-500/10 text-text-primary"
                  : "text-text-secondary hover:bg-surface-card"
              )}
            >
              <span>{theme.label}</span>
              {themeCtx?.theme === theme.id && (
                <Check className="w-4 h-4 text-text-primary" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LanguageDropdown() {
  const { language, setLanguage, languages, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const currentLang = languages.find((l) => l.code === language);

  const filtered = useMemo(() => {
    if (!search.trim()) return languages;
    const q = search.trim().toLowerCase();
    return languages.filter(
      (l) =>
        l.label.toLowerCase().includes(q) ||
        l.labelEn.toLowerCase().includes(q)
    );
  }, [search, languages]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between rounded-xl border border-surface-border bg-surface-card px-4 py-3 text-sm text-text-primary transition-colors hover:border-surface-border/80"
      >
        <div className="flex items-center gap-2">
          <span>{currentLang?.label}</span>
          <span className="text-text-tertiary text-xs">({currentLang?.labelEn})</span>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-text-tertiary transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full rounded-xl border border-surface-border bg-surface-elevated shadow-xl py-2 animate-fade-in">
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 rounded-lg bg-surface-card px-3 py-2">
              <Search className="w-4 h-4 text-text-tertiary shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("appearance.language.search")}
                className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-auto">
            {filtered.map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  setLanguage(lang.code);
                  setOpen(false);
                  setSearch("");
                }}
                className={cn(
                  "flex flex-col w-full px-4 py-2.5 text-left transition-colors",
                  language === lang.code
                    ? "bg-purple-500/10 text-text-primary"
                    : "text-text-secondary hover:bg-surface-card"
                )}
              >
                <span className="text-sm">{lang.label}</span>
                <span className="text-xs text-text-tertiary">{lang.labelEn}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-4 py-3 text-sm text-text-tertiary">
                {t("appearance.language.noResults")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AppearanceSection() {
  const { t } = useI18n();

  return (
    <div>
      <h2 className="text-lg font-semibold text-text-primary">{t("appearance.title")}</h2>

      <div className="mt-6 divide-y divide-surface-border">
        <div className="flex items-center justify-between py-4 gap-4">
          <span className="text-sm text-text-primary shrink-0">{t("appearance.theme")}</span>
          <div className="w-52">
            <ThemeDropdown />
          </div>
        </div>
        <div className="flex items-center justify-between py-4 gap-4">
          <span className="text-sm text-text-primary shrink-0">{t("appearance.language")}</span>
          <div className="w-52">
            <LanguageDropdown />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ 内测反馈 ═══════════════════ */

const FEEDBACK_CATEGORIES = [
  { value: "bug", label: "需要修改", desc: "页面错误、流程不顺、结果异常" },
  { value: "optimization", label: "需要优化", desc: "体验、速度、交互、稳定性建议" },
  { value: "feature", label: "新功能建议", desc: "希望增加的模型、工具或工作流" },
  { value: "other", label: "其他反馈", desc: "任何平台相关想法都可以提交" },
];

function BetaFeedbackSection() {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    category: "optimization",
    title: "",
    content: "",
    expectedImprovement: "",
  });

  const inputClassName = "w-full rounded-[18px] border border-transparent bg-[#f5f6f8] px-4 py-3.5 text-sm text-[#111827] outline-none transition-all placeholder:text-[#9ca3af] focus:border-[#d1d5db] focus:bg-white focus:shadow-[0_0_0_4px_rgba(17,24,39,0.05)]";
  const labelClassName = "text-sm font-medium text-[#374151]";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) {
      toast.error("请填写反馈标题和详细内容");
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      toast.error("请先登录后再提交反馈");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/beta/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          category: form.category,
          title: form.title,
          content: form.content,
          expected_improvement: form.expectedImprovement,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || "提交失败");
      toast.success("反馈已提交", {
        description: data.message || "感谢你的建议。高质量建议被采纳后，可能获得免费积分或会员奖励。",
      });
      setForm({ category: "optimization", title: "", content: "", expectedImprovement: "" });
    } catch (err) {
      toast.error("提交失败", { description: err instanceof Error ? err.message : "请稍后重试" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="rounded-[34px] bg-white p-7 shadow-[0_24px_80px_rgba(15,23,42,0.10)] md:p-8">
        <div className="text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-[#f1f2f4] px-4 py-2 text-sm font-medium text-[#374151]">
            <Sparkles className="h-4 w-4" />
            内测反馈
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">帮助 AI Space 变得更好</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#6b7280]">
            欢迎提交平台哪里需要修改、哪里需要优化、希望增加什么新功能。被采纳的高质量反馈或优秀优化建议，可能赠送免费积分或会员权益。
          </p>
        </div>

        <div className="mt-7 grid gap-3 md:grid-cols-3">
          {[
            { title: "问题修改", desc: "指出不顺、不对、不好用的地方" },
            { title: "体验优化", desc: "交互、速度、样式、流程建议" },
            { title: "功能提案", desc: "想要的新模型、新工具、新工作流" },
          ].map((item) => (
            <div key={item.title} className="rounded-2xl bg-[#f5f6f8] p-4">
              <div className="text-sm font-semibold">{item.title}</div>
              <div className="mt-1 text-xs leading-5 text-[#6b7280]">{item.desc}</div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-7">
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-base font-semibold">
              <FileText className="h-5 w-5" />
              反馈内容
            </div>

            <div className="space-y-2">
              <label className={labelClassName}>反馈类型 <span className="text-red-500">*</span></label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {FEEDBACK_CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setForm({ ...form, category: cat.value })}
                    className={cn(
                      "rounded-[18px] p-4 text-left transition-all",
                      form.category === cat.value
                        ? "bg-[#111827] text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)]"
                        : "bg-[#f5f6f8] text-[#374151] hover:bg-[#eef0f3]"
                    )}
                  >
                    <div className="text-sm font-semibold">{cat.label}</div>
                    <div className={cn("mt-1 text-xs leading-5", form.category === cat.value ? "text-white/75" : "text-[#6b7280]")}>{cat.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className={labelClassName}>标题 <span className="text-red-500">*</span></label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="例如：对比回答里需要更清楚地区分两个模型输出"
                className={inputClassName}
              />
            </div>

            <div className="space-y-2">
              <label className={labelClassName}>详细说明 <span className="text-red-500">*</span></label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="请描述你遇到的问题、希望优化的地方、或希望新增的功能。越具体越容易被采纳。"
                className={`${inputClassName} min-h-[140px] resize-y leading-6`}
              />
            </div>

            <div className="space-y-2">
              <label className={labelClassName}>你希望最终变成什么样？</label>
              <textarea
                value={form.expectedImprovement}
                onChange={(e) => setForm({ ...form, expectedImprovement: e.target.value })}
                placeholder="例如：希望支持某个模型、某种工作流、某个按钮位置、某种提示方式……"
                className={`${inputClassName} min-h-[112px] resize-y leading-6`}
              />
            </div>
          </section>

          <button
            type="submit"
            disabled={submitting}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 text-sm font-semibold text-white transition-colors",
              submitting ? "cursor-not-allowed bg-[#d1d5db] text-[#6b7280]" : "bg-[#111827] hover:bg-[#374151]"
            )}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? "提交中..." : "提交内测反馈"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════ 主页面 ═══════════════════ */

export default function SettingsPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<Tab>("general");

  const navItems: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "general", label: t("settings.nav.general"), icon: User },
    { id: "templates", label: t("settings.nav.templates"), icon: FileText },
    { id: "feedback", label: "内测反馈", icon: Sparkles },
  ];

  return (
    <div className="flex h-full bg-surface-elevated">
      {/* 左侧导航 */}
      <aside className="w-60 flex flex-col shrink-0">
        <nav className="flex-1 px-3 pb-6 pt-6 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-base transition-all",
                  activeTab === item.id
                    ? "bg-surface-card text-text-primary font-medium shadow-sm"
                    : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* 右侧内容 */}
      <main
        className={cn(
          "flex-1",
          activeTab === "templates" ? "overflow-hidden" : "overflow-auto"
        )}
      >
        {activeTab === "general" && (
          <div className="max-w-2xl mx-auto px-8 py-8 space-y-10">
            <AccountSection />
            <AppearanceSection />
          </div>
        )}
        {activeTab === "templates" && (
          <div className="h-full">
            <TemplatesPage />
          </div>
        )}
        {activeTab === "feedback" && <BetaFeedbackSection />}
      </main>
    </div>
  );
}
