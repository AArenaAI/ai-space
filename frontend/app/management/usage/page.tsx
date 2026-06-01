"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BarChart3, Coins, RefreshCw, ServerCrash, Zap } from "lucide-react";
import { getAdminUsageLogs, getAdminUsageSummary } from "@/lib/admin/api";
import type { AdminUsageLogsResponse, AdminUsageSummary } from "@/lib/admin/types";
import { formatDateTime, formatNumber, formatRMB } from "@/lib/admin/format";
import { MetricCard } from "@/components/admin/MetricCard";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { cn } from "@/lib/utils";

const ranges = [
  { value: "today", label: "今天" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
];

export default function ManagementUsagePage() {
  const [range, setRange] = useState("7d");
  const [summary, setSummary] = useState<AdminUsageSummary | null>(null);
  const [logs, setLogs] = useState<AdminUsageLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, logData] = await Promise.all([
        getAdminUsageSummary(range),
        getAdminUsageLogs({ page: 1, pageSize: 20 }),
      ]);
      setSummary(summaryData);
      setLogs(logData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载用量数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [range]);

  const maxDailyCost = useMemo(() => Math.max(0.01, ...(summary?.daily || []).map((item) => item.cost_rmb)), [summary]);

  if (loading && !summary) {
    return <div className="rounded-3xl border border-surface-border bg-surface-card p-8 text-text-secondary">正在加载用量数据…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand">Usage & Cost</p>
          <h1 className="mt-1 text-2xl font-semibold text-text-primary">用量成本</h1>
          <p className="mt-2 text-sm text-text-secondary">按模型、Provider、服务类型查看请求、失败率、Token 和 RMB 成本。</p>
        </div>
        <div className="flex items-center gap-2">
          {ranges.map((item) => (
            <button
              key={item.value}
              onClick={() => setRange(item.value)}
              className={cn("rounded-xl px-3 py-2 text-sm transition-colors", range === item.value ? "bg-brand text-white" : "bg-surface-card text-text-secondary hover:text-text-primary")}
            >
              {item.label}
            </button>
          ))}
          <button onClick={load} className="rounded-xl border border-surface-border bg-surface-card p-2 text-text-secondary hover:text-text-primary" aria-label="刷新">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="请求数" value={formatNumber(summary?.requests || 0)} icon={BarChart3} helper={`成功 ${formatNumber(summary?.successes || 0)}`} />
        <MetricCard title="成本" value={formatRMB(summary?.cost_rmb || 0)} icon={Coins} helper="统一用量账本统计" />
        <MetricCard title="失败数" value={formatNumber(summary?.failures || 0)} icon={ServerCrash} helper="非 success 状态" />
        <MetricCard title="Token / 图片" value={formatNumber(summary?.total_tokens || 0)} icon={Zap} helper={`${formatNumber(summary?.image_count || 0)} 张图片`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-3xl border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-text-primary">每日成本趋势</h2>
          <div className="mt-5 space-y-3">
            {(summary?.daily || []).length === 0 ? (
              <div className="rounded-2xl bg-surface-elevated p-5 text-sm text-text-secondary">暂无用量数据</div>
            ) : summary!.daily.map((item) => (
              <div key={item.date} className="grid grid-cols-[90px_1fr_110px] items-center gap-3 text-sm">
                <span className="text-text-tertiary">{item.date.slice(5)}</span>
                <div className="h-3 overflow-hidden rounded-full bg-surface-elevated">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(4, (item.cost_rmb / maxDailyCost) * 100)}%` }} />
                </div>
                <span className="text-right text-text-secondary">{formatRMB(item.cost_rmb)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-text-primary">Provider 分布</h2>
          <div className="mt-4 space-y-3">
            {(summary?.provider_breakdown || []).slice(0, 8).map((item) => (
              <div key={item.name || "unknown"} className="rounded-2xl bg-surface-elevated px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-text-primary">{item.name || "unknown"}</span>
                  <span className="text-text-secondary">{formatNumber(item.requests)} 次</span>
                </div>
                <div className="mt-1 text-xs text-text-tertiary">成本 {formatRMB(item.cost_rmb)} · 失败 {formatNumber(item.failures)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-text-primary">模型成本排行</h2>
          <div className="mt-4 space-y-3">
            {(summary?.top_models || []).map((item) => (
              <div key={`${item.provider}-${item.model}`} className="flex items-center justify-between rounded-2xl bg-surface-elevated px-4 py-3 text-sm">
                <div>
                  <div className="font-medium text-text-primary">{item.model || "unknown"}</div>
                  <div className="text-xs text-text-tertiary">{item.provider || "unknown"} · {formatNumber(item.tokens)} tokens</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-text-primary">{formatRMB(item.cost_rmb)}</div>
                  <div className="text-xs text-text-tertiary">{formatNumber(item.requests)} 次</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-text-primary">服务类型</h2>
          <div className="mt-4 space-y-3">
            {(summary?.service_breakdown || []).map((item) => (
              <div key={item.name || "unknown"} className="flex items-center justify-between rounded-2xl bg-surface-elevated px-4 py-3 text-sm">
                <span className="font-medium text-text-primary">{item.name || "unknown"}</span>
                <span className="text-text-secondary">{formatNumber(item.requests)} 次 · {formatRMB(item.cost_rmb)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-text-primary">最近调用记录</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-text-tertiary">
              <tr><th className="py-3">时间</th><th>用户</th><th>服务</th><th>Provider</th><th>模型</th><th>Token</th><th>成本</th><th>状态</th></tr>
            </thead>
            <tbody className="divide-y divide-surface-border text-text-secondary">
              {(logs?.logs || []).map((log) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap py-3 pr-4">{formatDateTime(log.created_at)}</td>
                  <td className="pr-4">{log.user_id || log.guest_id || "-"}</td>
                  <td className="pr-4">{log.service || "-"}</td>
                  <td className="pr-4">{log.provider || "-"}</td>
                  <td className="max-w-[220px] truncate pr-4">{log.model || "-"}</td>
                  <td className="pr-4">{formatNumber(log.total_tokens)}</td>
                  <td className="pr-4">{formatRMB(log.total_cost_rmb)}</td>
                  <td><StatusBadge tone={log.status === "success" ? "green" : log.status === "failed" ? "red" : "amber"}>{log.status || "unknown"}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
