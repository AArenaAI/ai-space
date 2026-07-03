"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { getAdminMe, AdminApiError, clearAdminSession, storeAdminSession } from "@/lib/admin/api";
import { useAuth } from "@/components/auth/AuthProvider";
import type { AdminUser } from "@/lib/admin/types";

type GuardState =
  | { status: "loading" }
  | { status: "allowed"; user: AdminUser }
  | { status: "denied"; message: string };

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<GuardState>({ status: "loading" });
  const auth = useAuth();

  useEffect(() => {
    let cancelled = false;
    const redirectToLogin = () => {
      router.replace(`/admin/login?returnUrl=${encodeURIComponent(pathname || "/admin")}`);
    };

    if (auth.status === "loading") {
      setState({ status: "loading" });
      return () => {
        cancelled = true;
      };
    }

    const verifyAdmin = async () => {
      setState({ status: "loading" });
      if (!auth.token || !auth.user || auth.user.role !== "admin") {
        redirectToLogin();
        return;
      }
      storeAdminSession(auth.token, auth.user as AdminUser);
      try {
        const { user } = await getAdminMe();
        if (cancelled) return;
        setState({ status: "allowed", user });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof AdminApiError && error.status === 401) {
          clearAdminSession();
          redirectToLogin();
          return;
        }
        setState({ status: "denied", message: error instanceof Error ? error.message : "你没有访问后台管理的权限。" });
      }
    };

    verifyAdmin();
    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.token, auth.user, pathname, router]);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-text-secondary">
        <div className="flex items-center gap-3 rounded-2xl border border-surface-border bg-surface-card px-5 py-4 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-brand" />
          <span className="text-sm">正在校验管理员权限…</span>
        </div>
      </div>
    );
  }

  if (state.status === "denied") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-6 text-text-primary">
        <div className="max-w-md rounded-3xl border border-surface-border bg-surface-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold">无权访问后台管理</h1>
          <p className="mt-3 text-sm leading-6 text-text-secondary">{state.message || "当前账号不是管理员，请联系管理员开通权限。"}</p>
          <button
            onClick={() => router.push("/")}
            className="mt-6 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
          >
            回到首页
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
