"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { getErrorMessage, readApiError } from "@/lib/errors";
import NoticeDialog from "@/components/ui/NoticeDialog";

export default function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams?.get("returnUrl") || "/chat";
  const safeReturnUrl = returnUrl.startsWith("/") && !returnUrl.startsWith("//") ? returnUrl : "/chat";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorDialog, setErrorDialog] = useState<{ title: string; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) throw await readApiError(res);
      const data = await res.json();

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      if (data.user?.default_workspace_id) localStorage.setItem("current-workspace", String(data.user.default_workspace_id));
      import("@/lib/guestId").then(({ clearGuestId }) => clearGuestId());
      window.dispatchEvent(new Event("auth-changed"));
      router.push(decodeURIComponent(safeReturnUrl));
    } catch (err) {
      const message = getErrorMessage(err, { module: "auth", fallbackTitle: t("auth.error.loginFailed"), fallbackMessage: t("auth.error.loginFailed") });
      setError(message);
      setErrorDialog({ title: "登录失败", message });
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
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t("auth.login.title")}</h1>
          <p className="text-sm text-text-secondary mt-1">{t("auth.subtitle")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">{t("auth.email")}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" required className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">{t("auth.password")}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.password.placeholder")} required minLength={6} className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm" />
          </div>
          <button type="submit" disabled={loading} className="w-full py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{loading ? t("auth.loggingIn") : t("auth.login")}</button>
        </form>

        <p className="text-center text-sm text-text-tertiary mt-4"><Link href="/forgot-password" className="text-brand hover:underline">忘记密码？邮箱找回</Link></p>
        <p className="text-center text-sm text-text-tertiary mt-3">{t("auth.noAccount")} <Link href="/register" className="text-brand hover:underline">{t("auth.register")}</Link></p>
      </div>
      <NoticeDialog
        isOpen={!!errorDialog}
        title={errorDialog?.title || "登录失败"}
        description={errorDialog?.message}
        confirmText="我知道了"
        onConfirm={() => setErrorDialog(null)}
      />
    </div>
  );
}
