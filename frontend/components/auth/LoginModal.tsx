"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

interface LoginModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onLoginSuccess?: () => void;
}

type Mode = "login" | "register";

export default function LoginModal({ isOpen, onClose, onLoginSuccess }: LoginModalProps) {
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
        setError("两次输入的密码不一致");
        return;
      }
      if (password.length < 6) {
        setError("密码至少 6 位");
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
        throw new Error(data.error || (mode === "login" ? "登录失败" : "注册失败"));
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      // 保存默认工作区
      if (data.default_workspace_id) {
        localStorage.setItem("current-workspace", String(data.default_workspace_id));
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* 背景遮罩 — 未登录时点击无效 */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={canClose ? onClose : undefined}
      />

      {/* 弹窗内容 */}
      <div className="relative w-full max-w-[400px] mx-4 rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl overflow-hidden">
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
            <img src="/brand-logo.png" alt="AI Space" className="w-12 h-12 rounded-xl object-cover mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-text-primary tracking-tight">
              {mode === "login" ? "登录 AI Space" : "注册 AI Space"}
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              {mode === "login" ? "Al Space全球一流模型稳定超体验，一键触达世界。" : "Al Space全球一流模型稳定超体验，一键触达世界。"}
            </p>
          </div>

          {/* Tab 切换 */}
          <div className="flex rounded-lg bg-surface-card border border-surface-border p-0.5 mb-5">
            <button
              onClick={() => switchMode("login")}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${
                mode === "login"
                  ? "bg-surface-elevated text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              登录
            </button>
            <button
              onClick={() => switchMode("register")}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${
                mode === "register"
                  ? "bg-surface-elevated text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              注册
            </button>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* 表单 */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === "register" && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  昵称（可选）
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="怎么称呼你"
                  className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                邮箱
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
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "至少 6 位" : "输入密码"}
                required
                minLength={6}
                className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm"
              />
            </div>

            {mode === "register" && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  确认密码
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入密码"
                  required
                  className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading
                ? mode === "login"
                  ? "登录中..."
                  : "注册中..."
                : mode === "login"
                ? "登录"
                : "注册"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
