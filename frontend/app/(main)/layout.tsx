"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import AppSidebar from "@/components/sidebar/AppSidebar";
import MoreSidebar from "@/components/sidebar/MoreSidebar";

const MORE_PAGES = ["/image/edit", "/templates"];
const HOVER_RAIL_PAGES = ["/workspace"];

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /* 初始固定为 false，避免静态导出 hydration mismatch */
  const pathname = usePathname();
  const [isMorePage, setIsMorePage] = useState(false);
  const [isHoverRailPage, setIsHoverRailPage] = useState(false);

  useEffect(() => {
    setIsMorePage(MORE_PAGES.some((p) => pathname.startsWith(p)));
    setIsHoverRailPage(HOVER_RAIL_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`)));
  }, [pathname]);

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {/* workspace空间：左侧保留汉堡压缩区，hover 展开完整侧边栏 */}
      {isHoverRailPage ? (
        <div className="group/sidebar fixed left-0 top-0 z-40 hidden h-screen w-14 md:block">
          <div className="absolute inset-y-0 left-0 flex w-14 flex-col items-center border-r border-surface-border bg-surface-elevated/95 pt-4 shadow-xl backdrop-blur-xl transition-opacity duration-150 group-hover/sidebar:opacity-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-surface-border bg-surface-card text-text-secondary">
              <Menu className="h-5 w-5" />
            </div>
            <div className="mt-2 h-12 w-px rounded-full bg-surface-border" />
            <span className="mt-2 [writing-mode:vertical-rl] text-[10px] tracking-[0.2em] text-text-tertiary">MENU</span>
          </div>
          <div className="absolute inset-y-0 left-0 -translate-x-full opacity-0 shadow-2xl transition-all duration-200 group-hover/sidebar:translate-x-0 group-hover/sidebar:opacity-100">
            {isMorePage ? <MoreSidebar /> : <AppSidebar />}
          </div>
        </div>
      ) : (
        <div className="hidden md:flex">
          {isMorePage ? <MoreSidebar /> : <AppSidebar />}
        </div>
      )}

      {/* 主内容区 */}
      <main className={`flex-1 min-w-0 ${isHoverRailPage ? "md:pl-14" : ""}`}>{children}</main>
    </div>
  );
}
