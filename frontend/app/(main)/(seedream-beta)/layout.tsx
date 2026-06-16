"use client";

import SeedreamBetaSidebar from "@/components/sidebar/SeedreamBetaSidebar";

export default function SeedreamBetaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="hidden shrink-0 md:block">
        <SeedreamBetaSidebar />
      </div>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
    </>
  );
}
