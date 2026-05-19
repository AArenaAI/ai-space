"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import AppSidebar from "@/components/sidebar/AppSidebar";
import ToolsSidebar from "@/components/sidebar/ToolsSidebar";

const TOOLS_PAGES = ["/image", "/templates"];

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /* 初始固定为 false，避免静态导出 hydration mismatch */
  const pathname = usePathname();
  const [isToolsPage, setIsToolsPage] = useState(false);

  useEffect(() => {
    setIsToolsPage(TOOLS_PAGES.some((p) => pathname.startsWith(p)));
  }, [pathname]);

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <div className="hidden md:block shrink-0">
        {isToolsPage ? <ToolsSidebar /> : <AppSidebar />}
      </div>

      {/* 主内容区 */}
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
