"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Send, Loader2, CheckCircle, Sparkles, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export default function BetaActivatePage() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) {
      setError("请输入邀请码");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch("/api/beta/use-invite", {
        method: "POST",
        headers,
        body: JSON.stringify({ code: inviteCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "激活失败");
      }
      // 更新本地用户信息
      const raw = localStorage.getItem("user");
      if (raw) {
        const user = JSON.parse(raw);
        user.beta_phase = data.phase || "phase_1";
        user.beta_batch = data.beta_batch || data.batch || user.beta_batch;
        localStorage.setItem("user", JSON.stringify(user));
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "激活失败");
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
          <h1 className="text-2xl font-bold text-text-primary">激活成功</h1>
          <p className="text-text-secondary">
            您的内测权限已激活，可以开始使用 AI Space 了。
          </p>
          <button
            onClick={() => router.push("/chat")}
            className="rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-hover transition-colors inline-flex items-center gap-2"
          >
            进入聊天
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand/10 border border-brand/20 px-4 py-1.5 text-sm text-brand">
            <Sparkles className="h-4 w-4" />
            内测激活
          </div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">
            激活您的内测账号
          </h1>
          <p className="text-text-secondary text-sm">
            注册成功！您需要邀请码才能使用 AI Space 的模型服务。
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">
              邀请码
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="请输入您的邀请码"
                className="w-full rounded-xl border border-surface-border bg-surface-elevated pl-10 pr-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>
          </div>

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

        {/* Alternative */}
        <div className="text-center space-y-3">
          <div className="text-sm text-text-tertiary">没有邀请码？</div>
          <button
            onClick={() => router.push("/beta/apply")}
            className="text-sm text-brand hover:underline font-medium"
          >
            提交内测申请
          </button>
        </div>
      </div>
    </div>
  );
}
