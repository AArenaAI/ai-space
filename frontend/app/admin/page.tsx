"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Bot, Clock, DollarSign, Loader2, Users, Zap } from "lucide-react";
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
    </div>
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
