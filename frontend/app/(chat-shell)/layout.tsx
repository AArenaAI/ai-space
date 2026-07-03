"use client";

import { Suspense, useEffect, useState } from "react";
import AppSidebar from "@/components/sidebar/AppSidebar";
import MobileNav from "@/components/mobile/MobileNav";
import { useFlushOnUnload, useGlobalErrorTracking, usePageDuration } from "@/hooks/useAnalytics";

function useMounted() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return { mounted };
}

export default function ChatShellLayout({ children }: { children: React.ReactNode }) {
  const { mounted } = useMounted();

  // 全局埋点
  usePageDuration();
  useGlobalErrorTracking();
  useFlushOnUnload();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-elevated">
      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>

      <div className="flex min-h-0 flex-1 p-2 pl-0">
        <div className="hidden shrink-0 md:block">
          <Suspense fallback={null}>
            {mounted ? <AppSidebar /> : <div className="w-[272px]" />}
          </Suspense>
        </div>
        <main className="min-w-0 flex-1 overflow-hidden rounded-[24px] border border-surface-border/70 bg-surface shadow-[0_16px_40px_rgba(15,23,42,0.04)]">
          {children}
        </main>
      </div>
    </div>
  );
}
