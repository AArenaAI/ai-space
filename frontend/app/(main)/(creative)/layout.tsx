"use client";

import ToolsSidebar from "@/components/sidebar/ToolsSidebar";

export default function CreativeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="hidden shrink-0 md:block">
        <ToolsSidebar />
      </div>
      <main className="min-w-0 flex-1">{children}</main>
    </>
  );
}
