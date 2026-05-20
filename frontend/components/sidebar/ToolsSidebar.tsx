"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useCallback, useRef, useEffect } from "react";
import { Image, Eraser, FileText, ChevronLeft, Type, ZoomIn, ImageIcon, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const handleNewChat = () => router.push(`/chat?t=${Date.now()}`);
  const [collapsed, setCollapsed] = useState(false);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 260;
    const saved = localStorage.getItem("tools-sidebar-width");
    return saved ? Math.max(180, Math.min(500, Number(saved))) : 260;
  });
  const isResizing = useRef(false);
  const displayWidth = collapsed ? 72 : sidebarWidth;

  useEffect(() => {
    localStorage.setItem("tools-sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(180, Math.min(500, startWidth + (ev.clientX - startX)));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [sidebarWidth]);

  return (
    <>
      {/* 占位 div：与 fixed sidebar 保持同宽，撑开文档流 */}
      <div
        className="hidden md:block shrink-0 h-screen"
        style={{ width: displayWidth }}
      />
      <aside
        className="fixed left-0 top-0 z-40 h-screen bg-surface-elevated border-r border-surface-border rounded-r-2xl flex flex-col transition-[width] duration-200 ease-out"
        style={{ width: displayWidth }}
      >
      {/* 头部 */}
      <div className="shrink-0 h-14 flex items-center justify-between px-4 border-b border-surface-border">
        {!collapsed && <img src="/brand-light-title.png" alt="AI Space" className="h-6 w-auto object-contain" />}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
          title={collapsed ? "展开侧边栏" : "收缩侧边栏"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* 返回 */}
      <button
        type="button"
        onClick={handleNewChat}
        title="返回对话"
        className="shrink-0 mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-card transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        {!collapsed && "返回对话"}
      </button>

      {/* 导航分组 */}
      <div className="flex-1 overflow-auto py-3 px-3 space-y-5">
        {MORE_NAV_GROUPS.map((group) => (
          <div key={group.title}>
            {!collapsed && (
              <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2 px-1">
                {group.title}
              </h3>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  (pathname === item.matchPath || pathname === item.matchPath + "/") &&
                  (item.href.includes("?")
                    ? search === item.href.split("?")[1]
                    : true);
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    title={item.label}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                      active
                        ? "bg-brand/10 text-brand"
                        : "text-text-secondary hover:text-text-primary hover:bg-surface-card"
                    )}
                  >
                    <item.icon className={cn("w-4 h-4 shrink-0", active ? "text-brand" : "text-text-tertiary")} />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 拖拽调整宽度手柄 */}
      {!collapsed && (
        <div
          className="absolute top-0 right-0 z-50 w-2 h-full cursor-col-resize group"
          onMouseDown={handleMouseDown}
        >
          <div className="absolute inset-0 -left-1 -right-1 rounded-full transition-all duration-150 group-hover:bg-brand/30 group-active:bg-brand/50" />
        </div>
      )}
    </aside>
    </>
  );
}
