"use client";

import { usePathname } from "next/navigation";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { AdminShell } from "@/components/admin/AdminShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin/login") {
    return <>{children}</>;
  }
  return (
    <AdminGuard>
      <AdminShell>{children}</AdminShell>
    </AdminGuard>
  );
}
