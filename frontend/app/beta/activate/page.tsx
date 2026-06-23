"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle, Clock3, Gift, KeyRound, Loader2, Send, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

export default function BetaActivatePage() {
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
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f1edff,transparent_34%),#f7f7f8] px-4 py-10 text-[#111827]">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[520px] items-center justify-center">
          <div className="w-full rounded-[34px] bg-white p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] bg-green-500/10">
              <CheckCircle className="h-10 w-10 text-green-500" />
            </div>
            <h1 className="mt-6 text-2xl font-semibold tracking-[-0.03em]">激活成功</h1>
            <p className="mt-3 text-sm leading-6 text-[#6b7280]">
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

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => router.push("/chat")}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#111827] px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#374151]"
              >
                开始使用 AI Space
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => router.push("/pricing")}
                className="inline-flex flex-1 items-center justify-center rounded-full bg-[#f1f2f4] px-5 py-3.5 text-sm font-semibold text-[#111827] transition-colors hover:bg-[#e5e7eb]"
              >
                查看模型权益
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f1edff,transparent_34%),#f7f7f8] px-4 py-10 text-[#111827]">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[520px] items-center justify-center">
        <div className="w-full rounded-[34px] bg-white p-7 shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
          <div className="text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-[#f1f2f4] px-4 py-2 text-sm font-medium text-[#374151]">
              <Sparkles className="h-4 w-4" />
              内测激活
            </div>
            <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">激活您的内测账号</h1>
            <p className="mt-3 text-sm leading-6 text-[#6b7280]">
              输入邀请码完成绑定，立即获得 AI Space 内测权限和测试额度。
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
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  激活中...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  激活账号
                </>
              )}
            </button>
          </form>

          <div className="mt-6 rounded-2xl border border-[#e5e7eb] p-4 text-center">
            <div className="text-sm font-medium text-[#374151]">没有邀请码？</div>
            <p className="mt-1 text-xs leading-5 text-[#6b7280]">提交申请后，审核通过会通过邮箱通知您。</p>
            <button
              onClick={() => router.push("/beta/apply")}
              className="mt-3 text-sm font-semibold text-[#111827] underline-offset-4 hover:underline"
            >
              提交内测申请
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
