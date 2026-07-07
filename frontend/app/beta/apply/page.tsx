"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Briefcase, CheckCircle, FileText, Loader2, Mail, Send, Sparkles, User } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api/client";

const INDUSTRIES = [
  { value: "金融", label: "金融从业", icon: "💰" },
  { value: "算法", label: "算法/代码", icon: "💻" },
  { value: "自媒体", label: "自媒体内容", icon: "📝" },
  { value: "高级UI", label: "高级UI设计", icon: "🎨" },
  { value: "其他", label: "其他", icon: "🔧" },
];

const EXPERIENCE_LEVELS = [
  { value: "beginner", label: "入门", desc: "偶尔使用 AI 工具" },
  { value: "intermediate", label: "进阶", desc: "每周使用 AI 辅助工作" },
  { value: "expert", label: "专家", desc: "深度依赖 AI 解决复杂问题" },
];

export default function BetaApplyPage() {
  const router = useRouter();
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
      const res = await apiFetch("/beta/apply", {
        method: "POST",
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
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f1edff,transparent_34%),#f7f7f8] px-4 py-10 text-[#111827]">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[520px] items-center justify-center">
          <div className="w-full rounded-[34px] bg-white p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] bg-green-500/10">
              <CheckCircle className="h-10 w-10 text-green-500" />
            </div>
            <h1 className="mt-6 text-2xl font-semibold tracking-[-0.03em]">申请已提交</h1>
            <p className="mt-3 text-sm leading-6 text-[#6b7280]">
              我们将尽快审核您的申请。审核通过后，您会收到唯一激活码和内测访问说明。
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => router.push("/")}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#111827] px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#374151]"
              >
                返回首页
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => router.push("/beta/activate")}
                className="inline-flex flex-1 items-center justify-center rounded-full bg-[#f1f2f4] px-5 py-3.5 text-sm font-semibold text-[#111827] transition-colors hover:bg-[#e5e7eb]"
              >
                我已有邀请码
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f1edff,transparent_34%),#f7f7f8] px-4 py-10 text-[#111827]">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-[34px] bg-white p-7 shadow-[0_24px_80px_rgba(15,23,42,0.12)] md:p-8">
          <div className="text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-[#f1f2f4] px-4 py-2 text-sm font-medium text-[#374151]">
              <Sparkles className="h-4 w-4" />
              内测白名单申请
            </div>
            <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">
              寻找被大模型“逻辑硬伤”折磨的重度用户
            </h1>
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
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="your@email.com"
                      className={`${inputClassName} pl-11`}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className={labelClassName}>姓名 <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="真实姓名"
                    className={inputClassName}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className={labelClassName}>行业领域 <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {INDUSTRIES.map((ind) => (
                    <button
                      key={ind.value}
                      type="button"
                      onClick={() => setForm({ ...form, industry: ind.value })}
                      className={cn(
                        "flex items-center gap-2 rounded-[18px] px-4 py-3 text-sm transition-all",
                        form.industry === ind.value
                          ? "bg-[#111827] text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)]"
                          : "bg-[#f5f6f8] text-[#374151] hover:bg-[#eef0f3]"
                      )}
                    >
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
                  <input
                    type="text"
                    value={form.jobTitle}
                    onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                    placeholder="例如：量化研究员、前端工程师、内容总监"
                    className={`${inputClassName} pl-11`}
                  />
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
                <textarea
                  value={form.useCase}
                  onChange={(e) => setForm({ ...form, useCase: e.target.value })}
                  placeholder="例如：跨行业宏观量化传导推演、复杂合同条款审计、多步 Agent 调试..."
                  className={`${inputClassName} min-h-[128px] resize-y leading-6`}
                />
              </div>

              <div className="space-y-2">
                <label className={labelClassName}>您是否已有大模型的 Bad Case（逻辑错误案例）？</label>
                <textarea
                  value={form.badCaseSample}
                  onChange={(e) => setForm({ ...form, badCaseSample: e.target.value })}
                  placeholder="描述一次大模型在复杂推理中出错的经历，以及您认为的正确答案..."
                  className={`${inputClassName} min-h-[112px] resize-y leading-6`}
                />
              </div>
            </section>

            <section className="space-y-3">
              <div className="text-base font-semibold">AI 使用经验</div>
              <div className="grid gap-3 md:grid-cols-3">
                {EXPERIENCE_LEVELS.map((level) => (
                  <label
                    key={level.value}
                    className={cn(
                      "cursor-pointer rounded-[18px] p-4 transition-all",
                      form.experienceLevel === level.value
                        ? "bg-[#111827] text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)]"
                        : "bg-[#f5f6f8] text-[#374151] hover:bg-[#eef0f3]"
                    )}
                  >
                    <input
                      type="radio"
                      name="experience"
                      value={level.value}
                      checked={form.experienceLevel === level.value}
                      onChange={(e) => setForm({ ...form, experienceLevel: e.target.value })}
                      className="sr-only"
                    />
                    <div className="text-sm font-semibold">{level.label}</div>
                    <div className={cn("mt-1 text-xs leading-5", form.experienceLevel === level.value ? "text-white/75" : "text-[#6b7280]")}>{level.desc}</div>
                  </label>
                ))}
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

            <p className="text-center text-xs leading-5 text-[#9ca3af]">
              提交即表示您同意参与内测并反馈真实使用体验。审核结果将通过邮箱通知。
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
