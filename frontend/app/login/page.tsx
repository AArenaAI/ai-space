"use client";

import { Suspense } from "react";
import { useI18n } from "@/lib/i18n";
import LoginForm from "./LoginForm";

function LoginFallback() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="text-center">
        <div className="w-12 h-12 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center mx-auto mb-4 overflow-hidden">
          <img src="/brand-light-logo.png" alt="AI Space" className="block h-full w-full object-cover dark:hidden" />
          <img src="/brand-dark-logo.png" alt="AI Space" className="hidden h-full w-full object-cover dark:block" />
        </div>
        <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t("auth.login.title")}</h1>
        <p className="text-sm text-text-secondary mt-1">{t("common.loading")}</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}
