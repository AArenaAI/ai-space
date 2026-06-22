"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Bot, Clock, DollarSign, Loader2, Shield, Tag, Users, Zap } from "lucide-react";
import Link from "next/link";
import { getAdminOverview } from "@/lib/admin/api";
import type { AdminOverview } from "@/lib/admin/types";
import { formatNumber, formatRMB } from "@/lib/admin/format";
import { MetricCard } from "@/components/admin/MetricCard";
import { StatusBadge } from "@/components/admin/StatusBadge";

export default function AdminOverviewPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getAdminOverview()
      .then((overview) => {
        if (!cancelled) setData(overview);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载后台总览失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <LoadingBlock label="正在加载后台总览…" />;
  }

  if (error || !data) {
    return <ErrorBlock message={error || "后台总览数据为空"} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="后台总览" description="查看用户增长、今日用量、成本与任务状态。" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="总用户数" value={formatNumber(data.users.total)} helper={`今日新增 ${formatNumber(data.users.today_new)} 人`} icon={Users} tone="blue" />
        <MetricCard title="今日请求" value={formatNumber(data.usage.today_requests)} helper={`失败 ${formatNumber(data.usage.today_failures)} 次`} icon={Zap} tone="green" />
        <MetricCard title="今日成本" value={formatRMB(data.usage.today_cost_rmb)} helper="基于 api_usage_logs 汇总" icon={DollarSign} tone="amber" />
        <MetricCard title="运行中任务" value={formatNumber(data.tasks.running)} helper={`今日失败 ${formatNumber(data.tasks.failed_today)} 个`} icon={Clock} tone="purple" />
      </div>

      {/* 内测运营数据 */}
      {data.beta && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Link href="/admin/beta-applications" className="block">
            <MetricCard
              title="待审核申请"
              value={formatNumber(data.beta.pending_applications)}
              helper={`今日新增 ${formatNumber(data.beta.today_applications)} 条`}
              icon={Shield}
              tone="red"
            />
          </Link>
          <Link href="/admin/beta-invites" className="block">
            <MetricCard
              title="可用邀请码"
              value={formatNumber(data.beta.active_invites)}
              helper={`总计 ${formatNumber(data.beta.total_invites)} 个`}
              icon={Tag}
              tone="green"
            />
          </Link>
          <Link href="/admin/beta-applications" className="block">
            <MetricCard
              title="待处理 Bad Case"
              value={formatNumber(data.beta.pending_bad_cases)}
              helper="需要审核并发放额度"
              icon={AlertCircle}
              tone="amber"
            />
          </Link>
        </div>
      )}

      <section className="rounded-2xl border border-surface-border bg-surface-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">今日成本最高模型</h2>
            <p className="mt-1 text-sm text-text-tertiary">帮助快速定位成本热点和高频模型。</p>
          </div>
          <StatusBadge tone="blue">Today</StatusBadge>
        </div>
        <div className="mt-5 overflow-hidden rounded-xl border border-surface-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-elevated text-xs uppercase text-text-tertiary">
              <tr>
                <th className="px-4 py-3 font-medium">模型</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">请求数</th>
                <th className="px-4 py-3 font-medium">成本</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {data.models.top_by_cost.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-text-tertiary">今日暂无用量记录</td></tr>
              ) : data.models.top_by_cost.map((item, index) => (
                <tr key={`${item.provider}-${item.model}-${index}`} className="hover:bg-surface-elevated/60">
                  <td className="px-4 py-3 font-medium text-text-primary">{item.model || "unknown"}</td>
                  <td className="px-4 py-3 text-text-secondary">{item.provider || "unknown"}</td>
                  <td className="px-4 py-3 text-text-secondary">{formatNumber(item.requests)}</td>
                  <td className="px-4 py-3 text-text-primary">{formatRMB(item.cost_rmb)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 快捷操作 */}
      {data.beta && (
        <section className="rounded-2xl border border-surface-border bg-surface-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-text-primary">快捷操作</h2>
              <p className="mt-1 text-sm text-text-tertiary">一键处理常见内测运营任务。</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <QuickActionCard
              title="生成邀请码"
              description="批量生成新的内测邀请码"
              href="/admin/beta-invites"
              icon={Tag}
              tone="green"
            />
            <QuickActionCard
              title="审核申请"
              description={`当前有 ${data.beta.pending_applications} 条待审核申请`}
              href="/admin/beta-applications"
              icon={Shield}
              tone="amber"
              badge={data.beta.pending_applications > 0 ? String(data.beta.pending_applications) : undefined}
            />
            <QuickActionCard
              title="处理 Bad Case"
              description={`当前有 ${data.beta.pending_bad_cases} 条待处理`}
              href="/admin/beta-applications?tab=badcases"
              icon={AlertCircle}
              tone="red"
              badge={data.beta.pending_bad_cases > 0 ? String(data.beta.pending_bad_cases) : undefined}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function QuickActionCard({ title, description, href, icon: Icon, tone, badge }: { title: string; description: string; href: string; icon: React.ComponentType<{ className?: string }>; tone: string; badge?: string }) {
  const toneMap: Record<string, { bg: string; text: string; hover: string }> = {
    teal: { bg: "bg-teal-500/10", text: "text-teal-400", hover: "hover:bg-teal-500/20" },
    amber: { bg: "bg-amber-500/10", text: "text-amber-400", hover: "hover:bg-amber-500/20" },
    red: { bg: "bg-red-500/10", text: "text-red-400", hover: "hover:bg-red-500/20" },
  };
  const t = toneMap[tone] || toneMap.teal;
  return (
    <Link href={href} className={`flex items-center gap-3 rounded-xl border border-surface-border p-4 transition-colors hover:border-surface-elevated ${t.hover}`}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${t.bg} ${t.text}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-text-primary">{title}</h3>
          {badge && (
            <span className="bg-red-500/20 text-red-400 text-xs px-1.5 py-0.5 rounded-full font-medium">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-text-tertiary truncate">{description}</p>
      </div>
    </Link>
  );
}

function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-3xl border border-surface-border bg-surface-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">{title}</h1>
          <p className="mt-2 text-sm text-text-secondary">{description}</p>
        </div>
        <div className="hidden h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand sm:flex">
          <Bot className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return <div className="flex h-72 items-center justify-center rounded-3xl border border-surface-border bg-surface-card text-sm text-text-secondary"><Loader2 className="mr-2 h-4 w-4 animate-spin text-brand" />{label}</div>;
}

function ErrorBlock({ message }: { message: string }) {
  return <div className="flex h-72 flex-col items-center justify-center rounded-3xl border border-red-500/20 bg-red-500/5 text-sm text-red-600"><AlertCircle className="mb-2 h-5 w-5" />{message}</div>;
}
