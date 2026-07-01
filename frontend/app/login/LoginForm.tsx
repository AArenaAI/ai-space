"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { getErrorMessage, readApiError } from "@/lib/errors";

export default function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams?.get("returnUrl") || "/chat";
  const safeReturnUrl = returnUrl.startsWith("/") && !returnUrl.startsWith("//") ? returnUrl : "/chat";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const inputClassName = "w-full rounded-[18px] border border-transparent bg-[#f5f6f8] px-4 py-3.5 text-[15px] text-[#111827] outline-none transition-all placeholder:text-[#9ca3af] focus:border-[#d1d5db] focus:bg-white focus:shadow-[0_0_0_4px_rgba(17,24,39,0.05)]";
  const labelClassName = "mb-2 block text-[13px] font-medium text-[#6b7280]";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      toast.error("登录失败", { description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#ececec] p-3 text-[#111827] md:p-5">
      <div className="grid min-h-[calc(100vh-1.5rem)] overflow-hidden rounded-[34px] bg-white shadow-[0_26px_90px_rgba(15,23,42,0.12)] md:min-h-[calc(100vh-2.5rem)] lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden overflow-hidden bg-[#050816] lg:block">
          <div className="absolute left-8 top-8 z-20 flex items-center gap-3">
            <img src="/brand-light-logo.png" alt="AI Space" className="h-9 w-9 object-contain drop-shadow-[0_0_18px_rgba(96,165,250,0.45)]" />
            <span className="text-[15px] font-medium uppercase tracking-[0.16em] text-white/90">AI SPACE</span>
          </div>

          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(37,99,235,0.32),transparent_24%),radial-gradient(circle_at_24%_20%,rgba(124,58,237,0.34),transparent_30%),radial-gradient(circle_at_78%_78%,rgba(14,165,233,0.24),transparent_34%),linear-gradient(135deg,#030712_0%,#07111f_48%,#0b1020_100%)]" />
          <div className="absolute inset-0 opacity-70 [background-image:radial-gradient(circle,rgba(255,255,255,0.95)_1px,transparent_1.4px),radial-gradient(circle,rgba(147,197,253,0.75)_1px,transparent_1.5px)] [background-position:0_0,26px_34px] [background-size:74px_74px,118px_118px]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,transparent_0%,rgba(3,7,18,0.08)_34%,rgba(3,7,18,0.82)_100%)]" />

          <div className="absolute inset-0 flex items-center justify-center">
            <div className="absolute left-1/2 top-1/2 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.20)_0%,rgba(59,130,246,0.10)_28%,transparent_62%)] blur-xl" />
            <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 animate-[spin_42s_linear_infinite] rounded-full border border-dashed border-sky-200/22" />
            <div className="absolute left-1/2 top-1/2 h-[390px] w-[390px] -translate-x-1/2 -translate-y-1/2 animate-[spin_30s_linear_infinite_reverse] rounded-full border border-sky-300/18" />
            <div className="absolute left-1/2 top-1/2 h-[270px] w-[270px] -translate-x-1/2 -translate-y-1/2 animate-[spin_18s_linear_infinite] rounded-full border border-dotted border-white/28" />
            <div className="absolute left-1/2 top-1/2 h-[130px] w-[720px] -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-full bg-gradient-to-r from-transparent via-sky-300/12 to-transparent blur-2xl" />
            <div className="absolute left-[18%] top-[22%] h-2 w-2 animate-ping rounded-full bg-white" />
            <div className="absolute left-[28%] bottom-[24%] h-1.5 w-1.5 animate-pulse rounded-full bg-sky-200" />
            <div className="absolute right-[18%] top-[18%] h-6 w-6 rotate-45 animate-pulse bg-white/90 shadow-[0_0_36px_rgba(255,255,255,0.95)]" />
            <div className="absolute right-[22%] bottom-[22%] h-3 w-3 animate-pulse rounded-full bg-sky-300/90 shadow-[0_0_20px_rgba(125,211,252,0.9)]" />
          </div>

          <div className="absolute left-1/2 top-1/2 z-10 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 px-10 text-center text-white">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-sky-100 shadow-sm ring-1 ring-white/15 backdrop-blur">
              <Sparkles className="h-4 w-4" />
              Multi-model AI workspace
            </div>
            <h2 className="mt-6 text-5xl font-semibold tracking-[-0.06em] text-white drop-shadow-[0_0_32px_rgba(125,211,252,0.28)]">Launch your AI workflow</h2>
            <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-slate-300">从聊天、文档、翻译到图像视频创作，进入你的 AI Space 工作台。</p>
          </div>
        </section>

        <section className="flex min-h-[calc(100vh-1.5rem)] items-center justify-center px-6 py-10 md:min-h-[calc(100vh-2.5rem)] md:px-10">
          <div className="w-full max-w-[430px] rounded-[36px] bg-white p-7 shadow-none md:p-8 lg:shadow-[0_28px_90px_rgba(15,23,42,0.08)]">
            <div className="pb-7 pt-2 text-center">
              <img src="/brand-light-logo.png" alt="AI Space" className="mx-auto mb-4 h-[52px] w-[52px] rounded-[18px] object-cover shadow-sm" />
              <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.04em] text-[#111827]">{t("auth.login.title")}</h1>
              <p className="mt-2 text-[14px] leading-5 text-[#6b7280]">{t("auth.modal.loginSubtitle")}</p>
            </div>

            <div className="mb-5 flex rounded-[22px] bg-[#f1f2f4] p-1.5 text-[15px] font-medium text-[#6b7280]">
              <button type="button" className="flex-1 rounded-[18px] bg-white px-4 py-2.5 text-[#111827] shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
                {t("auth.login")}
              </button>
              <Link href="/register" className="flex-1 rounded-[18px] px-4 py-2.5 text-center transition-all hover:text-[#111827]">
                {t("auth.register")}
              </Link>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={labelClassName}>{t("auth.email")}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={labelClassName}>{t("auth.password")}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.password.placeholder")}
                  required
                  minLength={6}
                  className={inputClassName}
                />
              </div>

              <div className="text-right">
                <Link href="/forgot-password" className="text-xs font-medium text-[#6b7280] underline-offset-4 hover:text-[#111827] hover:underline">
                  忘记密码？邮箱找回
                </Link>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-[#111827] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-[#374151] disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? t("auth.loggingIn") : t("auth.login")}
              </button>
            </form>

            <p className="mt-5 text-center text-sm text-[#9ca3af]">
              {t("auth.noAccount")} <Link href="/register" className="font-medium text-[#111827] underline-offset-4 hover:underline">{t("auth.register")}</Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
