"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Bot, ClipboardList, CreditCard, Home, LayoutDashboard, LogOut, Settings, Shield, Users } from "lucide-react";
import { clearAdminSession } from "@/lib/admin/api";
import { cn } from "@/lib/utils";

const ADMIN_BASE = "/admin";

const navItems = [
  { href: ADMIN_BASE, label: "总览", icon: LayoutDashboard, exact: true },
  { href: `${ADMIN_BASE}/users`, label: "用户", icon: Users },
  { href: `${ADMIN_BASE}/usage`, label: "用量", icon: BarChart3 },
  { href: `${ADMIN_BASE}/models`, label: "模型", icon: Bot },
  { href: `${ADMIN_BASE}/tasks`, label: "任务", icon: ClipboardList },
  { href: `${ADMIN_BASE}/beta-applications`, label: "内测申请", icon: Shield },
  { href: `${ADMIN_BASE}/billing`, label: "支付", icon: CreditCard, disabled: true },
  { href: `${ADMIN_BASE}/settings`, label: "设置", icon: Settings, disabled: true },
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
            const active = item.exact ? pathname === item.href : pathname?.startsWith(item.href);
            const Icon = item.icon;
            if (item.disabled) {
              return (
                <div key={item.href} className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-text-tertiary opacity-60">
                  <span className="flex items-center gap-3"><Icon className="h-4 w-4" />{item.label}</span>
                  <span className="text-[10px]">Soon</span>
                </div>
              );
            }
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
