"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, CheckCircle, AlertTriangle, Briefcase, User, Mail, FileText, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const INDUSTRIES = [
  { value: "金融", label: "金融从业", icon: "💰" },
  { value: "算法", label: "算法/代码", icon: "💻" },
  { value: "自媒体", label: "自媒体内容", icon: "📝" },
  { value: "高级UI", label: "高级UI设计", icon: "🎨" },
  { value: "其他", label: "其他", icon: "🔧" },
];

const EXPERIENCE_LEVELS = [
  { value: "beginner", label: "入门 — 偶尔使用AI工具" },
  { value: "intermediate", label: "进阶 — 每周使用AI辅助工作" },
  { value: "expert", label: "专家 — 深度依赖AI解决复杂问题" },
];

export default function BetaApplyPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: "",
    name: "",
    industry: "",
    jobTitle: "",
    useCase: "",
    badCaseSample: "",
    experienceLevel: "intermediate",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.name || !form.industry || !form.useCase) {
      setError("请填写必填项");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/beta/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "提交失败");
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface px-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10">
            <CheckCircle className="h-10 w-10 text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">申请已提交</h1>
          <p className="text-text-secondary">
            我们将尽快审核您的申请。审核通过后，您将收到唯一激活码及内测访问 URL。
          </p>
          <button
            onClick={() => router.push("/")}
            className="rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-hover transition-colors"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface py-12 px-4">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand/10 border border-brand/20 px-4 py-1.5 text-sm text-brand mb-4">
            <Sparkles className="h-4 w-4" />
            内测白名单申请
          </div>
          <h1 className="text-3xl font-bold text-text-primary tracking-tight">
            寻找被大模型"逻辑硬伤"折磨的重度用户
          </h1>
          <p className="mt-3 text-text-secondary">
            无精美 UI，仅开放 100 个内测白名单。请认真填写，敷衍将失去资格。
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}

          {/* 基本信息 */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <User className="h-5 w-5 text-brand" />
              基本信息
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">
                  邮箱 <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="your@email.com"
                    className="w-full rounded-xl border border-surface-border bg-surface-elevated pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">
                  姓名 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="真实姓名"
                  className="w-full rounded-xl border border-surface-border bg-surface-elevated px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">
                行业领域 <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {INDUSTRIES.map((ind) => (
                  <button
                    key={ind.value}
                    type="button"
                    onClick={() => setForm({ ...form, industry: ind.value })}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-4 py-3 text-sm transition-colors",
                      form.industry === ind.value
                        ? "border-brand/50 bg-brand/10 text-brand"
                        : "border-surface-border bg-surface-elevated text-text-secondary hover:border-brand/30"
                    )}
                  >
                    <span>{ind.icon}</span>
                    <span className="font-medium">{ind.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">职位</label>
              <div className="relative">
                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
                <input
                  type="text"
                  value={form.jobTitle}
                  onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                  placeholder="例如：量化研究员、前端工程师、内容总监"
                  className="w-full rounded-xl border border-surface-border bg-surface-elevated pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            </div>
          </div>

          {/* 使用场景 */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <FileText className="h-5 w-5 text-brand" />
              使用场景
            </h2>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">
                您计划如何使用 AI Space 解决什么问题？ <span className="text-red-400">*</span>
              </label>
              <textarea
                value={form.useCase}
                onChange={(e) => setForm({ ...form, useCase: e.target.value })}
                placeholder="例如：跨行业宏观量化传导推演、复杂合同条款审计、多步 Agent 调试..."
                className="w-full rounded-xl border border-surface-border bg-surface-elevated px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30 min-h-[120px] resize-y"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">
                您是否已有大模型的 Bad Case（逻辑错误案例）？
              </label>
              <textarea
                value={form.badCaseSample}
                onChange={(e) => setForm({ ...form, badCaseSample: e.target.value })}
                placeholder="描述一次大模型在复杂推理中出错的经历，以及您认为的正确答案..."
                className="w-full rounded-xl border border-surface-border bg-surface-elevated px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30 min-h-[100px] resize-y"
              />
            </div>
          </div>

          {/* 经验等级 */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">AI 使用经验</h2>
            <div className="space-y-2">
              {EXPERIENCE_LEVELS.map((level) => (
                <label
                  key={level.value}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors",
                    form.experienceLevel === level.value
                      ? "border-brand/50 bg-brand/10"
                      : "border-surface-border bg-surface-elevated hover:border-brand/30"
                  )}
                >
                  <input
                    type="radio"
                    name="experience"
                    value={level.value}
                    checked={form.experienceLevel === level.value}
                    onChange={(e) => setForm({ ...form, experienceLevel: e.target.value })}
                    className="h-4 w-4 text-brand"
                  />
                  <span className="text-sm text-text-primary">{level.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className={cn(
              "w-full rounded-xl py-3.5 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2",
              submitting ? "bg-brand/40 cursor-not-allowed" : "bg-brand hover:bg-brand-hover"
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                提交中...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                提交申请
              </>
            )}
          </button>

          <p className="text-center text-xs text-text-tertiary">
            提交即表示您同意参与内测并反馈真实使用体验
          </p>
        </form>
      </div>
    </div>
  );
}
