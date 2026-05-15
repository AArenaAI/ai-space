"use client";

import { useEffect, useState } from "react";
import AppSidebar from "@/components/sidebar/AppSidebar";
import MoreSidebar from "@/components/sidebar/MoreSidebar";

const MORE_PAGES = ["/image/edit", "/templates"];

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /* 初始固定为 false，避免静态导出 hydration mismatch */
  const [isMorePage, setIsMorePage] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pathname = window.location.pathname;
    setIsMorePage(MORE_PAGES.some((p) => pathname.startsWith(p)));
  }, []);

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {/* 侧边栏 - 隐藏在移动端 */}
      <div className="hidden md:flex">
        {isMorePage ? <MoreSidebar /> : <AppSidebar />}
      </div>

      {/* 主内容区 */}
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
