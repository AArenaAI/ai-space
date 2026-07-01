"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ClipboardList, ExternalLink, Eye, PauseCircle, PlayCircle, RefreshCw, Search, ServerCrash, Wallet } from "lucide-react";
import { getAdminTasks } from "@/lib/admin/api";
import type { AdminTask, AdminTasksResponse, AdminTaskUsageSummary } from "@/lib/admin/types";
import { MetricCard } from "@/components/admin/MetricCard";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { formatDateTime, formatNumber, formatRMB } from "@/lib/admin/format";
import { cn } from "@/lib/utils";

const statuses = ["all", "running", "streaming", "retrying", "completed", "failed", "cancelled", "incomplete"];
const activeStatuses = new Set(["running", "streaming", "retrying"]);
const billingFilters = [
  { key: "all", label: "全部计费" },
  { key: "charged", label: "已计费" },
  { key: "pending", label: "计费中" },
  { key: "unlinked", label: "未关联" },
  { key: "free_failed", label: "失败无成本" },
] as const;
type BillingFilter = typeof billingFilters[number]["key"];

export default function ManagementTasksPage() {
  const [status, setStatus] = useState("all");
  const [billingFilter, setBillingFilter] = useState<BillingFilter>("all");
  const [data, setData] = useState<AdminTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [liveRefresh, setLiveRefresh] = useState(true);
  const [selectedTask, setSelectedTask] = useState<AdminTask | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    const seq = ++requestSeq.current;
    if (mode === "initial") setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const result = await getAdminTasks({ page: 1, pageSize: 30, status: status === "all" ? undefined : status });
      if (seq !== requestSeq.current) return;
      setData(result);
      setLastLoadedAt(new Date());
      setSelectedTask((prev) => prev ? result.tasks.find((task) => task.id === prev.id) || prev : prev);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : "加载任务列表失败");
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [status]);

  useEffect(() => { load("initial"); }, [load]);

  useEffect(() => {
    if (!liveRefresh || !shouldAutoRefresh(status)) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load("refresh");
    }, 10000);
    return () => window.clearInterval(timer);
  }, [liveRefresh, status, load]);

  const runningCount = data?.summary?.filter((item) => activeStatuses.has(item.status)).reduce((sum, item) => sum + item.count, 0) || 0;
  const failedCount = data?.summary?.find((item) => item.status === "failed")?.count || 0;
  const completedCount = data?.summary?.find((item) => item.status === "completed")?.count || 0;
  const allTasks = data?.tasks || [];
  const visibleTasks = useMemo(() => allTasks.filter((task) => matchesBillingFilter(task, billingFilter)), [allTasks, billingFilter]);
  const usageRollup = useMemo(() => rollupTaskUsage(visibleTasks), [visibleTasks]);
  const estimateRollup = useMemo(() => rollupTaskEstimates(visibleTasks), [visibleTasks]);
  const billingStats = useMemo(() => summarizeBillingStates(allTasks), [allTasks]);
  const costedTasks = visibleTasks.filter((task) => (task.usage?.requests || 0) > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand">Task Monitor</p>
          <h1 className="mt-1 text-2xl font-semibold text-text-primary">任务成本监控</h1>
          <p className="mt-2 text-sm text-text-secondary">实时查看 AI 任务状态、已产生消耗、关联账本和失败原因，不用再跳到用户详情里找成本。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs text-text-tertiary">
            {lastLoadedAt ? `更新于 ${lastLoadedAt.toLocaleTimeString()}` : "尚未刷新"}
            {refreshing && <span className="ml-2 text-brand">刷新中…</span>}
          </div>
          <button onClick={() => setLiveRefresh((prev) => !prev)} className={cn("inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm", liveRefresh ? "border-brand/30 bg-brand/10 text-brand" : "border-surface-border bg-surface-card text-text-secondary hover:text-text-primary")}>
            {liveRefresh ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}{liveRefresh ? "实时刷新中" : "开启实时刷新"}
          </button>
          <button onClick={() => load("refresh")} className="inline-flex items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />刷新
          </button>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300"><AlertCircle className="h-4 w-4" />{error}</div>}

      <div className="grid gap-4 md:grid-cols-6">
        <MetricCard title="任务总数" value={formatNumber(data?.total || 0)} icon={ClipboardList} helper="当前状态筛选结果" />
        <MetricCard title="运行中" value={formatNumber(runningCount)} icon={RefreshCw} helper="running / streaming / retrying" />
        <MetricCard title="已关联成本" value={formatRMB(usageRollup.cost_rmb)} icon={Wallet} helper={`${costedTasks} 个任务已有账本 · ${formatNumber(usageRollup.requests)} 条 usage`} />
        <MetricCard title="预估成本" value={formatRMB(estimateRollup.estimated)} icon={Wallet} helper={estimateRollup.compared ? `偏差 ${formatSignedRMB(estimateRollup.actual - estimateRollup.estimated)}` : "按模型价格基线估算"} />
        <MetricCard title="失败无成本" value={formatNumber(billingStats.free_failed)} icon={ServerCrash} helper="失败且无外部调用成本" />
        <MetricCard title="完成" value={formatNumber(completedCount)} icon={ClipboardList} helper="completed" />
      </div>

      <section className="rounded-3xl border border-surface-border bg-surface-card p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {statuses.map((item) => (
              <button key={item} onClick={() => setStatus(item)} className={cn("rounded-xl px-3 py-2 text-sm transition-colors", status === item ? "bg-brand text-white" : "bg-surface-elevated text-text-secondary hover:text-text-primary")}>{item === "all" ? "全部" : item}</button>
            ))}
          </div>
          <div className="rounded-xl bg-surface-elevated px-3 py-2 text-xs text-text-tertiary">{shouldAutoRefresh(status) ? "自动刷新间隔 10s；页面不可见时暂停" : "当前状态默认不自动刷新，避免无效请求"}</div>
        </div>

        <div className="mb-5 rounded-2xl border border-surface-border bg-surface-elevated/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">计费状态</h2>
              <p className="mt-1 text-xs text-text-tertiary">区分“任务还在跑所以未计费”和“失败/完成但没有关联到账本”，避免把正常待计费误判成成本丢失。</p>
            </div>
            <div className="text-xs text-text-tertiary">当前显示 {formatNumber(visibleTasks.length)} / {formatNumber(allTasks.length)} 条</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {billingFilters.map((item) => (
              <button key={item.key} onClick={() => setBillingFilter(item.key)} className={cn("rounded-xl px-3 py-2 text-sm transition-colors", billingFilter === item.key ? "bg-brand text-white" : "bg-surface-card text-text-secondary hover:text-text-primary")}>
                {item.label} <span className="ml-1 text-xs opacity-75">{formatNumber(billingStats[item.key])}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-text-tertiary">
              <tr><th className="py-3">任务</th><th>状态</th><th>用户</th><th>模型</th><th>消耗</th><th>预估</th><th>用量</th><th>账本</th><th>会话/消息</th><th>错误</th><th>更新时间</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-surface-border text-text-secondary">
              {loading ? (
                <tr><td colSpan={12} className="py-8 text-center text-text-tertiary">正在加载任务…</td></tr>
              ) : allTasks.length === 0 ? (
                <tr><td colSpan={12} className="py-8 text-center text-text-tertiary"><Search className="mx-auto mb-2 h-5 w-5" />暂无任务。可以切换到“全部”或扩大状态范围。</td></tr>
              ) : visibleTasks.length === 0 ? (
                <tr><td colSpan={12} className="py-8 text-center text-text-tertiary"><Search className="mx-auto mb-2 h-5 w-5" />当前计费状态筛选下没有任务，可以切换到“全部计费”。</td></tr>
              ) : visibleTasks.map((task) => {
                const usage = task.usage;
                const billing = billingState(task);
                return (
                  <tr key={task.id} className="cursor-pointer hover:bg-surface-elevated/50" onClick={() => setSelectedTask(task)}>
                    <td className="whitespace-nowrap py-3 pr-4">
                      <div className="font-mono text-xs text-text-primary">#{task.id}</div>
                      <div className="mt-1 max-w-[180px] truncate text-xs text-text-tertiary">{task.response_id || "无 request id"}</div>
                    </td>
                    <td className="pr-4"><TaskStatus status={task.status} /></td>
                    <td className="pr-4">{task.user_id ? `U:${task.user_id}` : task.guest_id || "-"}</td>
                    <td className="pr-4">
                      <div>{task.provider || "-"}</div>
                      <div className="max-w-[220px] truncate text-xs text-text-tertiary">{task.model || "-"}</div>
                    </td>
                    <td className="pr-4">
                      <div className="font-medium text-text-primary">{usage?.requests ? formatRMB(usage.cost_rmb) : billing.label}</div>
                      <div className="text-xs text-text-tertiary">{usage?.requests ? `${formatRMB(usage.cost_rmb / Math.max(usage.requests, 1))}/次` : billing.helper}</div>
                    </td>
                    <td className="pr-4 text-xs text-text-secondary">{formatTaskEstimate(task)}</td>
                    <td className="pr-4 text-xs text-text-secondary">{formatUsageUnits(usage)}</td>
                    <td className="pr-4">
                      {usage?.requests ? <StatusBadge tone="blue">{formatNumber(usage.requests)} 条</StatusBadge> : <StatusBadge tone={billing.tone}>{billing.short}</StatusBadge>}
                    </td>
                    <td className="pr-4 text-xs text-text-tertiary">C:{task.conversation_id || "-"} / M:{task.assistant_message_id || "-"}</td>
                    <td className="max-w-[220px] truncate pr-4 text-xs text-red-500/80">{task.error_message || "-"}</td>
                    <td className="whitespace-nowrap pr-4">{formatDateTime(task.updated_at)}</td>
                    <td className="text-right"><Eye className="h-4 w-4 text-text-tertiary" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {selectedTask && <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </div>
  );
}

function TaskDrawer({ task, onClose }: { task: AdminTask; onClose: () => void }) {
  const usage = task.usage;
  const billing = billingState(task);
  const usageHref = usageLinkForTask(task);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-3xl overflow-y-auto border-l border-surface-border bg-surface-card p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-brand">任务成本详情</p>
            <h2 className="mt-1 text-xl font-semibold text-text-primary">任务 #{task.id}</h2>
            <p className="mt-1 text-xs text-text-tertiary">{task.response_id || "无 request id"}</p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-surface-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary">关闭</button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-5">
          <MiniMetric label="实际成本" value={usage?.requests ? formatRMB(usage.cost_rmb) : billing.label} helper={usage?.requests ? `${formatNumber(usage.requests)} 条账本` : billing.helper} />
          <MiniMetric label="预估成本" value={formatEstimateCost(task)} helper={task.cost_estimate?.available ? "4K输入/2K输出基线" : "价格缺失"} />
          <MiniMetric label="偏差" value={formatEstimateDelta(task)} helper="实际 - 预估" />
          <MiniMetric label="用量" value={formatUsageUnits(usage)} helper="token / 图片 / 视频" />
          <MiniMetric label="计费状态" value={billing.label} helper={usage?.last_usage_at ? `最后账本 ${formatDateTime(usage.last_usage_at)}` : billing.helper} />
        </div>

        {!usage?.requests && (
          <div className={cn("mt-5 rounded-2xl border p-4 text-sm", billing.key === "unlinked" ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200" : "border-surface-border bg-surface-elevated/60 text-text-secondary")}>
            <div className="font-medium text-text-primary">{billing.label}</div>
            <div className="mt-1 text-xs">{billing.explain}</div>
          </div>
        )}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-surface-border bg-surface-elevated/60 p-4">
            <h3 className="text-sm font-semibold text-text-primary">任务信息</h3>
            <InfoRow label="状态" value={<TaskStatus status={task.status} />} />
            <InfoRow label="用户" value={task.user_id ? `U:${task.user_id}` : task.guest_id || "-"} />
            <InfoRow label="Provider" value={task.provider || "-"} />
            <InfoRow label="模型" value={task.model || "-"} />
            <InfoRow label="会话/消息" value={`C:${task.conversation_id || "-"} / M:${task.assistant_message_id || "-"}`} />
            <InfoRow label="创建" value={formatDateTime(task.created_at)} />
            <InfoRow label="更新" value={formatDateTime(task.updated_at)} />
            {task.completed_at && <InfoRow label="完成" value={formatDateTime(task.completed_at)} />}
          </section>
          <section className="rounded-2xl border border-surface-border bg-surface-elevated/60 p-4">
            <h3 className="text-sm font-semibold text-text-primary">快速动作</h3>
            <div className="mt-3 space-y-2">
              <a href={usageHref} className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-card px-3 py-2 text-sm text-text-secondary hover:text-text-primary">
                查看完整账本 <ExternalLink className="h-4 w-4" />
              </a>
              {task.user_id > 0 && <a href={`/admin/usage?user_id=${task.user_id}`} className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-card px-3 py-2 text-sm text-text-secondary hover:text-text-primary">查看用户成本 <ExternalLink className="h-4 w-4" /></a>}
              <button onClick={() => navigator.clipboard?.writeText(debugText(task))} className="w-full rounded-xl border border-surface-border bg-surface-card px-3 py-2 text-left text-sm text-text-secondary hover:text-text-primary">复制排查字段</button>
            </div>
            {task.error_message && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">{task.error_message}</div>}
          </section>
        </div>

        <section className="mt-5 rounded-2xl border border-surface-border bg-surface-elevated/60 p-4">
          <h3 className="text-sm font-semibold text-text-primary">后台预估</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <MiniMetric label="预估输入" value={`${formatNumber(task.cost_estimate?.estimated_prompt_tokens || 0)} tok`} helper={`¥/1K ${(task.cost_estimate?.input_unit_price_rmb || 0).toFixed(4)}`} />
            <MiniMetric label="预估输出" value={`${formatNumber(task.cost_estimate?.estimated_completion_tokens || 0)} tok`} helper={`¥/1K ${(task.cost_estimate?.output_unit_price_rmb || 0).toFixed(4)}`} />
            <MiniMetric label="预估方法" value={task.cost_estimate?.available ? "可用" : "不可用"} helper={task.cost_estimate?.method || "-"} />
          </div>
          <p className="mt-3 text-xs text-text-tertiary">{task.cost_estimate?.note || "暂无预估说明"}</p>
        </section>

        <section className="mt-5 rounded-2xl border border-surface-border bg-surface-elevated/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">最近关联账本</h3>
            <a href={usageHref} className="text-xs text-brand hover:underline">查看全部</a>
          </div>
          {(task.recent_usage_logs || []).length === 0 ? (
            <div className="rounded-xl bg-surface-card px-4 py-8 text-center text-sm text-text-tertiary">暂无关联 usage log。运行中任务可能尚未完成计费，失败且未调用外部服务的任务也可能没有成本。</div>
          ) : (
            <div className="space-y-2">
              {(task.recent_usage_logs || []).map((log) => (
                <div key={log.id} className="rounded-xl border border-surface-border bg-surface-card p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-text-primary">{log.module || log.service || "usage"} / {log.feature || log.operation || log.model}</div>
                    <div className="font-semibold text-text-primary">{formatRMB(log.total_cost_rmb || 0)}</div>
                  </div>
                  <div className="mt-1 text-xs text-text-tertiary">#{log.id} · {log.provider}/{log.model} · {formatDateTime(log.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function TaskStatus({ status }: { status: string }) {
  return <StatusBadge tone={status === "completed" ? "green" : status === "failed" ? "red" : activeStatuses.has(status) ? "blue" : "neutral"}>{status || "unknown"}</StatusBadge>;
}

function MiniMetric({ label, value, helper }: { label: string; value: string; helper: string }) {
  return <div className="rounded-2xl border border-surface-border bg-surface-elevated/60 p-4"><div className="text-xs text-text-tertiary">{label}</div><div className="mt-1 text-lg font-semibold text-text-primary">{value}</div><div className="mt-1 text-xs text-text-tertiary">{helper}</div></div>;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="mt-3 flex items-center justify-between gap-4 text-sm"><span className="text-text-tertiary">{label}</span><span className="text-right text-text-primary">{value}</span></div>;
}

function shouldAutoRefresh(status: string) {
  return status === "all" || activeStatuses.has(status);
}

type BillingStateKey = "charged" | "pending" | "unlinked" | "free_failed";

function billingState(task: AdminTask): { key: BillingStateKey; label: string; short: string; helper: string; explain: string; tone: "green" | "blue" | "red" | "neutral" } {
  const requests = task.usage?.requests || 0;
  if (requests > 0) return { key: "charged", label: "已计费", short: `${formatNumber(requests)} 条`, helper: `${formatNumber(requests)} 条 usage`, explain: "该任务已经关联到 usage ledger，可下钻查看每条外部调用。", tone: "green" };
  if (activeStatuses.has(task.status)) return { key: "pending", label: "计费中", short: "待写入", helper: "完成后写账本", explain: "任务仍在运行或重试中，外部调用完成后才会写入 usage ledger。", tone: "blue" };
  if (task.status === "failed" || task.status === "cancelled" || task.status === "incomplete") return { key: "free_failed", label: "无成本", short: "无成本", helper: "失败/取消未计费", explain: "任务失败、取消或未完成，且没有关联到外部 API 调用账本；如果确实调用了外部服务，需要检查 task_id/message_id 写入链路。", tone: "neutral" };
  return { key: "unlinked", label: "未关联", short: "未关联", helper: "暂无 usage log", explain: "任务已结束但没有关联 usage log。可能是历史任务、非计费任务，或写账本时缺少 task_id/message_id 关联，需要下钻排查。", tone: "red" };
}

function matchesBillingFilter(task: AdminTask, filter: BillingFilter) {
  if (filter === "all") return true;
  return billingState(task).key === filter;
}

function summarizeBillingStates(tasks: AdminTask[]): Record<BillingFilter, number> {
  const stats: Record<BillingFilter, number> = { all: tasks.length, charged: 0, pending: 0, unlinked: 0, free_failed: 0 };
  tasks.forEach((task) => {
    stats[billingState(task).key] += 1;
  });
  return stats;
}

function rollupTaskUsage(tasks: AdminTask[]): AdminTaskUsageSummary {
  return tasks.reduce((acc, task) => {
    const usage = task.usage;
    if (!usage) return acc;
    acc.requests += usage.requests || 0;
    acc.failures += usage.failures || 0;
    acc.cost_rmb += usage.cost_rmb || 0;
    acc.prompt_tokens += usage.prompt_tokens || 0;
    acc.completion_tokens += usage.completion_tokens || 0;
    acc.total_tokens += usage.total_tokens || 0;
    acc.image_count += usage.image_count || 0;
    acc.character_count += usage.character_count || 0;
    acc.video_seconds += usage.video_seconds || 0;
    acc.audio_seconds += usage.audio_seconds || 0;
    return acc;
  }, { requests: 0, failures: 0, cost_rmb: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, image_count: 0, character_count: 0, video_seconds: 0, audio_seconds: 0 });
}

function formatUsageUnits(usage?: AdminTaskUsageSummary) {
  if (!usage || usage.requests === 0) return "-";
  const parts = [];
  if (usage.total_tokens) parts.push(`${formatNumber(usage.total_tokens)} tok`);
  if (usage.image_count) parts.push(`${formatNumber(usage.image_count)} 张图`);
  if (usage.video_seconds) parts.push(`${formatNumber(usage.video_seconds)} 秒视频`);
  if (usage.character_count) parts.push(`${formatNumber(usage.character_count)} 字符`);
  if (usage.audio_seconds) parts.push(`${formatNumber(usage.audio_seconds)} 秒音频`);
  return parts.length ? parts.join(" · ") : `${formatNumber(usage.requests)} 次调用`;
}


function rollupTaskEstimates(tasks: AdminTask[]) {
  return tasks.reduce((acc, task) => {
    const estimate = task.cost_estimate;
    if (!estimate?.available) return acc;
    acc.estimated += estimate.estimated_total_cost_rmb || 0;
    if ((task.usage?.requests || 0) > 0) {
      acc.actual += task.usage?.cost_rmb || 0;
      acc.compared += 1;
    }
    return acc;
  }, { estimated: 0, actual: 0, compared: 0 });
}

function formatTaskEstimate(task: AdminTask) {
  const estimate = task.cost_estimate;
  if (!estimate?.available) return estimate?.note || "-";
  const delta = (task.usage?.requests || 0) > 0 ? ` · ${formatSignedRMB(estimate.delta_cost_rmb)}` : "";
  return `${formatRMB(estimate.estimated_total_cost_rmb)}${delta}`;
}

function formatEstimateCost(task: AdminTask) {
  const estimate = task.cost_estimate;
  if (!estimate?.available) return "-";
  return formatRMB(estimate.estimated_total_cost_rmb || 0);
}

function formatEstimateDelta(task: AdminTask) {
  const estimate = task.cost_estimate;
  if (!estimate?.available || !task.usage?.requests) return "-";
  const pct = Number.isFinite(estimate.delta_rate) ? ` (${(estimate.delta_rate * 100).toFixed(0)}%)` : "";
  return `${formatSignedRMB(estimate.delta_cost_rmb)}${pct}`;
}

function formatSignedRMB(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatRMB(value || 0)}`;
}

function usageLinkForTask(task: AdminTask) {
  const params = new URLSearchParams({ range: "all" });
  if (task.id) params.set("task_id", String(task.id));
  if (task.response_id) params.set("request_id", task.response_id);
  if (task.assistant_message_id) params.set("message_id", String(task.assistant_message_id));
  return `/admin/usage?${params.toString()}`;
}

function debugText(task: AdminTask) {
  return JSON.stringify({ task_id: task.id, response_id: task.response_id, user_id: task.user_id, guest_id: task.guest_id, conversation_id: task.conversation_id, assistant_message_id: task.assistant_message_id, provider: task.provider, model: task.model, status: task.status, usage: task.usage }, null, 2);
}
