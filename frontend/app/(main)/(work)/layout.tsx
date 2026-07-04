"use client";

import { usePathname } from "next/navigation";
import WorkToolsSidebar from "@/components/sidebar/WorkToolsSidebar";

export default function WorkLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStandaloneTool = pathname?.startsWith("/gaokao-volunteer");

  if (isStandaloneTool) {
    return <main className="min-w-0 flex-1">{children}</main>;
  }

  return (
    <>
      <div className="hidden shrink-0 md:block">
        <WorkToolsSidebar />
      </div>
      <main className="min-w-0 flex-1">{children}</main>
    </>
  );
}
