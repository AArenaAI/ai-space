"use client";

import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";

export default function AdminPlaceholderPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="max-w-md rounded-3xl border border-surface-border bg-surface-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
          <Construction className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold text-text-primary">页面建设中</h1>
        <p className="mt-3 text-sm leading-6 text-text-secondary">该模块的 API 边界已预留，后续会接入更完整的数据表格和操作审计。</p>
        <Link href="/admin" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
          <ArrowLeft className="h-4 w-4" />返回总览
        </Link>
      </div>
    </div>
  );
}
