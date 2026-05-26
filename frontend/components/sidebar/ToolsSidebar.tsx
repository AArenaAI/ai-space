"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useCallback, useRef, useEffect } from "react";
import { Image, Eraser, ChevronLeft, Type, ZoomIn, ImageIcon, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import SidebarUserPanel from "./SidebarUserPanel";

const MORE_NAV_GROUPS = [
  {
    titleKey: "sidebar.panel.create",
    items: [
      {
        icon: ImageIcon,
        labelKey: "image.generateImage",
        href: "/image",
        matchPath: "/image",
      },
      {
        icon: Image,
        labelKey: "image.edit.removeBg",
        href: "/image/edit?mode=remove-bg",
        matchPath: "/image/edit",
      },
      {
        icon: Eraser,
        labelKey: "image.edit.replaceBg",
        href: "/image/edit?mode=replace-bg",
        matchPath: "/image/edit",
      },
      {
        icon: Type,
        labelKey: "image.edit.textRemoval",
        href: "/image/edit?mode=text-removal",
        matchPath: "/image/edit",
      },
      {
        icon: ZoomIn,
        labelKey: "image.edit.upscale",
        href: "/image/edit?mode=upscale",
        matchPath: "/image/edit",
      },
    ],
  },
];

export default function ToolsSidebar() {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const handleNewChat = () => router.push(`/chat?t=${Date.now()}`);
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [sidebarTooltip, setSidebarTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

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

  useEffect(() => {
    const refreshUser = () => {
      const stored = localStorage.getItem("user");
      if (!stored) {
        setUser(null);
        return;
      }
      try { setUser(JSON.parse(stored)); } catch { setUser(null); }
    };
    refreshUser();
    window.addEventListener("user-login", refreshUser);
    window.addEventListener("user-logout", refreshUser);
    window.addEventListener("storage", refreshUser);
    return () => {
      window.removeEventListener("user-login", refreshUser);
      window.removeEventListener("user-logout", refreshUser);
      window.removeEventListener("storage", refreshUser);
    };
  }, []);

  const showSidebarTooltip = (text: string) => (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSidebarTooltip({ text, x: rect.right + 8, y: rect.top + rect.height / 2 - 14 });
  };
  const hideSidebarTooltip = () => setSidebarTooltip(null);

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
        {!collapsed && (
          <Link href="/" className="flex items-center">
            <img src="/brand-light-title.png" alt="AI Space" className="h-6 w-auto object-contain" />
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
          title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* 返回 */}
      <button
        type="button"
        onClick={handleNewChat}
        title={t("sidebar.backToChat")}
        className="shrink-0 mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-normal text-slate-500 hover:text-slate-900 hover:bg-surface-card transition-colors dark:text-text-secondary dark:hover:text-text-primary"
      >
        <ChevronLeft className="w-4 h-4" />
        {!collapsed && t("sidebar.backToChat")}
      </button>

      {/* 导航分组 */}
      <div className="flex-1 overflow-auto py-3 px-3 space-y-5">
        {MORE_NAV_GROUPS.map((group) => (
          <div key={group.titleKey}>
            {!collapsed && (
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2 px-1 dark:text-text-tertiary">
                {t(group.titleKey)}
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
                    key={item.labelKey}
                    href={item.href}
                    title={t(item.labelKey)}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-normal transition-all duration-150",
                      active
                        ? "bg-surface-card text-slate-900 font-medium shadow-sm dark:text-text-primary"
                        : "text-slate-500 hover:text-slate-900 hover:bg-surface-card dark:text-text-secondary dark:hover:text-text-primary"
                    )}
                  >
                    <item.icon className={cn("w-4 h-4 shrink-0", active ? "text-text-primary" : "text-text-tertiary")} />
                    {!collapsed && <span>{t(item.labelKey)}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 mx-3 h-px bg-surface-border/40" />

      <div className="shrink-0">
        <SidebarUserPanel
          user={user}
          collapsed={collapsed}
          onOpenSettings={() => router.push("/settings")}
          onShowTooltip={showSidebarTooltip}
          onHideTooltip={hideSidebarTooltip}
        />
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
      {sidebarTooltip && (
        <div
          className="fixed z-[100] px-2.5 py-1.5 rounded-lg bg-surface-card border border-surface-border text-xs text-text-primary whitespace-nowrap shadow-lg pointer-events-none"
          style={{ top: sidebarTooltip.y, left: sidebarTooltip.x }}
        >
          {sidebarTooltip.text}
        </div>
      )}
    </aside>
    </>
  );
}
