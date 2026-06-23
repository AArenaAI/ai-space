"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getErrorMessage, readApiError } from "@/lib/errors";
import { sendAuthEmailCode } from "@/lib/authEmailCode";
import { toast } from "sonner";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (codeCountdown <= 0) return;
    const timer = window.setTimeout(() => setCodeCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [codeCountdown]);

  const handleSendCode = async () => {
    setError("");
    setSuccess("");
    if (!email.trim()) {
      const message = "请先输入邮箱";
      setError(message);
      toast.error("验证码发送失败", { description: message });
      return;
    }
    setCodeLoading(true);
    try {
      await sendAuthEmailCode(email, "reset_password");
      setCodeSent(true);
      setCodeCountdown(60);
      toast.success("验证码已发送", { description: "请查收邮箱并填写 6 位验证码。验证码 3 分钟内有效。" });
    } catch (err) {
      const message = getErrorMessage(err, { module: "auth", fallbackMessage: "验证码发送失败，请稍后再试" });
      setError(message);
      toast.error("验证码发送失败", { description: message });
    } finally {
      setCodeLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (password !== confirmPassword) {
      const message = "两次输入的密码不一致";
      setError(message);
      toast.error("重置密码失败", { description: message });
      return;
    }
    if (password.length < 6) {
      const message = "密码至少 6 位";
      setError(message);
      toast.error("重置密码失败", { description: message });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, verification_code: verificationCode, password }),
      });
      if (!res.ok) throw await readApiError(res);
      setSuccess("密码已重置，请重新登录。");
      setTimeout(() => router.push("/login"), 900);
    } catch (err) {
      const message = getErrorMessage(err, { module: "auth", fallbackMessage: "重置密码失败" });
      setError(message);
      toast.error("重置密码失败", { description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-[380px]">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center mx-auto mb-4 overflow-hidden">
            <img src="/brand-light-logo.png" alt="AI Space" className="block h-full w-full object-cover dark:hidden" />
            <img src="/brand-dark-logo.png" alt="AI Space" className="hidden h-full w-full object-cover dark:block" />
          </div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">邮箱找回密码</h1>
          <p className="text-sm text-text-secondary mt-1">验证码确认后可设置新密码</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {success && <div className="px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-500 text-sm">{success}</div>}

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">邮箱</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" required className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">邮箱验证码</label>
            <div className="flex gap-2">
              <input type="text" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 位验证码" required inputMode="numeric" className="min-w-0 flex-1 px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm" />
              <button type="button" onClick={handleSendCode} disabled={codeLoading || codeCountdown > 0} className="shrink-0 px-3 py-2.5 rounded-lg border border-surface-border bg-surface-card text-sm text-text-secondary hover:text-text-primary disabled:opacity-50">{codeLoading ? "发送中" : codeCountdown > 0 ? `${codeCountdown}s` : codeSent ? "重新发送" : "发送验证码"}</button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">新密码</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="至少 6 位" className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">确认新密码</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} placeholder="再次输入新密码" className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm" />
          </div>

          <button type="submit" disabled={loading} className="w-full py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{loading ? "提交中" : "重置密码"}</button>
        </form>

        <p className="text-center text-sm text-text-tertiary mt-6"><Link href="/login" className="text-brand hover:underline">返回登录</Link></p>
      </div>
    </div>
  );
}
