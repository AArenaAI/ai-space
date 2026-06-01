"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BarChart3, Coins, MessageSquare, RefreshCw, ServerCrash, Users, Zap } from "lucide-react";
import {
  getAdminUsageConversations,
  getAdminUsageLogs,
  getAdminUsageModels,
  getAdminUsageSummary,
  getAdminUsageUsers,
} from "@/lib/admin/api";
import type {
  AdminUsageConversationsResponse,
  AdminUsageLogsResponse,
  AdminUsageModelsResponse,
  AdminUsageSummary,
  AdminUsageUsersResponse,
} from "@/lib/admin/types";
import { MetricCard } from "@/components/admin/MetricCard";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { formatDateTime, formatNumber, formatRMB } from "@/lib/admin/format";
import { cn } from "@/lib/utils";

const ranges = [
  { value: "today", label: "今天" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
];
const tabs = [
  { value: "overview", label: "总览" },
  { value: "users", label: "用户" },
  { value: "models", label: "模块 / 模型" },
  { value: "conversations", label: "对话" },
] as const;
type UsageTab = (typeof tabs)[number]["value"];

export default function AdminUsagePage() {
  const [range, setRange] = useState("7d");
  const [tab, setTab] = useState<UsageTab>("overview");
  const [summary, setSummary] = useState<AdminUsageSummary | null>(null);
  const [logs, setLogs] = useState<AdminUsageLogsResponse | null>(null);
  const [users, setUsers] = useState<AdminUsageUsersResponse | null>(null);
  const [models, setModels] = useState<AdminUsageModelsResponse | null>(null);
  const [conversations, setConversations] = useState<AdminUsageConversationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, logData, usersData, modelsData, conversationsData] = await Promise.all([
        getAdminUsageSummary(range),
        getAdminUsageLogs({ page: 1, pageSize: 30, range }),
        getAdminUsageUsers({ page: 1, pageSize: 30, range }),
        getAdminUsageModels({ range, limit: 120 }),
        getAdminUsageConversations({ page: 1, pageSize: 30, range }),
      ]);
      setSummary(summaryData);
      setLogs(logData);
      setUsers(usersData);
      setModels(modelsData);
      setConversations(conversationsData);
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
  const chatCost = summary?.service_breakdown?.find((item) => item.name === "chat")?.cost_rmb || 0;

  if (loading && !summary) return <div className="rounded-3xl border border-surface-border bg-surface-card p-8 text-text-secondary">正在加载用量数据…</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-medium text-brand">Usage v2</p>
          <h1 className="mt-1 text-2xl font-semibold text-text-primary">用量成本</h1>
          <p className="mt-2 text-sm text-text-secondary">统一账本按全站、用户、模块模型、对话四层分析平台真实成本。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ranges.map((item) => (
            <button key={item.value} onClick={() => setRange(item.value)} className={cn("rounded-xl px-3 py-2 text-sm transition-colors", range === item.value ? "bg-brand text-white" : "bg-surface-card text-text-secondary hover:text-text-primary")}>{item.label}</button>
          ))}
          <button onClick={load} className="rounded-xl border border-surface-border bg-surface-card p-2 text-text-secondary hover:text-text-primary" aria-label="刷新"><RefreshCw className="h-4 w-4" /></button>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300"><AlertCircle className="h-4 w-4" />{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="总成本" value={formatRMB(summary?.cost_rmb || 0)} icon={Coins} helper={`Chat ${formatRMB(chatCost)}`} />
        <MetricCard title="请求数" value={formatNumber(summary?.requests || 0)} icon={BarChart3} helper={`成功 ${formatNumber(summary?.successes || 0)}`} />
        <MetricCard title="失败数" value={formatNumber(summary?.failures || 0)} icon={ServerCrash} helper="非 success 状态" />
        <MetricCard title="Token" value={formatNumber(summary?.total_tokens || 0)} icon={Zap} helper={`输出 ${formatNumber(summary?.completion_tokens || 0)}`} />
        <MetricCard title="用户 / 对话" value={`${formatNumber(users?.users?.length || 0)} / ${formatNumber(conversations?.conversations?.length || 0)}`} icon={Users} helper="当前页样本" />
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-surface-border bg-surface-card p-2">
        {tabs.map((item) => (
          <button key={item.value} onClick={() => setTab(item.value)} className={cn("rounded-xl px-4 py-2 text-sm font-medium transition-colors", tab === item.value ? "bg-brand text-white" : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary")}>{item.label}</button>
        ))}
      </div>

      {tab === "overview" && <Overview summary={summary} logs={logs} maxDailyCost={maxDailyCost} />}
      {tab === "users" && <UsersUsage users={users} />}
      {tab === "models" && <ModelsUsage models={models} summary={summary} />}
      {tab === "conversations" && <ConversationsUsage conversations={conversations} />}
    </div>
  );
}

function Overview({ summary, logs, maxDailyCost }: { summary: AdminUsageSummary | null; logs: AdminUsageLogsResponse | null; maxDailyCost: number }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card title="每日成本趋势">
          <div className="space-y-3">
            {(summary?.daily || []).length === 0 ? <Empty /> : summary!.daily.map((item) => (
              <div key={item.date} className="grid grid-cols-[90px_1fr_110px] items-center gap-3 text-sm">
                <span className="text-text-tertiary">{item.date.slice(5)}</span>
                <div className="h-3 overflow-hidden rounded-full bg-surface-elevated"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(4, (item.cost_rmb / maxDailyCost) * 100)}%` }} /></div>
                <span className="text-right text-text-secondary">{formatRMB(item.cost_rmb)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Provider 分布"><Breakdown rows={summary?.provider_breakdown || []} /></Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="模型成本排行"><ModelMini rows={summary?.top_models || []} /></Card>
        <Card title="服务类型"><Breakdown rows={summary?.service_breakdown || []} /></Card>
      </div>
      <RecentLogs logs={logs} />
    </div>
  );
}

function UsersUsage({ users }: { users: AdminUsageUsersResponse | null }) {
  return <Card title="用户消耗排行"><Table headers={["用户", "模块消耗", "请求", "Token/图片", "成本", "最近使用"]}>{(users?.users || []).map((user) => <tr key={user.user_id} className="border-t border-surface-border"><td className="py-3 pr-4"><div className="font-medium text-text-primary">{user.email || `User #${user.user_id}`}</div><div className="text-xs text-text-tertiary">{user.name || "-"} · ID {user.user_id}</div></td><td className="min-w-[260px] pr-4"><div className="flex flex-wrap gap-1">{(user.services || []).slice(0, 4).map((item) => <span key={item.name} className="rounded-full bg-surface-elevated px-2 py-1 text-xs text-text-secondary">{item.name || "unknown"} {formatRMB(item.cost_rmb)}</span>)}</div></td><td className="pr-4">{formatNumber(user.requests)}</td><td className="pr-4">{formatNumber(user.total_tokens || 0)} / {formatNumber(user.image_count || 0)}</td><td className="font-semibold text-text-primary">{formatRMB(user.cost_rmb)}</td><td className="whitespace-nowrap text-text-tertiary">{formatDateTime(user.last_used_at)}</td></tr>)}</Table></Card>;
}

function ModelsUsage({ models, summary }: { models: AdminUsageModelsResponse | null; summary: AdminUsageSummary | null }) {
  return <div className="space-y-6"><div className="grid gap-6 xl:grid-cols-2"><Card title="模块汇总"><Breakdown rows={summary?.service_breakdown || []} /></Card><Card title="Provider 汇总"><Breakdown rows={summary?.provider_breakdown || []} /></Card></div><Card title="模块 x 模型矩阵"><Table headers={["模块", "Provider", "模型", "请求", "Token", "图片", "成本"]}>{(models?.models || []).map((row) => <tr key={`${row.service}-${row.provider}-${row.model}`} className="border-t border-surface-border"><td className="py-3 pr-4"><StatusBadge tone="blue">{row.service || "unknown"}</StatusBadge></td><td className="pr-4 text-text-secondary">{row.provider || "unknown"}</td><td className="max-w-[340px] truncate pr-4 font-medium text-text-primary">{row.model || "unknown"}</td><td className="pr-4">{formatNumber(row.requests)}</td><td className="pr-4">{formatNumber(row.total_tokens || 0)}</td><td className="pr-4">{formatNumber(row.image_count || 0)}</td><td className="font-semibold text-text-primary">{formatRMB(row.cost_rmb)}</td></tr>)}</Table></Card></div>;
}

function ConversationsUsage({ conversations }: { conversations: AdminUsageConversationsResponse | null }) {
  return <Card title="对话消耗排行"><Table headers={["对话", "用户", "模型", "请求", "Token", "成本", "最近使用"]}>{(conversations?.conversations || []).map((item) => <tr key={item.conversation_id} className="border-t border-surface-border"><td className="py-3 pr-4"><div className="max-w-[280px] truncate font-medium text-text-primary">{item.title || `Conversation #${item.conversation_id}`}</div><div className="text-xs text-text-tertiary">ID {item.conversation_id}</div></td><td className="pr-4 text-text-secondary">{item.email || item.user_id || "-"}</td><td className="min-w-[260px] pr-4"><div className="flex flex-wrap gap-1">{(item.models || []).slice(0, 3).map((model) => <span key={`${item.conversation_id}-${model.provider}-${model.model}`} className="rounded-full bg-surface-elevated px-2 py-1 text-xs text-text-secondary">{model.model || "unknown"} {formatRMB(model.cost_rmb)}</span>)}</div></td><td className="pr-4">{formatNumber(item.requests)}</td><td className="pr-4">{formatNumber(item.total_tokens || 0)}</td><td className="font-semibold text-text-primary">{formatRMB(item.cost_rmb)}</td><td className="whitespace-nowrap text-text-tertiary">{formatDateTime(item.last_used_at)}</td></tr>)}</Table></Card>;
}

function RecentLogs({ logs }: { logs: AdminUsageLogsResponse | null }) {
  return <Card title="最近调用记录"><Table headers={["时间", "用户", "对话/消息", "服务", "Provider", "模型", "Token", "成本", "状态"]}>{(logs?.logs || []).map((log) => <tr key={log.id} className="border-t border-surface-border"><td className="whitespace-nowrap py-3 pr-4">{formatDateTime(log.created_at)}</td><td className="pr-4">{log.user_id || log.guest_id || "-"}</td><td className="pr-4 text-xs text-text-tertiary">C:{log.conversation_id || "-"} / M:{log.message_id || "-"}</td><td className="pr-4">{log.service || "-"}</td><td className="pr-4">{log.provider || "-"}</td><td className="max-w-[220px] truncate pr-4">{log.model || "-"}</td><td className="pr-4">{formatNumber(log.total_tokens)}</td><td className="pr-4">{formatRMB(log.total_cost_rmb)}</td><td><StatusBadge tone={log.status === "success" ? "green" : log.status === "failed" ? "red" : "amber"}>{log.estimated ? `${log.status} · 估` : log.status || "unknown"}</StatusBadge></td></tr>)}</Table></Card>;
}

function Breakdown({ rows }: { rows: Array<{ name: string; requests: number; cost_rmb: number; failures?: number; tokens?: number }> }) {
  if (rows.length === 0) return <Empty />;
  return <div className="space-y-3">{rows.map((item) => <div key={item.name || "unknown"} className="rounded-2xl bg-surface-elevated px-4 py-3"><div className="flex items-center justify-between text-sm"><span className="font-medium text-text-primary">{item.name || "unknown"}</span><span className="font-semibold text-text-primary">{formatRMB(item.cost_rmb)}</span></div><div className="mt-1 text-xs text-text-tertiary">{formatNumber(item.requests)} 次 · 失败 {formatNumber(item.failures || 0)}{item.tokens ? ` · ${formatNumber(item.tokens)} tokens` : ""}</div></div>)}</div>;
}

function ModelMini({ rows }: { rows: Array<{ model: string; provider: string; cost_rmb: number; requests: number; tokens: number }> }) {
  if (rows.length === 0) return <Empty />;
  return <div className="space-y-3">{rows.map((item) => <div key={`${item.provider}-${item.model}`} className="flex items-center justify-between rounded-2xl bg-surface-elevated px-4 py-3 text-sm"><div><div className="font-medium text-text-primary">{item.model || "unknown"}</div><div className="text-xs text-text-tertiary">{item.provider || "unknown"} · {formatNumber(item.tokens)} tokens</div></div><div className="text-right"><div className="font-semibold text-text-primary">{formatRMB(item.cost_rmb)}</div><div className="text-xs text-text-tertiary">{formatNumber(item.requests)} 次</div></div></div>)}</div>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-3xl border border-surface-border bg-surface-card p-6 shadow-sm"><h2 className="mb-4 text-lg font-semibold text-text-primary">{title}</h2>{children}</section>;
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-text-tertiary"><tr>{headers.map((header) => <th key={header} className="py-3 pr-4">{header}</th>)}</tr></thead><tbody className="text-text-secondary">{children}</tbody></table></div>;
}

function Empty() {
  return <div className="rounded-2xl bg-surface-elevated p-5 text-sm text-text-secondary">暂无用量数据</div>;
}
