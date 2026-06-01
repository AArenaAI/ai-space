"use client";

import { Suspense } from "react";
import AdminLoginForm from "./AdminLoginForm";

function AdminLoginFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="text-center text-text-secondary">正在加载后台登录…</div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<AdminLoginFallback />}>
      <AdminLoginForm />
    </Suspense>
  );
}
