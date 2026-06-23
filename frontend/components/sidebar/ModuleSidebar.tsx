"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useCallback, useRef, useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import SidebarUserPanel from "./SidebarUserPanel";

export interface ModuleSidebarItem {
  icon: LucideIcon;
  labelKey: string;
  href: string;
  matchPath: string;
  matchQuery?: string;
}

export interface ModuleSidebarGroup {
  titleKey: string;
  items: ModuleSidebarItem[];
}

interface ModuleSidebarProps {
  groups: ModuleSidebarGroup[];
  storageKey: string;
}

function cleanPathname(pathname: string | null): string {
  let cleaned = (pathname ?? "").replace(/\.html$/, "").split("?")[0];
  if (cleaned !== "/") cleaned = cleaned.replace(/\/$/, "");
  return cleaned;
}

function getQuery(href: string): string | undefined {
  const idx = href.indexOf("?");
  return idx >= 0 ? href.slice(idx + 1) : undefined;
}

export default function ModuleSidebar({ groups, storageKey }: ModuleSidebarProps) {
  const { t } = useI18n();
  const rawPathname = usePathname();
  const pathname = cleanPathname(rawPathname);
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = (searchParams?.toString() || "");
  const handleNewChat = () => router.push(`/chat?t=${Date.now()}`);
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [sidebarTooltip, setSidebarTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 260;
    const saved = localStorage.getItem(storageKey);
    return saved ? Math.max(180, Math.min(500, Number(saved))) : 260;
  });
  const isResizing = useRef(false);
  const displayWidth = collapsed ? 52 : sidebarWidth;

  useEffect(() => {
    groups.forEach((group) => {
      group.items.forEach((item) => router.prefetch(item.href));
    });
  }, [groups, router]);

  useEffect(() => {
    localStorage.setItem(storageKey, String(sidebarWidth));
  }, [sidebarWidth, storageKey]);

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
      <div
        className="hidden h-screen shrink-0 md:block"
        style={{ width: displayWidth }}
      />
      <aside
        className="fixed left-0 top-0 z-40 flex h-screen flex-col rounded-r-2xl border-r border-surface-border bg-surface-elevated transition-[width] duration-200 ease-out"
        style={{ width: displayWidth }}
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-3">
          {!collapsed && (
            <Link href="/" className="flex min-w-0 items-center">
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

        <button
          type="button"
          onClick={handleNewChat}
          title={t("sidebar.backToChat")}
          className={cn(
            "mx-3 mt-3 flex shrink-0 items-center rounded-lg text-sm font-normal text-slate-500 transition-colors hover:bg-surface-card hover:text-slate-900 dark:text-text-secondary dark:hover:text-text-primary",
            collapsed ? "justify-center px-2 py-2.5" : "gap-2 px-3 py-2"
          )}
        >
          <ChevronLeft className="h-4 w-4 shrink-0" />
          {!collapsed && t("sidebar.backToChat")}
        </button>

        <div className="flex-1 space-y-5 overflow-auto px-3 py-3">
          {groups.map((group) => (
            <div key={group.titleKey}>
              {!collapsed && (
                <h3 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-text-tertiary">
                  {t(group.titleKey)}
                </h3>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const hrefQuery = item.matchQuery ?? getQuery(item.href);
                  const active =
                    (pathname === item.matchPath || pathname.startsWith(item.matchPath + "/")) &&
                    (hrefQuery ? search === hrefQuery : true);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={`${item.labelKey}:${item.href}`}
                      href={item.href}
                      title={t(item.labelKey)}
                      className={cn(
                        "flex items-center rounded-xl text-sm font-normal transition-all duration-150",
                        collapsed ? "justify-center px-2 py-2.5" : "gap-2.5 px-3 py-2.5",
                        active
                          ? "bg-surface-card text-slate-900 font-medium shadow-sm dark:text-text-primary"
                          : "text-slate-500 hover:bg-surface-card hover:text-slate-900 dark:text-text-secondary dark:hover:text-text-primary"
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-text-primary" : "text-text-tertiary")} />
                      {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mx-3 h-px shrink-0 bg-surface-border/40" />

        <div className="shrink-0">
          <SidebarUserPanel
            user={user}
            collapsed={collapsed}
            onOpenSettings={() => router.push("/settings")}
            onShowTooltip={showSidebarTooltip}
            onHideTooltip={hideSidebarTooltip}
          />
        </div>

        {!collapsed && (
          <div
            className="group absolute right-0 top-0 z-50 h-full w-2 cursor-col-resize"
            onMouseDown={handleMouseDown}
          >
            <div className="absolute inset-0 -left-1 -right-1 rounded-full transition-all duration-150 group-hover:bg-brand/30 group-active:bg-brand/50" />
          </div>
        )}
        {sidebarTooltip && (
          <div
            className="pointer-events-none fixed z-[100] whitespace-nowrap rounded-lg border border-surface-border bg-surface-card px-2.5 py-1.5 text-xs text-text-primary shadow-lg"
            style={{ top: sidebarTooltip.y, left: sidebarTooltip.x }}
          >
            {sidebarTooltip.text}
          </div>
        )}
      </aside>
    </>
  );
}
