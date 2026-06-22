"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { getErrorMessage, readApiError } from "@/lib/errors";

export default function RegisterPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t("auth.error.passwordMismatch"));
      return;
    }
    if (password.length < 6) {
      setError(t("auth.error.passwordMin"));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
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
      // 注册成功后清除匿名 ID，避免已登录用户被误识别为匿名
      import("@/lib/guestId").then(({ clearGuestId }) => clearGuestId());
      window.dispatchEvent(new Event("auth-changed"));
      // 新注册用户需要激活内测权限，引导到激活页面
      if (data.user?.beta_phase === "" || data.user?.beta_phase === null || data.user?.beta_phase === undefined) {
        router.push("/beta/activate");
      } else {
        router.push("/chat");
      }
    } catch (err) {
      setError(getErrorMessage(err, { module: "auth", fallbackTitle: t("auth.error.registerFailed"), fallbackMessage: t("auth.error.registerFailed") }));
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
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">
            {t("auth.register.title")}
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            {t("auth.subtitle")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              {t("auth.name")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("auth.name.placeholder")}
              className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              {t("auth.email")}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              {t("auth.password")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("auth.password.minPlaceholder")}
              required
              minLength={6}
              className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              {t("auth.confirmPassword")}
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("auth.confirmPassword.placeholder")}
              required
              className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? t("auth.registering") : t("auth.register")}
          </button>
        </form>

        <p className="text-center text-sm text-text-tertiary mt-6">
          {t("auth.hasAccount")}{" "}
          <Link href="/login" className="text-brand hover:underline">
            {t("auth.login")}
          </Link>
        </p>
      </div>
    </div>
  );
}
