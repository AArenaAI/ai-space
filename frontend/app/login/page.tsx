"use client";

import { Suspense } from "react";
import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-surface px-4">
        <div className="w-full max-w-[360px] text-center">
          <div className="w-12 h-12 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-lg font-bold text-text-primary">AI</span>
          </div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">登录 AI Space</h1>
          <p className="text-sm text-text-secondary mt-1">加载中...</p>
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
