"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import AppSidebar from "@/components/sidebar/AppSidebar";
import MobileNav from "@/components/mobile/MobileNav";

function useAuth() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  const check = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    setIsLoggedIn(!!token);
  }, []);

  useEffect(() => {
    check();
    const handler = () => check();
    window.addEventListener("auth-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("auth-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, [check]);

  return { isLoggedIn };
}

export default function ChatShellLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { isLoggedIn } = useAuth();

  if (isLoggedIn === null) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-surface">
        <div className="flex h-10 w-10 animate-pulse items-center justify-center overflow-hidden rounded-xl border border-surface-border bg-surface-card">
          <img src="/brand-light-logo.png" alt="AI Space" className="block h-full w-full object-cover dark:hidden" />
          <img src="/brand-dark-logo.png" alt="AI Space" className="hidden h-full w-full object-cover dark:block" />
        </div>
        <p className="mt-3 text-sm text-text-secondary">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-elevated">
      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>

      <div className="flex min-h-0 flex-1 p-2 pl-0">
        <div className="hidden shrink-0 md:block">
          <Suspense fallback={null}>
            <AppSidebar />
          </Suspense>
        </div>
        <main className="min-w-0 flex-1 overflow-hidden rounded-[24px] border border-surface-border/70 bg-surface shadow-[0_16px_40px_rgba(15,23,42,0.04)]">
          {children}
        </main>
      </div>
    </div>
  );
}
