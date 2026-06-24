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
        <section className="relative hidden overflow-hidden bg-[#e7e7e5] lg:block">
          <div className="absolute left-8 top-8 z-20 flex items-center gap-3">
            <img src="/brand-light-logo.png" alt="AI Space" className="h-9 w-9 object-contain" />
            <span className="text-[15px] font-medium uppercase tracking-[0.16em] text-[#173a5e]">AI SPACE</span>
          </div>

          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.9),transparent_28%),radial-gradient(circle_at_70%_76%,rgba(23,58,94,0.14),transparent_34%)]" />
          <div className="absolute inset-0 opacity-55 [background-image:linear-gradient(rgba(23,58,94,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(23,58,94,0.08)_1px,transparent_1px)] [background-size:56px_56px]" />

          <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2">
            <div className="absolute left-[78px] top-[322px] h-28 w-80 rounded-[100%] bg-[#f97316] shadow-[0_28px_70px_rgba(249,115,22,0.24)]" />
            <div className="absolute left-[120px] top-[265px] h-40 w-72 rounded-[42%_58%_48%_52%] bg-[#f4c542] shadow-[0_24px_70px_rgba(234,179,8,0.24)]" />
            <div className="absolute left-[210px] top-[220px] h-44 w-28 rounded-[28px] bg-[#111827] shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
              <div className="absolute left-6 top-12 h-4 w-4 rounded-full bg-white" />
              <div className="absolute right-6 top-12 h-4 w-4 rounded-full bg-white" />
            </div>
            <div className="absolute left-[275px] top-[112px] h-64 w-28 -rotate-6 rounded-[38px] bg-[#6d28d9] shadow-[0_24px_70px_rgba(109,40,217,0.28)]">
              <div className="absolute left-1/2 top-7 h-7 w-11 -translate-x-1/2 rounded-full bg-[#efe7ff]" />
            </div>

            <div className="absolute left-[93px] top-[86px] h-72 w-72 animate-[spin_22s_linear_infinite] rounded-full border border-dashed border-[#173a5e]/20" />
            <div className="absolute left-[150px] top-[120px] h-52 w-52 animate-[spin_16s_linear_infinite_reverse] rounded-full border border-[#173a5e]/10" />

            <img
              src="/brand-light-logo.png"
              alt="AI Space rocket"
              className="absolute left-[148px] top-[98px] h-40 w-40 -rotate-12 object-contain drop-shadow-[0_30px_38px_rgba(23,58,94,0.25)]"
            />
            <div className="absolute left-[144px] top-[247px] h-24 w-12 -rotate-12 rounded-full bg-gradient-to-b from-[#60a5fa]/60 via-[#93c5fd]/30 to-transparent blur-xl" />
            <div className="absolute left-[88px] top-[140px] h-4 w-4 rounded-full bg-white shadow-[0_0_36px_rgba(255,255,255,0.95)]" />
            <div className="absolute right-[84px] top-[82px] h-8 w-8 rotate-45 bg-white shadow-[0_0_32px_rgba(255,255,255,0.85)]" />
            <div className="absolute right-[112px] bottom-[96px] h-3 w-3 rounded-full bg-[#173a5e]/50" />
          </div>

          <div className="absolute bottom-10 left-10 max-w-md">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-sm font-medium text-[#173a5e] shadow-sm backdrop-blur">
              <Sparkles className="h-4 w-4" />
              Multi-model AI workspace
            </div>
            <h2 className="mt-5 text-4xl font-semibold tracking-[-0.05em] text-[#111827]">Launch your AI workflow</h2>
            <p className="mt-3 text-sm leading-6 text-[#4b5563]">从聊天、文档、翻译到图像视频创作，进入你的 AI Space 工作台。</p>
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
