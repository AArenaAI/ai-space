"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import AppSidebar from "@/components/sidebar/AppSidebar";
import MobileNav from "@/components/mobile/MobileNav";
import { ChangelogBell } from "@/components/changelog/ChangelogBell";

function useAuth() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return !!localStorage.getItem("token");
  });

  useEffect(() => {
    const handler = () => {
      setIsLoggedIn(!!localStorage.getItem("token"));
    };
    window.addEventListener("auth-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("auth-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  return { isLoggedIn };
}

export default function ChatShellLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { isLoggedIn } = useAuth();

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
