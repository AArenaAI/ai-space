"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useI18n } from "@/lib/i18n";
import { getErrorMessage, readApiError } from "@/lib/errors";
import { sendAuthEmailCode } from "@/lib/authEmailCode";
import { toast } from "sonner";

interface LoginModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onLoginSuccess?: (data: any, mode: Mode) => void;
}

type Mode = "login" | "register";

export default function LoginModal({ isOpen, onClose, onLoginSuccess }: LoginModalProps) {
  const { t } = useI18n();
  const themeCtx = useTheme();
  const theme = themeCtx?.theme || "light";
  const [mode, setMode] = useState<Mode>("login");
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
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    if (isOpen) window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  useEffect(() => {
    if (codeCountdown <= 0) return;
    const timer = window.setTimeout(() => setCodeCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [codeCountdown]);

  const reset = () => {
    setError("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setVerificationCode("");
    setCodeSent(false);
    setCodeCountdown(0);
    setName("");
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    reset();
  };

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

    if (mode === "register") {
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
    }

    setLoading(true);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body: any = { email, password };
      if (mode === "register") {
        body.name = name;
        body.verification_code = verificationCode;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw await readApiError(res);
      const data = await res.json();

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      if (data.user?.default_workspace_id) localStorage.setItem("current-workspace", String(data.user.default_workspace_id));
      import("@/lib/guestId").then(({ clearGuestId }) => clearGuestId());
      window.dispatchEvent(new Event("auth-changed"));

      onLoginSuccess?.(data, mode);
      onClose?.();
    } catch (err) {
      const message = getErrorMessage(err, { module: "auth", fallbackMessage: mode === "login" ? t("auth.error.loginFailed") : t("auth.error.registerFailed") });
      setError(message);
      toast.error(mode === "login" ? "登录失败" : "注册失败", { description: message });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;
  const canClose = typeof onClose === "function";
  const inputClassName = "w-full rounded-[18px] border border-transparent bg-[#f5f6f8] px-4 py-3.5 text-[15px] text-[#111827] outline-none transition-all placeholder:text-[#9ca3af] focus:border-[#d1d5db] focus:bg-white focus:shadow-[0_0_0_4px_rgba(17,24,39,0.05)]";
  const labelClassName = "mb-2 block text-[13px] font-medium text-[#6b7280]";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 px-4 py-6 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={canClose ? onClose : undefined} />
      <div className="relative w-full max-w-[430px] rounded-[36px] bg-white p-7 shadow-[0_28px_90px_rgba(15,23,42,0.22)]">
        {canClose && (
          <button
            onClick={onClose}
            className="absolute right-5 top-5 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-[#6b7280] shadow-sm transition-colors hover:bg-white hover:text-[#111827]"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="pb-6 pt-3 text-center">
          <img
            src={theme === "dark" ? "/brand-dark-logo.png" : "/brand-light-logo.png"}
            alt="AI Space"
            className="mx-auto mb-4 h-[52px] w-[52px] rounded-[18px] object-cover shadow-sm"
          />
          <h2 className="text-[25px] font-semibold leading-tight tracking-[-0.03em] text-[#111827]">
            {mode === "login" ? t("auth.login.title") : t("auth.register.title")}
          </h2>
          <p className="mt-2 text-[14px] leading-5 text-[#6b7280]">
            {mode === "login" ? t("auth.modal.loginSubtitle") : t("auth.modal.registerSubtitle")}
          </p>
        </div>

        <div>
          <div className="mb-5 flex rounded-[22px] bg-[#f1f2f4] p-1.5 text-[15px] font-medium text-[#6b7280]">
            <button
              onClick={() => switchMode("login")}
              type="button"
              className={`flex-1 rounded-[18px] px-4 py-2.5 transition-all ${mode === "login" ? "bg-white text-[#111827] shadow-[0_8px_20px_rgba(15,23,42,0.08)]" : "hover:text-[#111827]"}`}
            >
              {t("auth.login")}
            </button>
            <button
              onClick={() => switchMode("register")}
              type="button"
              className={`flex-1 rounded-[18px] px-4 py-2.5 transition-all ${mode === "register" ? "bg-white text-[#111827] shadow-[0_8px_20px_rgba(15,23,42,0.08)]" : "hover:text-[#111827]"}`}
            >
              {t("auth.register")}
            </button>
          </div>

          <div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "register" && (
                <div>
                  <label className={labelClassName}>{t("auth.name")}</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("auth.name.placeholder")}
                    className={inputClassName}
                  />
                </div>
              )}

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

              {mode === "register" && (
                <div>
                  <label className={labelClassName}>邮箱验证码</label>
                  <div className="flex gap-2.5">
                    <input
                      type="text"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="6 位验证码"
                      required
                      inputMode="numeric"
                      className={`${inputClassName} min-w-0 flex-1`}
                    />
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={codeLoading || codeCountdown > 0}
                      className="shrink-0 rounded-[18px] bg-[#111827] px-4 py-3.5 text-[14px] font-medium text-white transition-colors hover:bg-[#374151] disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
                    >
                      {codeLoading ? "发送中" : codeCountdown > 0 ? `${codeCountdown}s` : codeSent ? "重发" : "发送"}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className={labelClassName}>{t("auth.password")}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "register" ? t("auth.password.minPlaceholder") : t("auth.password.placeholder")}
                  required
                  minLength={6}
                  className={inputClassName}
                />
              </div>

              {mode === "register" && (
                <div>
                  <label className={labelClassName}>{t("auth.confirmPassword")}</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t("auth.confirmPassword.placeholder")}
                    required
                    className={inputClassName}
                  />
                </div>
              )}

              {mode === "login" && (
                <div className="text-right">
                  <Link href="/forgot-password" className="text-xs font-medium text-[#6b7280] underline-offset-4 hover:text-[#111827] hover:underline">
                    忘记密码？邮箱找回
                  </Link>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full rounded-full bg-[#111827] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-[#374151] disabled:cursor-not-allowed disabled:bg-[#d1d5db] disabled:text-[#6b7280]"
              >
                {loading ? (mode === "login" ? t("auth.loggingIn") : t("auth.registering")) : (mode === "login" ? t("auth.login") : t("auth.register"))}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
