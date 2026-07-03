"use client";

import { ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

function isAuthPage() {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  return path.startsWith("/login") || path.startsWith("/register") || path.startsWith("/forgot-password") || path.startsWith("/admin/login");
}

export default function AuthBootGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === "loading" && !isAuthPage()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-text-tertiary">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-label="Loading session" />
      </div>
    );
  }
  return <>{children}</>;
}
