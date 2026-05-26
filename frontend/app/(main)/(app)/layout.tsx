"use client";

import AppSidebar from "@/components/sidebar/AppSidebar";

export default function AppMainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="hidden shrink-0 md:block">
        <AppSidebar />
      </div>
      <main className="min-w-0 flex-1">{children}</main>
    </>
  );
}
