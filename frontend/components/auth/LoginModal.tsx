"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useI18n } from "@/lib/i18n";

interface LoginModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onLoginSuccess?: () => void;
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
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ESC 关闭
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    if (isOpen) window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // 禁止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const reset = () => {
    setError("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setName("");
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    reset();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "register") {
      if (password !== confirmPassword) {
        setError(t("auth.error.passwordMismatch"));
        return;
      }
      if (password.length < 6) {
        setError(t("auth.error.passwordMin"));
        return;
      }
    }

    setLoading(true);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body: any = { email, password };
      if (mode === "register") body.name = name;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (mode === "login" ? t("auth.error.loginFailed") : t("auth.error.registerFailed")));
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      // 保存默认工作区
      if (data.user?.default_workspace_id) {
        localStorage.setItem("current-workspace", String(data.user.default_workspace_id));
      }

      // 触发全局登录状态更新
      window.dispatchEvent(new Event("auth-changed"));

      onLoginSuccess?.();
      onClose?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // 未登录时禁止关闭（无 onClose 回调）
  const canClose = typeof onClose === "function";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      {/* 背景遮罩 — 未登录时点击无效 */}
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-md"
        onClick={canClose ? onClose : undefined}
      />

      {/* 弹窗内容 */}
      <div className="relative w-full max-w-[420px] rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl overflow-hidden">
        <div className="h-1 w-full bg-brand" />
        {/* 关闭按钮 — 未登录时隐藏 */}
        {canClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors z-10"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <div className="px-6 py-6">
          {/* Logo */}
          <div className="text-center mb-6">
            <img src={theme === "dark" ? "/brand-dark-logo.png" : "/brand-light-logo.png"} alt="AI Space" className="w-14 h-14 rounded-2xl object-cover mx-auto mb-4 border border-surface-border shadow-sm" />
            <div className="inline-flex items-center rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-text-tertiary mb-3">
              {t("auth.modal.badge")}
            </div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">
              {mode === "login" ? t("auth.login.title") : t("auth.register.title")}
            </h2>
            <p className="text-sm text-text-secondary mt-2">
              {mode === "login" ? t("auth.modal.loginSubtitle") : t("auth.modal.registerSubtitle")}
            </p>
          </div>

          {/* Tab 切换 */}
          <div className="flex rounded-xl bg-surface-card border border-surface-border p-1 mb-5">
            <button
              onClick={() => switchMode("login")}
              type="button"
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === "login"
                  ? "bg-surface-elevated text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {t("auth.login")}
            </button>
            <button
              onClick={() => switchMode("register")}
              type="button"
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === "register"
                  ? "bg-surface-elevated text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {t("auth.register")}
            </button>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="mb-4 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* 表单 */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === "register" && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  {t("auth.name")}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("auth.name.placeholder")}
                  className="w-full px-3.5 py-3 rounded-xl bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm"
                />
              </div>
            )}

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
                className="w-full px-3.5 py-3 rounded-xl bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm"
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
                placeholder={mode === "register" ? t("auth.password.minPlaceholder") : t("auth.password.placeholder")}
                required
                minLength={6}
                className="w-full px-3.5 py-3 rounded-xl bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm"
              />
            </div>

            {mode === "register" && (
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
                  className="w-full px-3.5 py-3 rounded-xl bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {loading
                ? mode === "login"
                  ? t("auth.loggingIn")
                  : t("auth.registering")
                : mode === "login"
                ? t("auth.login")
                : t("auth.register")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
