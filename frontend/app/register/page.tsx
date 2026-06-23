"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { getErrorMessage, readApiError } from "@/lib/errors";
import { sendAuthEmailCode } from "@/lib/authEmailCode";
import { toast } from "sonner";

export default function RegisterPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (codeCountdown <= 0) return;
    const timer = window.setTimeout(() => setCodeCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [codeCountdown]);

  const handleSendCode = async () => {
    setError("");
    if (!email.trim()) {
      const message = "请先输入邮箱";
      setError(message);
      toast.error("验证码发送失败", { description: message });
      return;
    }
    setCodeLoading(true);
    try {
      await sendAuthEmailCode(email, "register");
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

    if (password !== confirmPassword) {
      const message = t("auth.error.passwordMismatch");
      setError(message);
      toast.error("注册失败", { description: message });
      return;
    }
    if (password.length < 6) {
      const message = t("auth.error.passwordMin");
      setError(message);
      toast.error("注册失败", { description: message });
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, verification_code: verificationCode }),
      });

      if (!res.ok) {
        throw await readApiError(res);
      }
      const data = await res.json();

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      if (data.user?.default_workspace_id) {
        localStorage.setItem("current-workspace", String(data.user.default_workspace_id));
      }
      import("@/lib/guestId").then(({ clearGuestId }) => clearGuestId());
      window.dispatchEvent(new Event("auth-changed"));
      if (data.user?.beta_phase === "" || data.user?.beta_phase === null || data.user?.beta_phase === undefined) {
        router.push("/beta/activate");
      } else {
        router.push("/chat");
      }
    } catch (err) {
      const message = getErrorMessage(err, { module: "auth", fallbackTitle: t("auth.error.registerFailed"), fallbackMessage: t("auth.error.registerFailed") });
      setError(message);
      toast.error("注册失败", { description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center mx-auto mb-4 overflow-hidden">
            <img src="/brand-light-logo.png" alt="AI Space" className="block h-full w-full object-cover dark:hidden" />
            <img src="/brand-dark-logo.png" alt="AI Space" className="hidden h-full w-full object-cover dark:block" />
          </div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t("auth.register.title")}</h1>
          <p className="text-sm text-text-secondary mt-1">{t("auth.subtitle")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">{t("auth.name")}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("auth.name.placeholder")} className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">{t("auth.email")}</label>
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
            <label className="block text-sm font-medium text-text-secondary mb-1.5">{t("auth.password")}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.password.minPlaceholder")} required minLength={6} className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">{t("auth.confirmPassword")}</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t("auth.confirmPassword.placeholder")} required className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm" />
          </div>

          <button type="submit" disabled={loading} className="w-full py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{loading ? t("auth.registering") : t("auth.register")}</button>
        </form>

        <p className="text-center text-sm text-text-tertiary mt-6">
          {t("auth.hasAccount")} <Link href="/login" className="text-brand hover:underline">{t("auth.login")}</Link>
        </p>
      </div>
    </div>
  );
}
