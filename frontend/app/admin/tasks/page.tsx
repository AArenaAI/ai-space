"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ClipboardList, RefreshCw, Search, ServerCrash } from "lucide-react";
import { getAdminTasks } from "@/lib/admin/api";
import type { AdminTasksResponse } from "@/lib/admin/types";
import { MetricCard } from "@/components/admin/MetricCard";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { formatDateTime, formatNumber } from "@/lib/admin/format";
import { cn } from "@/lib/utils";

const statuses = ["all", "running", "streaming", "retrying", "completed", "failed", "cancelled", "incomplete"];

export default function ManagementTasksPage() {
  const [status, setStatus] = useState("all");
  const [data, setData] = useState<AdminTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAdminTasks({ page: 1, pageSize: 30, status: status === "all" ? undefined : status });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载任务列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [status]);

  const runningCount = data?.summary?.filter((item) => ["running", "streaming", "retrying"].includes(item.status)).reduce((sum, item) => sum + item.count, 0) || 0;
  const failedCount = data?.summary?.find((item) => item.status === "failed")?.count || 0;
  const completedCount = data?.summary?.find((item) => item.status === "completed")?.count || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand">Task Monitor</p>
          <h1 className="mt-1 text-2xl font-semibold text-text-primary">任务监控</h1>
          <p className="mt-2 text-sm text-text-secondary">查看后台 AI 任务状态、失败原因、Provider/Model 和关联会话消息。</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
          <RefreshCw className="h-4 w-4" />刷新
        </button>
      </div>

      {error && <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300"><AlertCircle className="h-4 w-4" />{error}</div>}

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="任务总数" value={formatNumber(data?.total || 0)} icon={ClipboardList} helper="当前筛选结果" />
        <MetricCard title="运行中" value={formatNumber(runningCount)} icon={RefreshCw} helper="running / streaming / retrying" />
        <MetricCard title="失败" value={formatNumber(failedCount)} icon={ServerCrash} helper="failed" />
        <MetricCard title="完成" value={formatNumber(completedCount)} icon={ClipboardList} helper="completed" />
      </div>

      <section className="rounded-3xl border border-surface-border bg-surface-card p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap gap-2">
          {statuses.map((item) => (
            <button key={item} onClick={() => setStatus(item)} className={cn("rounded-xl px-3 py-2 text-sm transition-colors", status === item ? "bg-brand text-white" : "bg-surface-elevated text-text-secondary hover:text-text-primary")}>{item === "all" ? "全部" : item}</button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-text-tertiary">
              <tr><th className="py-3">ID</th><th>状态</th><th>用户</th><th>Provider</th><th>模型</th><th>会话/消息</th><th>错误</th><th>创建时间</th><th>更新时间</th></tr>
            </thead>
            <tbody className="divide-y divide-surface-border text-text-secondary">
              {loading ? (
                <tr><td colSpan={9} className="py-8 text-center text-text-tertiary">正在加载任务…</td></tr>
              ) : (data?.tasks || []).length === 0 ? (
                <tr><td colSpan={9} className="py-8 text-center text-text-tertiary"><Search className="mx-auto mb-2 h-5 w-5" />暂无任务</td></tr>
              ) : data!.tasks.map((task) => (
                <tr key={task.id}>
                  <td className="whitespace-nowrap py-3 pr-4 font-mono text-xs">#{task.id}</td>
                  <td className="pr-4"><StatusBadge tone={task.status === "completed" ? "green" : task.status === "failed" ? "red" : ["running", "streaming", "retrying"].includes(task.status) ? "blue" : "neutral"}>{task.status || "unknown"}</StatusBadge></td>
                  <td className="pr-4">{task.user_id || task.guest_id || "-"}</td>
                  <td className="pr-4">{task.provider || "-"}</td>
                  <td className="max-w-[220px] truncate pr-4">{task.model || "-"}</td>
                  <td className="pr-4 text-xs text-text-tertiary">C:{task.conversation_id || "-"} / M:{task.assistant_message_id || "-"}</td>
                  <td className="max-w-[260px] truncate pr-4 text-xs text-red-500/80">{task.error_message || "-"}</td>
                  <td className="whitespace-nowrap pr-4">{formatDateTime(task.created_at)}</td>
                  <td className="whitespace-nowrap">{formatDateTime(task.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
