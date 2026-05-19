"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Image, Eraser, FileText, ChevronLeft, LayoutGrid, Type, ZoomIn, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const MORE_NAV_GROUPS = [
  {
    title: "创建",
    items: [
      {
        icon: ImageIcon,
        label: "生成图片",
        href: "/image",
        matchPath: "/image",
      },
      {
        icon: Image,
        label: "背景移除",
        href: "/image/edit?mode=remove-bg",
        matchPath: "/image/edit",
      },
      {
        icon: Eraser,
        label: "背景替换",
        href: "/image/edit?mode=replace-bg",
        matchPath: "/image/edit",
      },
      {
        icon: Type,
        label: "文字移除",
        href: "/image/edit?mode=text-removal",
        matchPath: "/image/edit",
      },
      {
        icon: ZoomIn,
        label: "画质提升",
        href: "/image/edit?mode=upscale",
        matchPath: "/image/edit",
      },
    ],
  },
  {
    title: "模板",
    items: [
      {
        icon: FileText,
        label: "回答模板",
        href: "/templates",
        matchPath: "/templates",
      },
    ],
  },
];

export default function ToolsSidebar() {
  const pathname = usePathname();
  const [search, setSearch] = useState("");

  useEffect(() => {
    setSearch(window.location.search);
  }, [pathname]);

  return (
    <aside className="w-[260px] h-full bg-surface-elevated border-r border-surface-border flex flex-col shrink-0">
      {/* 头部 */}
      <div className="shrink-0 h-14 flex items-center gap-2 px-4 border-b border-surface-border">
        <LayoutGrid className="w-5 h-5 text-brand" />
        <span className="text-sm font-semibold text-text-primary">更多</span>
      </div>

      {/* 返回 */}
      <Link
        href="/chat"
        className="shrink-0 mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-card transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        返回对话
      </Link>

      {/* 导航分组 */}
      <div className="flex-1 overflow-auto py-3 px-3 space-y-5">
        {MORE_NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2 px-1">
              {group.title}
            </h3>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  (pathname === item.matchPath || pathname === item.matchPath + "/") &&
                  (item.href.includes("?")
                    ? search.includes(item.href.split("?")[1])
                    : true);
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                      active
                        ? "bg-brand/10 text-brand"
                        : "text-text-secondary hover:text-text-primary hover:bg-surface-card"
                    )}
                  >
                    <item.icon className={cn("w-4 h-4 shrink-0", active ? "text-brand" : "text-text-tertiary")} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
