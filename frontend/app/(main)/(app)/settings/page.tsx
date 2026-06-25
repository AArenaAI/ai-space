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
  KeyRound,
  Gift,
  ShieldCheck,
  Clock3,
  CheckCircle,
  Mail,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/components/theme/ThemeProvider";
import { cn } from "@/lib/utils";
import TemplatesPage from "@/app/(main)/(creative)/templates/page";

type Tab = "general" | "templates" | "betaCode" | "betaApply" | "feedback";

interface ActivationResult {
  phase?: string;
  phase_name?: string;
  beta_batch?: string;
  beta_credit_balance_display?: number;
  next_phase?: {
    phase_name?: string;
    unlock_condition?: string;
    credits?: number;
  };
}

function normalizeInviteCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24);
}

function formatInviteCode(value: string) {
  return normalizeInviteCode(value).replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

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

/* ═══════════════════ 内测码 ═══════════════════ */

function BetaCodeSection({ onApplyClick }: { onApplyClick: () => void }) {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [activation, setActivation] = useState<ActivationResult | null>(null);

  const normalizedCode = normalizeInviteCode(inviteCode);
  const displayCode = formatInviteCode(inviteCode);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizedCode) {
      toast.error("请输入邀请码", { description: "请粘贴或输入管理员发放的内测邀请码。" });
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch("/api/beta/use-invite", {
        method: "POST",
        headers,
        body: JSON.stringify({ code: normalizedCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || "激活失败");

      const raw = localStorage.getItem("user");
      if (raw) {
        const user = JSON.parse(raw);
        user.beta_phase = data.phase || "phase_1";
        user.beta_batch = data.beta_batch || data.batch || user.beta_batch;
        localStorage.setItem("user", JSON.stringify(user));
      }
      setActivation(data);
      setSubmitted(true);
      toast.success("激活成功", { description: "内测权限和测试额度已发放到账户。" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "激活失败";
      toast.error("激活失败", { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <div className="rounded-[34px] bg-white p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.10)]">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] bg-green-500/10">
            <CheckCircle className="h-10 w-10 text-green-500" />
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-[-0.03em]">激活成功</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#6b7280]">
            您已加入 AI Space 内测，测试额度已发放到账户。现在可以开始体验聊天、图片和视频能力。
          </p>
          <div className="mt-6 grid gap-3 text-left sm:grid-cols-2">
            <div className="rounded-2xl bg-[#f5f6f8] p-4">
              <div className="text-xs text-[#6b7280]">当前阶段</div>
              <div className="mt-1 font-semibold">{activation?.phase_name || "试探期"}</div>
            </div>
            <div className="rounded-2xl bg-[#f5f6f8] p-4">
              <div className="text-xs text-[#6b7280]">内测额度</div>
              <div className="mt-1 font-semibold">{activation?.beta_credit_balance_display ?? "已发放"}</div>
            </div>
          </div>
          {activation?.next_phase && (
            <div className="mt-3 rounded-2xl border border-[#e5e7eb] bg-white p-4 text-left text-sm text-[#6b7280]">
              <span className="font-medium text-[#111827]">下一阶段：{activation.next_phase.phase_name}</span>
              <div className="mt-1">{activation.next_phase.unlock_condition}</div>
            </div>
          )}
          <button onClick={() => router.push("/chat")} className="mt-7 inline-flex w-full items-center justify-center rounded-full bg-[#111827] px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#374151] sm:w-auto">
            开始使用 AI Space
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="rounded-[34px] bg-white p-7 shadow-[0_24px_80px_rgba(15,23,42,0.10)] md:p-8">
        <div className="text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-[#f1f2f4] px-4 py-2 text-sm font-medium text-[#374151]">
            <KeyRound className="h-4 w-4" />
            内测码
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">激活您的内测账号</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#6b7280]">
            输入内测邀请码完成绑定，立即获得 AI Space 内测权限和测试额度。
          </p>
        </div>

        <div className="mt-7 grid gap-3">
          {[
            { icon: Gift, title: "内测额度", desc: "激活后自动发放到当前账号" },
            { icon: ShieldCheck, title: "模型服务权限", desc: "解锁聊天、图片、视频等核心能力" },
            { icon: Clock3, title: "阶段任务", desc: "完成反馈可进入下一阶段额度池" },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-3 rounded-2xl bg-[#f5f6f8] p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#111827] shadow-sm">
                <item.icon className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">{item.title}</div>
                <div className="mt-0.5 text-xs leading-5 text-[#6b7280]">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[#374151]">邀请码</label>
            <div className="relative">
              <KeyRound className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca3af]" />
              <input
                type="text"
                value={displayCode}
                onChange={(e) => setInviteCode(normalizeInviteCode(e.target.value))}
                placeholder="ABCD-EFGH-1234"
                className="w-full rounded-[18px] border border-transparent bg-[#f5f6f8] py-3.5 pl-11 pr-4 text-sm font-medium tracking-[0.12em] text-[#111827] outline-none transition-all placeholder:font-normal placeholder:tracking-normal placeholder:text-[#9ca3af] focus:border-[#d1d5db] focus:bg-white focus:shadow-[0_0_0_4px_rgba(17,24,39,0.05)]"
              />
            </div>
            <p className="text-xs leading-5 text-[#9ca3af]">支持直接粘贴，系统会自动去除空格和横杠并转为大写。</p>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 text-sm font-semibold text-white transition-colors",
              submitting ? "cursor-not-allowed bg-[#d1d5db] text-[#6b7280]" : "bg-[#111827] hover:bg-[#374151]"
            )}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? "激活中..." : "激活账号"}
          </button>
        </form>

        <div className="mt-6 rounded-2xl border border-[#e5e7eb] p-4 text-center">
          <div className="text-sm font-medium text-[#374151]">没有邀请码？</div>
          <p className="mt-1 text-xs leading-5 text-[#6b7280]">提交申请后，审核通过会通过邮箱通知您。</p>
          <button onClick={onApplyClick} className="mt-3 text-sm font-semibold text-[#111827] underline-offset-4 hover:underline">
            提交内测申请
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ 内测申请 ═══════════════════ */

const SETTINGS_BETA_INDUSTRIES = [
  { value: "金融", label: "金融从业", icon: "💰" },
  { value: "算法", label: "算法/代码", icon: "💻" },
  { value: "自媒体", label: "自媒体内容", icon: "📝" },
  { value: "高级UI", label: "高级UI设计", icon: "🎨" },
  { value: "其他", label: "其他", icon: "🔧" },
];

const SETTINGS_BETA_EXPERIENCE_LEVELS = [
  { value: "beginner", label: "入门", desc: "偶尔使用 AI 工具" },
  { value: "intermediate", label: "进阶", desc: "每周使用 AI 辅助工作" },
  { value: "expert", label: "专家", desc: "深度依赖 AI 解决复杂问题" },
];

function BetaApplySection({ onCodeClick }: { onCodeClick: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    email: "",
    name: "",
    industry: "",
    jobTitle: "",
    useCase: "",
    badCaseSample: "",
    experienceLevel: "intermediate",
  });

  const inputClassName = "w-full rounded-[18px] border border-transparent bg-[#f5f6f8] px-4 py-3.5 text-sm text-[#111827] outline-none transition-all placeholder:text-[#9ca3af] focus:border-[#d1d5db] focus:bg-white focus:shadow-[0_0_0_4px_rgba(17,24,39,0.05)]";
  const labelClassName = "text-sm font-medium text-[#374151]";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.name || !form.industry || !form.useCase) {
      toast.error("请填写必填项", { description: "邮箱、姓名、行业领域和使用场景为必填项。" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/beta/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || "提交失败");
      setSubmitted(true);
      toast.success("申请已提交", { description: "审核通过后，我们会通过邮箱通知您。" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "提交失败";
      toast.error("提交失败", { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <div className="rounded-[34px] bg-white p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.10)]">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] bg-green-500/10">
            <CheckCircle className="h-10 w-10 text-green-500" />
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-[-0.03em]">申请已提交</h1>
          <p className="mt-3 text-sm leading-6 text-[#6b7280]">
            我们将尽快审核您的申请。审核通过后，您会收到唯一激活码和内测访问说明。
          </p>
          <button onClick={onCodeClick} className="mt-7 inline-flex w-full items-center justify-center rounded-full bg-[#111827] px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#374151] sm:w-auto">
            我已有邀请码
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="rounded-[34px] bg-white p-7 shadow-[0_24px_80px_rgba(15,23,42,0.10)] md:p-8">
        <div className="text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-[#f1f2f4] px-4 py-2 text-sm font-medium text-[#374151]">
            <Sparkles className="h-4 w-4" />
            内测申请
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">寻找被大模型“逻辑硬伤”折磨的重度用户</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#6b7280]">
            请认真填写真实使用场景。我们会优先邀请能提供复杂任务反馈、Bad Case 和真实工作流的用户。
          </p>
        </div>

        <div className="mt-7 grid gap-3 md:grid-cols-3">
          {[
            { title: "真实场景", desc: "说明你会怎样使用 AI Space" },
            { title: "复杂反馈", desc: "欢迎提交模型推理失败案例" },
            { title: "邮箱通知", desc: "审核通过后发送唯一激活码" },
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
              <User className="h-5 w-5" />
              基本信息
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className={labelClassName}>邮箱 <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca3af]" />
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="your@email.com" className={`${inputClassName} pl-11`} />
                </div>
              </div>
              <div className="space-y-2">
                <label className={labelClassName}>姓名 <span className="text-red-500">*</span></label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="真实姓名" className={inputClassName} />
              </div>
            </div>

            <div className="space-y-2">
              <label className={labelClassName}>行业领域 <span className="text-red-500">*</span></label>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {SETTINGS_BETA_INDUSTRIES.map((ind) => (
                  <button key={ind.value} type="button" onClick={() => setForm({ ...form, industry: ind.value })} className={cn("flex items-center gap-2 rounded-[18px] px-4 py-3 text-sm transition-all", form.industry === ind.value ? "bg-[#111827] text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)]" : "bg-[#f5f6f8] text-[#374151] hover:bg-[#eef0f3]")}> 
                    <span>{ind.icon}</span>
                    <span className="font-medium">{ind.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className={labelClassName}>职位</label>
              <div className="relative">
                <Briefcase className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca3af]" />
                <input type="text" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder="例如：量化研究员、前端工程师、内容总监" className={`${inputClassName} pl-11`} />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2 text-base font-semibold">
              <FileText className="h-5 w-5" />
              使用场景
            </div>
            <div className="space-y-2">
              <label className={labelClassName}>您计划如何使用 AI Space 解决什么问题？ <span className="text-red-500">*</span></label>
              <textarea value={form.useCase} onChange={(e) => setForm({ ...form, useCase: e.target.value })} placeholder="例如：跨行业宏观量化传导推演、复杂合同条款审计、多步 Agent 调试..." className={`${inputClassName} min-h-[128px] resize-y leading-6`} />
            </div>
            <div className="space-y-2">
              <label className={labelClassName}>您是否已有大模型的 Bad Case（逻辑错误案例）？</label>
              <textarea value={form.badCaseSample} onChange={(e) => setForm({ ...form, badCaseSample: e.target.value })} placeholder="描述一次大模型在复杂推理中出错的经历，以及您认为的正确答案..." className={`${inputClassName} min-h-[112px] resize-y leading-6`} />
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-base font-semibold">AI 使用经验</div>
            <div className="grid gap-3 md:grid-cols-3">
              {SETTINGS_BETA_EXPERIENCE_LEVELS.map((level) => (
                <label key={level.value} className={cn("cursor-pointer rounded-[18px] p-4 transition-all", form.experienceLevel === level.value ? "bg-[#111827] text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)]" : "bg-[#f5f6f8] text-[#374151] hover:bg-[#eef0f3]")}> 
                  <input type="radio" name="settings-beta-experience" value={level.value} checked={form.experienceLevel === level.value} onChange={(e) => setForm({ ...form, experienceLevel: e.target.value })} className="sr-only" />
                  <div className="text-sm font-semibold">{level.label}</div>
                  <div className={cn("mt-1 text-xs leading-5", form.experienceLevel === level.value ? "text-white/75" : "text-[#6b7280]")}>{level.desc}</div>
                </label>
              ))}
            </div>
          </section>

          <button type="submit" disabled={submitting} className={cn("flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 text-sm font-semibold text-white transition-colors", submitting ? "cursor-not-allowed bg-[#d1d5db] text-[#6b7280]" : "bg-[#111827] hover:bg-[#374151]")}> 
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? "提交中..." : "提交申请"}
          </button>
          <p className="text-center text-xs leading-5 text-[#9ca3af]">提交即表示您同意参与内测并反馈真实使用体验。审核结果将通过邮箱通知。</p>
        </form>
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
    { id: "betaCode", label: "内测码", icon: KeyRound },
    { id: "betaApply", label: "内测申请", icon: Mail },
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
        {activeTab === "betaCode" && <BetaCodeSection onApplyClick={() => setActiveTab("betaApply")} />}
        {activeTab === "betaApply" && <BetaApplySection onCodeClick={() => setActiveTab("betaCode")} />}
        {activeTab === "feedback" && <BetaFeedbackSection />}
      </main>
    </div>
  );
}
