"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { clearAdminSession, getAdminMe, storeAdminSession } from "@/lib/admin/api";
import { readApiError } from "@/lib/errors";
import type { ApiErrorPayload } from "@/lib/errors";

function safeAdminReturnUrl(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/admin";
  if (!value.startsWith("/admin") || value === "/admin/login") return "/admin";
  return value;
}

function getAdminLoginErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const payload = error as ApiErrorPayload;
    if (payload.status === 401 && (payload.message || payload.error)) return payload.message || payload.error || "邮箱或密码错误";
    if (payload.status === 403) return payload.message || payload.error || "当前账号没有后台管理员权限";
  }
  if (error instanceof Error) return error.message;
  return "后台登录失败，请稍后重试";
}

export default function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = safeAdminReturnUrl(searchParams?.get("returnUrl"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw await readApiError(response);
      const data = await response.json();
      if (!data?.token) throw new Error("登录响应缺少 token");

      storeAdminSession(data.token, data.user);
      const { user } = await getAdminMe();
      if (user.role !== "admin") {
        clearAdminSession();
        throw new Error("当前账号没有后台管理员权限");
      }
      storeAdminSession(data.token, user);
      router.replace(returnUrl);
    } catch (err) {
      setError(getAdminLoginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 text-text-primary">
      <div className="w-full max-w-[400px] rounded-3xl border border-surface-border bg-surface-card p-8 shadow-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-brand-glow">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">后台管理登录</h1>
          <p className="mt-2 text-sm leading-6 text-text-secondary">后台使用独立登录态，不会复用或覆盖前台业务账号。</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500 dark:text-red-300">{error}</div>}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">管理员邮箱</label>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" required className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-brand/60" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">密码</label>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" required minLength={6} className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-brand/60" />
          </div>
          <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50">
            <LockKeyhole className="h-4 w-4" />
            {loading ? "正在登录…" : "登录后台"}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between text-sm text-text-tertiary">
          <Link href="/" className="hover:text-text-primary">回到前台</Link>
          <Link href="/login" className="hover:text-text-primary">业务账号登录</Link>
        </div>
      </div>
    </div>
  );
}
