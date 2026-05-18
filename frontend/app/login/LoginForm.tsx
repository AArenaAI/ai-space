"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") || "/chat";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "登录失败");
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      // 保存默认工作区
      if (data.default_workspace_id) {
        localStorage.setItem("current-workspace", String(data.default_workspace_id));
      }
      // 登录成功后清除匿名 ID，避免已登录用户被误识别为匿名
      import("@/lib/guestId").then(({ clearGuestId }) => clearGuestId());
      router.push(decodeURIComponent(returnUrl));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center mx-auto mb-4">
            <span className="text-lg font-bold text-text-primary">AI</span>
          </div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">
            登录 AI Space
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            进入你的 AI 工作空间
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
              placeholder="输入密码"
              required
              minLength={6}
              className="w-full px-3 py-2.5 rounded-lg bg-surface-card border border-surface-border text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>

        <p className="text-center text-sm text-text-tertiary mt-6">
          还没有账号？{" "}
          <Link href="/register" className="text-brand hover:underline">
            注册
          </Link>
        </p>
      </div>
    </div>
  );
}
