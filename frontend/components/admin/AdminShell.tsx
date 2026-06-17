"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Bell, Bot, ClipboardList, CreditCard, Home, LayoutDashboard, LogOut, Settings, Shield, Users } from "lucide-react";
import { clearAdminSession } from "@/lib/admin/api";
import { cn } from "@/lib/utils";

const ADMIN_BASE = "/admin";

const navItems = [
  { href: ADMIN_BASE, label: "总览", icon: LayoutDashboard, exact: true },
  { href: `${ADMIN_BASE}/users`, label: "用户", icon: Users },
  { href: `${ADMIN_BASE}/usage`, label: "用量", icon: BarChart3 },
  { href: `${ADMIN_BASE}/models`, label: "模型", icon: Bot },
  { href: `${ADMIN_BASE}/tasks`, label: "任务", icon: ClipboardList },
  {
    label: "内测运营",
    icon: Shield,
    children: [
      { href: `${ADMIN_BASE}/beta-applications`, label: "内测申请" },
      { href: `${ADMIN_BASE}/beta-invites`, label: "邀请码" },
      { href: `${ADMIN_BASE}/beta-configs`, label: "内测配置" },
      { href: `${ADMIN_BASE}/changelogs`, label: "更新日志" },
    ],
  },
  { href: `${ADMIN_BASE}/billing`, label: "支付", icon: CreditCard, disabled: true },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const handleLogout = () => {
    clearAdminSession();
    router.push("/admin/login");
  };

  return (
    <div className="min-h-screen bg-surface text-text-primary">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-surface-border bg-surface-card/95 px-4 py-5 backdrop-blur lg:flex lg:flex-col">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand text-white shadow-brand-glow">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">AI Space Admin</div>
            <div className="text-xs text-text-tertiary">运营管理控制台</div>
          </div>
        </div>

        <nav className="mt-8 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            if ("children" in item) {
              // 有子菜单的项
              const isGroupActive = item.children?.some((c) => pathname?.startsWith(c.href));
              return (
                <div key={item.label} className="space-y-1">
                  <div
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                      isGroupActive ? "text-brand" : "text-text-secondary"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </div>
                  <div className="ml-6 space-y-0.5 border-l border-surface-border pl-3">
                    {item.children?.map((child) => {
                      const childActive = pathname?.startsWith(child.href);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                            childActive
                              ? "bg-brand/10 text-brand font-medium"
                              : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                          )}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            }
            if (item.disabled) {
              return (
                <div key={item.href} className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-text-tertiary opacity-60">
                  <span className="flex items-center gap-3"><Icon className="h-4 w-4" />{item.label}</span>
                  <span className="text-[10px]">Soon</span>
                </div>
              );
            }
            const active = item.exact ? pathname === item.href : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "bg-brand text-white shadow-sm" : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2">
          <Link href="/" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary">
            <Home className="h-4 w-4" />回到前台
          </Link>
          <button onClick={handleLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary">
            <LogOut className="h-4 w-4" />退出登录
          </button>
        </div>
      </aside>

      <main className="lg:pl-64">
        <div className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
