"use client";

import WorkToolsSidebar from "@/components/sidebar/WorkToolsSidebar";

export default function WorkLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="hidden shrink-0 md:block">
        <WorkToolsSidebar />
      </div>
      <main className="min-w-0 flex-1">{children}</main>
    </>
  );
}
