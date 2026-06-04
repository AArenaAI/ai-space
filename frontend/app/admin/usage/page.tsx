"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BarChart3, ChevronDown, Clipboard, Coins, FilterX, ListFilter, MessageSquare, RefreshCw, Search, ServerCrash, Users, Zap } from "lucide-react";
import {
  getAdminUsageConversationDetail,
  getAdminUsageConversations,
  getAdminUsageLogs,
  getAdminUsageModels,
  getAdminUsageModules,
  getAdminUsageSummary,
  getAdminUsageUserDetail,
  getAdminUsageUsers,
} from "@/lib/admin/api";
import type {
  AdminUsageConversationDetail,
  AdminUsageConversationsResponse,
  AdminUsageLog,
  AdminUsageLogsResponse,
  AdminUsageModelsResponse,
  AdminUsageModulesResponse,
  AdminUsageModuleRow,
  AdminUsageSummary,
  AdminUsageUserDetail,
  AdminUsageUserRow,
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
  { value: "all", label: "全部" },
];
const tabs = [
  { value: "overview", label: "总览" },
  { value: "ledger", label: "账本明细" },
  { value: "users", label: "用户" },
  { value: "modules", label: "产品模块" },
  { value: "models", label: "模型" },
  { value: "conversations", label: "对话" },
] as const;
type UsageTab = (typeof tabs)[number]["value"];

type UsageFilters = {
  range: string;
  module: string;
  feature: string;
  operation: string;
  service: string;
  provider: string;
  model: string;
  status: string;
  userId: string;
  resourceType: string;
  resourceId: string;
  requestId: string;
  q: string;
};


const quickScenarios: Array<{ label: string; description: string; patch: Partial<UsageFilters> }> = [
  { label: "全部成本", description: "查看所有历史账本", patch: { range: "all" } },
  { label: "普通聊天", description: "Chat 模型消耗", patch: { range: "all", module: "chat", feature: "chat", operation: "chat_completion", service: "chat" } },
  { label: "视频生成", description: "Seedance 等视频成本", patch: { range: "all", module: "creative", feature: "video", operation: "video_generation", service: "video_generation" } },
  { label: "图片创作", description: "生图/编辑/工具", patch: { range: "all", module: "creative", feature: "image" } },
  { label: "翻译", description: "Google Translation", patch: { range: "all", module: "work", feature: "translator", operation: "translate_text", service: "translation" } },
  { label: "PPT", description: "大纲/全文生成", patch: { range: "all", module: "work", feature: "ppt" } },
  { label: "文档研读", description: "Vision/Embedding", patch: { range: "all", module: "work", feature: "document_reader" } },
];

const defaultFilters: UsageFilters = {
  range: "7d",
  module: "",
  feature: "",
  operation: "",
  service: "",
  provider: "",
  model: "",
  status: "",
  userId: "",
  resourceType: "",
  resourceId: "",
  requestId: "",
  q: "",
};

export default function AdminUsagePage() {
  const [filters, setFilters] = useState<UsageFilters>(defaultFilters);
  const [tab, setTab] = useState<UsageTab>("modules");
  const [summary, setSummary] = useState<AdminUsageSummary | null>(null);
  const [logs, setLogs] = useState<AdminUsageLogsResponse | null>(null);
  const [users, setUsers] = useState<AdminUsageUsersResponse | null>(null);
  const [models, setModels] = useState<AdminUsageModelsResponse | null>(null);
  const [modules, setModules] = useState<AdminUsageModulesResponse | null>(null);
  const [conversations, setConversations] = useState<AdminUsageConversationsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<AdminUsageLog | null>(null);
  const [selectedUserDetail, setSelectedUserDetail] = useState<AdminUsageUserDetail | null>(null);
  const [selectedUserLogs, setSelectedUserLogs] = useState<AdminUsageLog[]>([]);
  const [selectedConversationDetail, setSelectedConversationDetail] = useState<AdminUsageConversationDetail | null>(null);
  const [conversationDetailLoading, setConversationDetailLoading] = useState(false);
  const [conversationDetailError, setConversationDetailError] = useState("");
  const [userDetailLoading, setUserDetailLoading] = useState(false);
  const [userDetailError, setUserDetailError] = useState("");
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const logParams = useMemo(() => ({
    page,
    pageSize: 50,
    range: filters.range,
    module: filters.module,
    feature: filters.feature,
    operation: filters.operation,
    service: filters.service,
    provider: filters.provider,
    model: filters.model,
    status: filters.status,
    userId: numberOrUndefined(filters.userId),
    resourceType: filters.resourceType,
    resourceId: numberOrUndefined(filters.resourceId),
    requestId: filters.requestId,
    q: filters.q,
    sort: "created_at",
    order: "desc" as const,
  }), [filters, page]);

  const load = async () => {
    setLoading(true);
    const [summaryResult, logResult, usersResult, modulesResult, modelsResult, conversationsResult] = await Promise.allSettled([
      getAdminUsageSummary(filters.range === "all" ? "30d" : filters.range),
      getAdminUsageLogs(logParams),
      getAdminUsageUsers({ page: 1, pageSize: 30, range: filters.range, service: filters.service, provider: filters.provider, model: filters.model }),
      getAdminUsageModules({ range: filters.range, module: filters.module, feature: filters.feature, operation: filters.operation, service: filters.service, provider: filters.provider, model: filters.model, limit: 160 }),
      getAdminUsageModels({ range: filters.range, service: filters.service, provider: filters.provider, limit: 120 }),
      getAdminUsageConversations({ page: 1, pageSize: 30, range: filters.range, userId: numberOrUndefined(filters.userId), service: filters.service, provider: filters.provider, model: filters.model }),
    ]);

    const nextErrors: Record<string, string> = {};
    if (summaryResult.status === "fulfilled") setSummary(summaryResult.value); else nextErrors.summary = errorMessage(summaryResult.reason, "查询总览失败");
    if (logResult.status === "fulfilled") setLogs(logResult.value); else nextErrors.ledger = errorMessage(logResult.reason, "查询用量日志失败");
    if (usersResult.status === "fulfilled") setUsers(usersResult.value); else nextErrors.users = errorMessage(usersResult.reason, "查询用户用量失败");
    if (modulesResult.status === "fulfilled") setModules(modulesResult.value); else nextErrors.modules = errorMessage(modulesResult.reason, "查询产品模块用量失败");
    if (modelsResult.status === "fulfilled") setModels(modelsResult.value); else nextErrors.models = errorMessage(modelsResult.reason, "查询模型用量失败");
    if (conversationsResult.status === "fulfilled") setConversations(conversationsResult.value); else nextErrors.conversations = errorMessage(conversationsResult.reason, "查询对话用量失败");
    setErrors(nextErrors);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logParams]);

  const maxDailyCost = useMemo(() => Math.max(0.01, ...(summary?.daily || []).map((item) => item.cost_rmb)), [summary]);
  const chatCost = summary?.service_breakdown?.find((item) => item.name === "chat")?.cost_rmb || 0;
  const ledgerSummary = logs?.summary;

  const updateFilter = (key: keyof UsageFilters, value: string) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const quickVideoFilter = () => {
    applyLedgerFilters({ range: "all", module: "creative", feature: "video", operation: "video_generation", service: "video_generation" });
  };

  const applyLedgerFilters = (patch: Partial<UsageFilters>, nextTab: UsageTab = "ledger") => {
    setTab(nextTab);
    setPage(1);
    setFilters((prev) => ({ ...defaultFilters, ...prev, ...patch }));
  };

  const clearFilters = () => {
    setPage(1);
    setFilters(defaultFilters);
    setTab("modules");
  };

  const openUserDetail = async (user: AdminUsageUserRow) => {
    setUserDetailError("");
    setSelectedUserLogs([]);
    setUserDetailLoading(true);
    const fallbackDetail: AdminUsageUserDetail = { user: { id: user.user_id, email: user.email, name: user.name, role: "user", plan_tier: "", basic_credits: 0, advanced_credits: 0, elite_credits: 0, created_at: "", updated_at: "" }, summary: { requests: user.requests, failures: user.failures || 0, cost_rmb: user.cost_rmb, total_tokens: user.total_tokens || 0, image_count: user.image_count || 0 }, services: user.services || [], models: [], conversations: [] };
    setSelectedUserDetail(fallbackDetail);
    try {
      const [detailResult, logsResult] = await Promise.allSettled([
        getAdminUsageUserDetail(user.user_id, { range: filters.range }),
        getAdminUsageLogs({ page: 1, pageSize: 20, range: filters.range, userId: user.user_id, sort: "created_at", order: "desc" }),
      ]);
      const messages: string[] = [];
      if (detailResult.status === "fulfilled") setSelectedUserDetail(detailResult.value); else messages.push(errorMessage(detailResult.reason, "查询用户详情失败"));
      if (logsResult.status === "fulfilled") setSelectedUserLogs(logsResult.value.logs || []); else messages.push(errorMessage(logsResult.reason, "查询用户最近账本失败"));
      setUserDetailError(messages.join("；"));
    } finally {
      setUserDetailLoading(false);
    }
  };

  const drilldownUserLedger = (userId: number) => {
    setSelectedUserDetail(null);
    applyLedgerFilters({ userId: String(userId) }, "ledger");
    setShowAdvancedFilters(true);
  };

  const openConversationDetail = async (conversationId: number) => {
    setConversationDetailError("");
    setConversationDetailLoading(true);
    setSelectedConversationDetail(null);
    try {
      const detail = await getAdminUsageConversationDetail(conversationId, { range: filters.range });
      setSelectedConversationDetail(detail);
    } catch (error) {
      setConversationDetailError(errorMessage(error, "查询对话详情失败"));
    } finally {
      setConversationDetailLoading(false);
    }
  };

  const activeFilterLabels = activeFilters(filters);

  if (loading && !summary && !logs) return <div className="rounded-3xl border border-surface-border bg-surface-card p-8 text-text-secondary">正在加载用量数据…</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-medium text-brand">Usage v3</p>
          <h1 className="mt-1 text-2xl font-semibold text-text-primary">用量成本账本</h1>
          <p className="mt-2 text-sm text-text-secondary">从总览下钻到产品模块、功能、操作和每一次外部 API 调用。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ranges.map((item) => (
            <button key={item.value} onClick={() => updateFilter("range", item.value)} className={cn("rounded-xl px-3 py-2 text-sm transition-colors", filters.range === item.value ? "bg-brand text-white" : "bg-surface-card text-text-secondary hover:text-text-primary")}>{item.label}</button>
          ))}
          <button onClick={quickVideoFilter} className="rounded-xl border border-brand/30 bg-brand/10 px-3 py-2 text-sm font-medium text-brand hover:bg-brand/15">查看视频消耗</button>
          <button onClick={load} className="rounded-xl border border-surface-border bg-surface-card p-2 text-text-secondary hover:text-text-primary" aria-label="刷新"><RefreshCw className="h-4 w-4" /></button>
        </div>
      </div>

      <QuickScenarioPanel scenarios={quickScenarios} moduleRows={modules?.modules || []} onApply={(patch, nextTab) => applyLedgerFilters(patch, nextTab)} />

      {activeFilterLabels.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-brand/15 bg-brand/5 px-4 py-3 text-sm"><span className="font-medium text-text-primary">当前筛选</span>{activeFilterLabels.map((item) => <span key={item} className="rounded-full bg-surface-card px-3 py-1 text-text-secondary">{item}</span>)}<button onClick={clearFilters} className="ml-auto inline-flex items-center gap-1 rounded-xl border border-surface-border px-3 py-1.5 text-text-secondary hover:text-text-primary"><FilterX className="h-4 w-4" />清空</button></div>}

      {Object.keys(errors).length > 0 && <div className="space-y-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">{Object.entries(errors).map(([key, message]) => <div key={key} className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />{message}</div>)}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="总成本" value={formatRMB(summary?.cost_rmb || 0)} icon={Coins} helper={`Chat ${formatRMB(chatCost)}`} />
        <MetricCard title="账本筛选成本" value={formatRMB(ledgerSummary?.cost_rmb || 0)} icon={ListFilter} helper={`${formatNumber(ledgerSummary?.requests || 0)} 条明细`} />
        <MetricCard title="请求数" value={formatNumber(summary?.requests || 0)} icon={BarChart3} helper={`成功 ${formatNumber(summary?.successes || 0)}`} />
        <MetricCard title="Token / 字符" value={`${formatNumber(ledgerSummary?.total_tokens || summary?.total_tokens || 0)} / ${formatNumber(ledgerSummary?.character_count || 0)}`} icon={Zap} helper={`输出 ${formatNumber(ledgerSummary?.completion_tokens || summary?.completion_tokens || 0)}`} />
        <MetricCard title="用户 / 对话" value={`${formatNumber(users?.users?.length || 0)} / ${formatNumber(conversations?.conversations?.length || 0)}`} icon={Users} helper="当前页样本" />
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-surface-border bg-surface-card p-2">
        {tabs.map((item) => (
          <button key={item.value} onClick={() => setTab(item.value)} className={cn("rounded-xl px-4 py-2 text-sm font-medium transition-colors", tab === item.value ? "bg-brand text-white" : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary")}>{item.label}</button>
        ))}
      </div>

      {tab === "overview" && <Overview summary={summary} logs={logs} maxDailyCost={maxDailyCost} onServiceClick={(service) => { updateFilter("service", service); setTab("ledger"); }} />}
      {tab === "ledger" && <Ledger filters={filters} updateFilter={updateFilter} logs={logs} page={page} setPage={setPage} loading={loading} error={errors.ledger} showAdvancedFilters={showAdvancedFilters} setShowAdvancedFilters={setShowAdvancedFilters} onSelect={setSelectedLog} onClear={clearFilters} />}
      {tab === "users" && <UsersUsage users={users} error={errors.users} onSelectUser={openUserDetail} />}
      {tab === "modules" && <ModulesUsage modules={modules} error={errors.modules} onDrilldown={applyLedgerFilters} />}
      {tab === "models" && <ModelsUsage models={models} summary={summary} error={errors.models} />}
      {tab === "conversations" && <ConversationsUsage conversations={conversations} error={errors.conversations} />}
      {selectedLog && <UsageLogDrawer log={selectedLog} onClose={() => setSelectedLog(null)} />}
      {(selectedUserDetail || userDetailLoading || userDetailError) && <UserUsageDrawer detail={selectedUserDetail} logs={selectedUserLogs} loading={userDetailLoading} error={userDetailError} range={filters.range} onClose={() => { setSelectedUserDetail(null); setSelectedUserLogs([]); setUserDetailError(""); }} onDrilldownLedger={drilldownUserLedger} onSelectLog={(log) => { setSelectedUserDetail(null); setSelectedLog(log); }} onSelectConversation={openConversationDetail} />}
      {(selectedConversationDetail || conversationDetailLoading || conversationDetailError) && <ConversationUsageDrawer detail={selectedConversationDetail} loading={conversationDetailLoading} error={conversationDetailError} range={filters.range} onClose={() => { setSelectedConversationDetail(null); setConversationDetailError(""); }} onSelectLog={setSelectedLog} />}
    </div>
  );
}


function QuickScenarioPanel({ scenarios, moduleRows, onApply }: { scenarios: Array<{ label: string; description: string; patch: Partial<UsageFilters> }>; moduleRows: AdminUsageModuleRow[]; onApply: (patch: Partial<UsageFilters>, nextTab?: UsageTab) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
      {scenarios.map((item) => {
        const stat = scenarioStat(moduleRows, item.patch);
        return (
          <button key={item.label} onClick={() => onApply(item.patch, item.label === "全部成本" ? "modules" : "ledger")} className="rounded-2xl border border-surface-border bg-surface-card p-4 text-left transition hover:border-brand/40 hover:bg-surface-elevated">
            <div className="font-medium text-text-primary">{item.label}</div>
            <div className="mt-1 text-xs text-text-tertiary">{item.description}</div>
            <div className="mt-3 rounded-xl bg-surface-elevated px-3 py-2 text-xs text-text-secondary">
              <div className="font-semibold text-text-primary">{formatRMB(stat.cost)}</div>
              <div>{formatNumber(stat.requests)} 条调用</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function activeFilters(filters: UsageFilters) {
  const labels: string[] = [];
  if (filters.range !== defaultFilters.range) labels.push(`范围: ${filters.range}`);
  if (filters.module) labels.push(`模块: ${filters.module}`);
  if (filters.feature) labels.push(`功能: ${filters.feature}`);
  if (filters.operation) labels.push(`操作: ${filters.operation}`);
  if (filters.service) labels.push(`服务: ${filters.service}`);
  if (filters.provider) labels.push(`Provider: ${filters.provider}`);
  if (filters.model) labels.push(`模型: ${filters.model}`);
  if (filters.status) labels.push(`状态: ${filters.status}`);
  if (filters.userId) labels.push(`用户: ${filters.userId}`);
  if (filters.resourceType) labels.push(`资源: ${filters.resourceType}`);
  if (filters.resourceId) labels.push(`资源 ID: ${filters.resourceId}`);
  if (filters.requestId) labels.push(`Request: ${filters.requestId}`);
  if (filters.q) labels.push(`搜索: ${filters.q}`);
  return labels;
}

function Overview({ summary, logs, maxDailyCost, onServiceClick }: { summary: AdminUsageSummary | null; logs: AdminUsageLogsResponse | null; maxDailyCost: number; onServiceClick: (service: string) => void }) {
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
        <Card title="服务类型"><Breakdown rows={summary?.service_breakdown || []} onClickName={onServiceClick} /></Card>
      </div>
      <RecentLogs logs={logs} />
    </div>
  );
}

function Ledger({ filters, updateFilter, logs, page, setPage, loading, error, showAdvancedFilters, setShowAdvancedFilters, onSelect, onClear }: { filters: UsageFilters; updateFilter: (key: keyof UsageFilters, value: string) => void; logs: AdminUsageLogsResponse | null; page: number; setPage: (page: number) => void; loading: boolean; error?: string; showAdvancedFilters: boolean; setShowAdvancedFilters: (value: boolean) => void; onSelect: (log: AdminUsageLog) => void; onClear: () => void }) {
  const total = logs?.total || 0;
  const pageSize = logs?.page_size || 50;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="space-y-6">
      <Card title="账本筛选">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Select label="模块" value={filters.module} onChange={(v) => updateFilter("module", v)} options={["creative", "work", "workspace", "chat", "system"]} />
          <Select label="功能" value={filters.feature} onChange={(v) => updateFilter("feature", v)} options={["image", "video", "translator", "ppt", "document_reader", "notebook", "chat"]} />
          <Select label="服务" value={filters.service} onChange={(v) => updateFilter("service", v)} options={["chat", "image_generation", "image_edit", "image_utility", "video_generation", "translation", "vision", "document_generation", "embedding"]} />
          <Input label="搜索" value={filters.q} onChange={(v) => updateFilter("q", v)} placeholder="模型 / provider / 错误 / request" icon={<Search className="h-4 w-4" />} />
        </div>
        <button type="button" onClick={() => setShowAdvancedFilters(!showAdvancedFilters)} className="mt-3 inline-flex items-center gap-2 rounded-xl px-2 py-1 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary"><ChevronDown className={cn("h-4 w-4 transition-transform", showAdvancedFilters && "rotate-180")} />{showAdvancedFilters ? "收起高级筛选" : "展开高级筛选"}</button>
        {showAdvancedFilters && <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Input label="操作" value={filters.operation} onChange={(v) => updateFilter("operation", v)} placeholder="text_to_image / remove_bg" />
          <Input label="Provider" value={filters.provider} onChange={(v) => updateFilter("provider", v)} placeholder="openai / volcengine" />
          <Input label="模型" value={filters.model} onChange={(v) => updateFilter("model", v)} placeholder="模型名" />
          <Select label="状态" value={filters.status} onChange={(v) => updateFilter("status", v)} options={["success", "failed", "estimated", "missing_usage"]} />
          <Input label="用户 ID" value={filters.userId} onChange={(v) => updateFilter("userId", v)} placeholder="123" />
          <Input label="资源类型" value={filters.resourceType} onChange={(v) => updateFilter("resourceType", v)} placeholder="video_generation" />
          <Input label="资源 ID" value={filters.resourceId} onChange={(v) => updateFilter("resourceId", v)} placeholder="456" />
          <Input label="Request / Task ID" value={filters.requestId} onChange={(v) => updateFilter("requestId", v)} placeholder="火山 task id" />
        </div>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="text-text-secondary">筛选结果：<span className="font-semibold text-text-primary">{formatNumber(total)}</span> 条 · 合计 <span className="font-semibold text-text-primary">{formatRMB(logs?.summary?.cost_rmb || 0)}</span> · Tokens {formatNumber(logs?.summary?.total_tokens || 0)} · 字符 {formatNumber(logs?.summary?.character_count || 0)} · 视频 {formatNumber(logs?.summary?.video_seconds || 0)}s</div>
          <button onClick={onClear} className="rounded-xl border border-surface-border px-3 py-2 text-text-secondary hover:text-text-primary">清空筛选</button>
        </div>
      </Card>

      <Card title="账本明细">
        {loading && <div className="mb-3 rounded-xl bg-surface-elevated px-3 py-2 text-sm text-text-secondary">正在刷新账本…</div>}
        {error && <InlineError message={error} />}
        <Table headers={["时间", "产品/功能/操作", "服务", "用户", "业务对象", "Provider / 模型", "用量", "官方单价", "成本", "状态"]}>
          {(logs?.logs || []).map((log) => (
            <tr key={log.id} onClick={() => onSelect(log)} className="cursor-pointer border-t border-surface-border align-top hover:bg-surface-elevated/40">
              <td className="whitespace-nowrap py-3 pr-4 text-xs">{formatDateTime(log.created_at)}</td>
              <td className="min-w-[210px] pr-4"><div className="font-medium text-text-primary">{log.module || "-"} / {log.feature || "-"}</div><div className="text-xs text-text-tertiary">{log.operation || "-"}</div></td>
              <td className="pr-4"><StatusBadge tone="blue">{log.service || "unknown"}</StatusBadge></td>
              <td className="pr-4 text-xs">{log.user_id ? `U:${log.user_id}` : log.guest_id ? `G:${log.guest_id}` : "-"}</td>
              <td className="min-w-[180px] pr-4 text-xs text-text-tertiary"><div>{log.resource_type || "-"}:{log.resource_id || "-"}</div><div>C:{log.conversation_id || "-"} M:{log.message_id || "-"}</div><div className="max-w-[180px] truncate">Req:{log.request_id || "-"}</div></td>
              <td className="max-w-[260px] pr-4"><div className="text-text-secondary">{log.provider || "-"}</div><div className="truncate font-medium text-text-primary">{log.model || "-"}</div></td>
              <td className="min-w-[150px] pr-4 text-xs"><UsageNumbers log={log} /></td>
              <td className="min-w-[160px] pr-4 text-xs text-text-tertiary">{formatSourcePrice(log)}</td>
              <td className="pr-4 font-semibold text-text-primary">{formatRMB(log.total_cost_rmb)}</td>
              <td><StatusBadge tone={log.status === "success" ? "green" : log.status === "failed" ? "red" : "amber"}>{log.estimated ? `${log.status} · 估` : log.status || "unknown"}</StatusBadge></td>
            </tr>
          ))}
        </Table>
        {(logs?.logs || []).length === 0 && <Empty />}
        <div className="mt-4 flex items-center justify-between text-sm text-text-secondary">
          <span>第 {page} / {maxPage} 页</span>
          <div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))} className="rounded-xl border border-surface-border px-3 py-2 disabled:opacity-40">上一页</button><button disabled={page >= maxPage} onClick={() => setPage(Math.min(maxPage, page + 1))} className="rounded-xl border border-surface-border px-3 py-2 disabled:opacity-40">下一页</button></div>
        </div>
      </Card>
    </div>
  );
}

function UsersUsage({ users, error, onSelectUser }: { users: AdminUsageUsersResponse | null; error?: string; onSelectUser: (user: AdminUsageUserRow) => void }) {
  return (
    <Card title="用户消耗排行">
      <div className="mb-4 text-sm text-text-secondary">点击用户可查看服务、模型、对话维度详情，并继续下钻到该用户账本。</div>
      {error && <InlineError message={error} />}
      <Table headers={["用户", "模块消耗", "请求", "Token/图片", "成本", "最近使用", "操作"]}>
        {(users?.users || []).map((user) => (
          <tr key={user.user_id} onClick={() => onSelectUser(user)} className="cursor-pointer border-t border-surface-border hover:bg-surface-elevated/40">
            <td className="py-3 pr-4"><div className="font-medium text-text-primary">{user.email || `User #${user.user_id}`}</div><div className="text-xs text-text-tertiary">{user.name || "-"} · ID {user.user_id}</div></td>
            <td className="min-w-[260px] pr-4"><div className="flex flex-wrap gap-1">{(user.services || []).slice(0, 4).map((item) => <span key={item.name} className="rounded-full bg-surface-elevated px-2 py-1 text-xs text-text-secondary">{item.name || "unknown"} {formatRMB(item.cost_rmb)}</span>)}</div></td>
            <td className="pr-4">{formatNumber(user.requests)}</td>
            <td className="pr-4">{formatNumber(user.total_tokens || 0)} / {formatNumber(user.image_count || 0)}</td>
            <td className="font-semibold text-text-primary">{formatRMB(user.cost_rmb)}</td>
            <td className="whitespace-nowrap text-text-tertiary">{formatDateTime(user.last_used_at)}</td>
            <td><button onClick={(event) => { event.stopPropagation(); onSelectUser(user); }} className="rounded-xl border border-surface-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary">详情</button></td>
          </tr>
        ))}
      </Table>
      {(users?.users || []).length === 0 && !error && <Empty />}
    </Card>
  );
}

function ModelsUsage({ models, summary, error }: { models: AdminUsageModelsResponse | null; summary: AdminUsageSummary | null; error?: string }) {
  return <div className="space-y-6">{error && <InlineError message={error} />}<div className="grid gap-6 xl:grid-cols-2"><Card title="服务汇总"><Breakdown rows={summary?.service_breakdown || []} /></Card><Card title="Provider 汇总"><Breakdown rows={summary?.provider_breakdown || []} /></Card></div><Card title="模块 x 模型矩阵"><Table headers={["模块", "Provider", "模型", "请求", "Token", "图片", "成本"]}>{(models?.models || []).map((row) => <tr key={`${row.service}-${row.provider}-${row.model}`} className="border-t border-surface-border"><td className="py-3 pr-4"><StatusBadge tone="blue">{row.service || "unknown"}</StatusBadge></td><td className="pr-4 text-text-secondary">{row.provider || "unknown"}</td><td className="max-w-[340px] truncate pr-4 font-medium text-text-primary">{row.model || "unknown"}</td><td className="pr-4">{formatNumber(row.requests)}</td><td className="pr-4">{formatNumber(row.total_tokens || 0)}</td><td className="pr-4">{formatNumber(row.image_count || 0)}</td><td className="font-semibold text-text-primary">{formatRMB(row.cost_rmb)}</td></tr>)}</Table></Card></div>;
}


function ModulesUsage({ modules, error, onDrilldown }: { modules: AdminUsageModulesResponse | null; error?: string; onDrilldown: (patch: Partial<UsageFilters>) => void }) {
  const rows = modules?.modules || [];
  const groups = groupModuleRows(rows);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-surface-border bg-surface-card p-6 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">产品模块下钻</h2>
            <p className="mt-1 text-sm text-text-secondary">先看模块，再展开到功能和操作；点击任意层级可进入账本明细。</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-2xl bg-surface-elevated px-4 py-3"><div className="text-text-tertiary">模块</div><div className="font-semibold text-text-primary">{groups.length}</div></div>
            <div className="rounded-2xl bg-surface-elevated px-4 py-3"><div className="text-text-tertiary">调用</div><div className="font-semibold text-text-primary">{formatNumber(sumRows(rows, "requests"))}</div></div>
            <div className="rounded-2xl bg-surface-elevated px-4 py-3"><div className="text-text-tertiary">成本</div><div className="font-semibold text-text-primary">{formatRMB(sumRows(rows, "cost_rmb"))}</div></div>
          </div>
        </div>
        {error && <div className="mt-4"><InlineError message={error} /></div>}
        {rows.length === 0 && !error && <div className="mt-4"><Empty /></div>}
      </div>

      {groups.map((group) => (
        <section key={group.module} className="rounded-3xl border border-surface-border bg-surface-card p-5 shadow-sm">
          <div className="flex flex-col gap-3 border-b border-surface-border pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-brand/10 px-3 py-1 text-sm font-medium text-brand">{group.module}</span>
                <span className="text-sm text-text-tertiary">{group.features.length} 个功能</span>
              </div>
              <div className="mt-2 text-sm text-text-secondary">{formatNumber(group.requests)} 次调用 · 失败 {formatNumber(group.failures)} · 最近 {formatDateTime(group.lastUsedAt)}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-2xl bg-surface-elevated px-4 py-2 text-right"><div className="text-xs text-text-tertiary">成本</div><div className="font-semibold text-text-primary">{formatRMB(group.cost)}</div></div>
              <button onClick={() => onDrilldown({ module: group.module })} className="rounded-xl border border-surface-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary">看模块明细</button>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {group.features.map((feature) => (
              <div key={`${group.module}-${feature.feature}`} className="rounded-2xl bg-surface-elevated p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium text-text-primary">{feature.feature}</div>
                    <div className="text-xs text-text-tertiary">{formatNumber(feature.requests)} 次 · {formatRMB(feature.cost)} · {feature.operations.length} 个操作</div>
                  </div>
                  <button onClick={() => onDrilldown({ module: group.module, feature: feature.feature })} className="rounded-xl border border-surface-border bg-surface-card px-3 py-2 text-sm text-text-secondary hover:text-text-primary">看功能明细</button>
                </div>
                <div className="mt-3 grid gap-2 xl:grid-cols-2">
                  {feature.operations.map((row) => (
                    <button key={`${row.module}-${row.feature}-${row.operation}-${row.service}`} onClick={() => onDrilldown({ module: row.module, feature: row.feature, operation: row.operation, service: row.service })} className="rounded-xl border border-surface-border bg-surface-card p-3 text-left hover:border-brand/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-text-primary">{row.operation || "unknown"}</div>
                          <div className="mt-1 flex flex-wrap gap-1 text-xs text-text-tertiary"><span>{row.service || "unknown"}</span><span>·</span><span>{formatNumber(row.requests)} 次</span><span>·</span><span>失败 {formatNumber(row.failures || 0)}</span></div>
                        </div>
                        <div className="shrink-0 text-right"><div className="font-semibold text-text-primary">{formatRMB(row.cost_rmb)}</div><div className="text-xs text-text-tertiary">{usageUnitSummary(row)}</div></div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function scenarioStat(rows: AdminUsageModuleRow[], patch: Partial<UsageFilters>) {
  const matched = rows.filter((row) => {
    if (patch.module && row.module !== patch.module) return false;
    if (patch.feature && row.feature !== patch.feature) return false;
    if (patch.operation && row.operation !== patch.operation) return false;
    if (patch.service && row.service !== patch.service) return false;
    return true;
  });
  return {
    requests: matched.reduce((sum, row) => sum + (row.requests || 0), 0),
    cost: matched.reduce((sum, row) => sum + (row.cost_rmb || 0), 0),
  };
}

function groupModuleRows(rows: AdminUsageModuleRow[]) {
  const modules = new Map<string, AdminUsageModuleRow[]>();
  rows.forEach((row) => {
    const key = row.module || "unknown";
    modules.set(key, [...(modules.get(key) || []), row]);
  });

  return Array.from(modules.entries()).map(([module, moduleRows]) => {
    const featuresMap = new Map<string, AdminUsageModuleRow[]>();
    moduleRows.forEach((row) => {
      const key = row.feature || "unknown";
      featuresMap.set(key, [...(featuresMap.get(key) || []), row]);
    });
    const features = Array.from(featuresMap.entries()).map(([feature, featureRows]) => ({
      feature,
      cost: sumRows(featureRows, "cost_rmb"),
      requests: sumRows(featureRows, "requests"),
      operations: [...featureRows].sort((a, b) => (b.cost_rmb || 0) - (a.cost_rmb || 0)),
    })).sort((a, b) => b.cost - a.cost);

    return {
      module,
      features,
      cost: sumRows(moduleRows, "cost_rmb"),
      requests: sumRows(moduleRows, "requests"),
      failures: sumRows(moduleRows, "failures"),
      lastUsedAt: latestDate(moduleRows.map((row) => row.last_used_at)),
    };
  }).sort((a, b) => b.cost - a.cost);
}

function sumRows(rows: AdminUsageModuleRow[], key: keyof Pick<AdminUsageModuleRow, "requests" | "failures" | "cost_rmb">) {
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

function latestDate(values: Array<string | undefined>) {
  return values.filter(Boolean).sort().at(-1) || "";
}

function usageUnitSummary(row: AdminUsageModuleRow) {
  if (row.video_seconds) return `${formatNumber(row.video_seconds)}s`;
  if (row.character_count) return `${formatNumber(row.character_count)} 字`;
  if (row.image_count) return `${formatNumber(row.image_count)} 图`;
  if (row.total_tokens) return `${formatNumber(row.total_tokens)} tok`;
  return "-";
}

function ConversationsUsage({ conversations, error }: { conversations: AdminUsageConversationsResponse | null; error?: string }) {
  return <Card title="对话消耗排行">{error && <InlineError message={error} />}<Table headers={["对话", "用户", "模型", "请求", "Token", "成本", "最近使用"]}>{(conversations?.conversations || []).map((item) => <tr key={item.conversation_id} className="border-t border-surface-border"><td className="py-3 pr-4"><div className="max-w-[280px] truncate font-medium text-text-primary">{item.title || `Conversation #${item.conversation_id}`}</div><div className="text-xs text-text-tertiary">ID {item.conversation_id}</div></td><td className="pr-4 text-text-secondary">{item.email || item.user_id || "-"}</td><td className="min-w-[260px] pr-4"><div className="flex flex-wrap gap-1">{(item.models || []).slice(0, 3).map((model) => <span key={`${item.conversation_id}-${model.provider}-${model.model}`} className="rounded-full bg-surface-elevated px-2 py-1 text-xs text-text-secondary">{model.model || "unknown"} {formatRMB(model.cost_rmb)}</span>)}</div></td><td className="pr-4">{formatNumber(item.requests)}</td><td className="pr-4">{formatNumber(item.total_tokens || 0)}</td><td className="font-semibold text-text-primary">{formatRMB(item.cost_rmb)}</td><td className="whitespace-nowrap text-text-tertiary">{formatDateTime(item.last_used_at)}</td></tr>)}</Table></Card>;
}

function RecentLogs({ logs }: { logs: AdminUsageLogsResponse | null }) {
  return <Card title="最近调用记录"><Table headers={["时间", "产品/操作", "服务", "Provider", "模型", "Token", "成本", "状态"]}>{(logs?.logs || []).slice(0, 12).map((log) => <tr key={log.id} className="border-t border-surface-border"><td className="whitespace-nowrap py-3 pr-4">{formatDateTime(log.created_at)}</td><td className="pr-4 text-xs"><div>{log.module || "-"}/{log.feature || "-"}</div><div className="text-text-tertiary">{log.operation || "-"}</div></td><td className="pr-4">{log.service || "-"}</td><td className="pr-4">{log.provider || "-"}</td><td className="max-w-[220px] truncate pr-4">{log.model || "-"}</td><td className="pr-4">{formatNumber(log.total_tokens)}</td><td className="pr-4">{formatRMB(log.total_cost_rmb)}</td><td><StatusBadge tone={log.status === "success" ? "green" : log.status === "failed" ? "red" : "amber"}>{log.estimated ? `${log.status} · 估` : log.status || "unknown"}</StatusBadge></td></tr>)}</Table></Card>;
}

function UsageNumbers({ log }: { log: AdminUsageLog }) {
  const parts = [
    log.prompt_tokens ? `in ${formatNumber(log.prompt_tokens)}` : "",
    log.completion_tokens ? `out ${formatNumber(log.completion_tokens)}` : "",
    log.total_tokens ? `total ${formatNumber(log.total_tokens)}` : "",
    log.image_count ? `img ${formatNumber(log.image_count)}` : "",
    log.character_count ? `char ${formatNumber(log.character_count)}` : "",
    log.video_seconds ? `video ${formatNumber(log.video_seconds)}s` : "",
  ].filter(Boolean);
  return <>{parts.length ? parts.map((part) => <div key={part}>{part}</div>) : "-"}</>;
}

function UserUsageDrawer({ detail, logs, loading, error, range, onClose, onDrilldownLedger, onSelectLog, onSelectConversation }: { detail: AdminUsageUserDetail | null; logs: AdminUsageLog[]; loading: boolean; error: string; range: string; onClose: () => void; onDrilldownLedger: (userId: number) => void; onSelectLog: (log: AdminUsageLog) => void; onSelectConversation: (conversationId: number) => void }) {
  const user = detail?.user;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-3xl overflow-y-auto border-l border-surface-border bg-surface-card p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-brand">用户用量详情 · {range}</p>
            <h2 className="mt-1 text-xl font-semibold text-text-primary">{user ? (user.email || `User #${user.id}`) : "正在加载用户…"}</h2>
            {user && <p className="mt-1 text-sm text-text-tertiary">{user.name || "-"} · ID {user.id} · {user.plan_tier || "-"} · {user.role}</p>}
          </div>
          <button onClick={onClose} className="rounded-xl border border-surface-border px-3 py-2 text-sm text-text-secondary">关闭</button>
        </div>

        {loading && <div className="rounded-2xl bg-surface-elevated p-5 text-sm text-text-secondary">正在加载用户详情…</div>}
        {error && <InlineError message={error} />}
        {detail && (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MiniMetric label="成本" value={formatRMB(detail.summary.cost_rmb || 0)} />
              <MiniMetric label="调用" value={formatNumber(detail.summary.requests || 0)} />
              <MiniMetric label="Tokens" value={formatNumber(detail.summary.total_tokens || 0)} />
              <MiniMetric label="图片/字符/视频" value={`${formatNumber(detail.summary.image_count || 0)} / ${formatNumber(detail.summary.character_count || 0)} / ${formatNumber(detail.summary.video_seconds || 0)}s`} />
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={() => onDrilldownLedger(detail.user.id)} className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">查看该用户账本明细</button>
              <button onClick={onClose} className="rounded-xl border border-surface-border px-4 py-2 text-sm text-text-secondary hover:text-text-primary">返回</button>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <Card title="服务消耗">
                <Breakdown rows={detail.services || []} />
              </Card>
              <Card title="模型消耗 Top">
                <Table headers={["Provider", "模型", "请求", "Token", "成本"]}>
                  {(detail.models || []).slice(0, 12).map((row) => <tr key={`${row.provider}-${row.model}`} className="border-t border-surface-border"><td className="py-3 pr-4 text-text-secondary">{row.provider || "-"}</td><td className="max-w-[220px] truncate pr-4 font-medium text-text-primary">{row.model || "-"}</td><td className="pr-4">{formatNumber(row.requests)}</td><td className="pr-4">{formatNumber(row.total_tokens || 0)}</td><td className="font-semibold text-text-primary">{formatRMB(row.cost_rmb)}</td></tr>)}
                </Table>
                {(detail.models || []).length === 0 && <Empty />}
              </Card>
            </div>

            <Card title="对话消耗 Top">
              <Table headers={["对话", "请求", "Token", "成本", "最近使用"]}>
                {(detail.conversations || []).map((item) => <tr key={item.conversation_id} onClick={() => onSelectConversation(item.conversation_id)} className="cursor-pointer border-t border-surface-border hover:bg-surface-elevated/40"><td className="py-3 pr-4"><div className="max-w-[360px] truncate font-medium text-text-primary">{item.title || `Conversation #${item.conversation_id}`}</div><div className="text-xs text-text-tertiary">ID {item.conversation_id}</div></td><td className="pr-4">{formatNumber(item.requests)}</td><td className="pr-4">{formatNumber(item.total_tokens || 0)}</td><td className="font-semibold text-text-primary">{formatRMB(item.cost_rmb)}</td><td className="whitespace-nowrap text-text-tertiary">{formatDateTime(item.last_used_at)}</td></tr>)}
              </Table>
              {(detail.conversations || []).length === 0 && <Empty />}
            </Card>

            <Card title="最近 20 条账本记录">
              <Table headers={["时间", "产品/操作", "服务", "模型", "用量", "成本", "状态"]}>
                {logs.map((log) => <tr key={log.id} onClick={() => onSelectLog(log)} className="cursor-pointer border-t border-surface-border hover:bg-surface-elevated/40"><td className="whitespace-nowrap py-3 pr-4 text-xs">{formatDateTime(log.created_at)}</td><td className="min-w-[180px] pr-4"><div className="font-medium text-text-primary">{log.module || "-"} / {log.feature || "-"}</div><div className="text-xs text-text-tertiary">{log.operation || "-"}</div></td><td className="pr-4"><StatusBadge tone="blue">{log.service || "unknown"}</StatusBadge></td><td className="max-w-[260px] truncate pr-4"><div className="text-xs text-text-tertiary">{log.provider || "-"}</div><div className="truncate font-medium text-text-primary">{log.model || "-"}</div></td><td className="pr-4 text-xs"><UsageNumbers log={log} /></td><td className="font-semibold text-text-primary">{formatRMB(log.total_cost_rmb)}</td><td><StatusBadge tone={log.status === "success" ? "green" : log.status === "failed" ? "red" : "amber"}>{log.estimated ? `${log.status} · 估` : log.status || "unknown"}</StatusBadge></td></tr>)}
              </Table>
              {logs.length === 0 && !loading && <Empty />}
              <div className="mt-3 text-xs text-text-tertiary">点击任一记录可打开单条账本详情。</div>
            </Card>
          </div>
        )}
      </aside>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-surface-elevated px-4 py-3"><div className="text-xs text-text-tertiary">{label}</div><div className="mt-1 font-semibold text-text-primary">{value}</div></div>;
}

function ConversationUsageDrawer({ detail, loading, error, range, onClose, onSelectLog }: { detail: AdminUsageConversationDetail | null; loading: boolean; error: string; range: string; onClose: () => void; onSelectLog: (log: AdminUsageLog) => void }) {
  const conversation = detail?.conversation;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-3xl overflow-y-auto border-l border-surface-border bg-surface-card p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-brand">对话用量详情 · {range}</p>
            <h2 className="mt-1 text-xl font-semibold text-text-primary">{conversation ? (conversation.title || `Conversation #${conversation.id}`) : "正在加载对话…"}</h2>
            {conversation && <p className="mt-1 text-sm text-text-tertiary">ID {conversation.id} · User {conversation.user_id || "-"} · {conversation.model || "-"}</p>}
          </div>
          <button onClick={onClose} className="rounded-xl border border-surface-border px-3 py-2 text-sm text-text-secondary">关闭</button>
        </div>
        {loading && <div className="rounded-2xl bg-surface-elevated p-5 text-sm text-text-secondary">正在加载对话详情…</div>}
        {error && <InlineError message={error} />}
        {detail && (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MiniMetric label="成本" value={formatRMB(detail.summary.cost_rmb || 0)} />
              <MiniMetric label="调用" value={formatNumber(detail.summary.requests || 0)} />
              <MiniMetric label="Tokens" value={formatNumber(detail.summary.total_tokens || 0)} />
              <MiniMetric label="图片/字符/视频" value={`${formatNumber(detail.summary.image_count || 0)} / ${formatNumber(detail.summary.character_count || 0)} / ${formatNumber(detail.summary.video_seconds || 0)}s`} />
            </div>
            <Card title="模型消耗">
              <Table headers={["Provider", "模型", "请求", "Token", "成本"]}>
                {(detail.models || []).map((row) => <tr key={`${row.provider}-${row.model}`} className="border-t border-surface-border"><td className="py-3 pr-4 text-text-secondary">{row.provider || "-"}</td><td className="max-w-[260px] truncate pr-4 font-medium text-text-primary">{row.model || "-"}</td><td className="pr-4">{formatNumber(row.requests)}</td><td className="pr-4">{formatNumber(row.total_tokens || 0)}</td><td className="font-semibold text-text-primary">{formatRMB(row.cost_rmb)}</td></tr>)}
              </Table>
              {(detail.models || []).length === 0 && <Empty />}
            </Card>
            <Card title="对话内账本记录">
              <Table headers={["时间", "产品/操作", "服务", "模型", "用量", "成本", "状态"]}>
                {(detail.logs || []).map((log) => <tr key={log.id} onClick={() => onSelectLog(log)} className="cursor-pointer border-t border-surface-border hover:bg-surface-elevated/40"><td className="whitespace-nowrap py-3 pr-4 text-xs">{formatDateTime(log.created_at)}</td><td className="min-w-[180px] pr-4"><div className="font-medium text-text-primary">{log.module || "-"} / {log.feature || "-"}</div><div className="text-xs text-text-tertiary">{log.operation || "-"}</div></td><td className="pr-4"><StatusBadge tone="blue">{log.service || "unknown"}</StatusBadge></td><td className="max-w-[260px] truncate pr-4"><div className="text-xs text-text-tertiary">{log.provider || "-"}</div><div className="truncate font-medium text-text-primary">{log.model || "-"}</div></td><td className="pr-4 text-xs"><UsageNumbers log={log} /></td><td className="font-semibold text-text-primary">{formatRMB(log.total_cost_rmb)}</td><td><StatusBadge tone={log.status === "success" ? "green" : log.status === "failed" ? "red" : "amber"}>{log.estimated ? `${log.status} · 估` : log.status || "unknown"}</StatusBadge></td></tr>)}
              </Table>
              {(detail.logs || []).length === 0 && <Empty />}
              <div className="mt-3 text-xs text-text-tertiary">点击任一记录可打开单条账本详情。</div>
            </Card>
          </div>
        )}
      </aside>
    </div>
  );
}

function UsageLogDrawer({ log, onClose }: { log: AdminUsageLog; onClose: () => void }) {
  const debugText = [
    `usage_log_id=${log.id}`,
    `request_id=${log.request_id || ""}`,
    `user_id=${log.user_id || ""}`,
    `guest_id=${log.guest_id || ""}`,
    `conversation_id=${log.conversation_id || ""}`,
    `message_id=${log.message_id || ""}`,
    `task_id=${log.task_id || ""}`,
    `resource=${log.resource_type || ""}:${log.resource_id || ""}`,
    `service=${log.service || ""}`,
    `provider=${log.provider || ""}`,
    `model=${log.model || ""}`,
  ].join("\n");
  const copyDebug = () => {
    navigator.clipboard?.writeText(debugText).catch(() => undefined);
  };
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}><aside className="h-full w-full max-w-xl overflow-y-auto border-l border-surface-border bg-surface-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-sm text-brand">Usage Log #{log.id}</p><h2 className="mt-1 text-xl font-semibold text-text-primary">{log.module || "-"} / {log.feature || "-"} / {log.operation || "-"}</h2></div><div className="flex gap-2"><button onClick={copyDebug} className="inline-flex items-center gap-2 rounded-xl border border-surface-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary"><Clipboard className="h-4 w-4" />复制排查字段</button><button onClick={onClose} className="rounded-xl border border-surface-border px-3 py-2 text-sm text-text-secondary">关闭</button></div></div><div className="space-y-4 text-sm"><Detail title="基础信息" rows={{ 时间: formatDateTime(log.created_at), 服务: log.service, Provider: log.provider, 模型: log.model, 状态: log.status, 估算: log.estimated ? "是" : "否" }} /><Detail title="业务关联" rows={{ 用户: log.user_id || log.guest_id || "-", 资源: `${log.resource_type || "-"}:${log.resource_id || "-"}`, 对话: log.conversation_id || "-", 消息: log.message_id || "-", 任务: log.task_id || "-", RequestID: log.request_id || "-" }} /><Detail title="排查字段" rows={{ UsageLogID: log.id, RequestID: log.request_id || "-", UserID: log.user_id || "-", GuestID: log.guest_id || "-", ConversationID: log.conversation_id || "-", MessageID: log.message_id || "-", TaskID: log.task_id || "-", Resource: `${log.resource_type || "-"}:${log.resource_id || "-"}` }} /><Detail title="用量" rows={{ PromptTokens: log.prompt_tokens || 0, CompletionTokens: log.completion_tokens || 0, TotalTokens: log.total_tokens || 0, ImageCount: log.image_count || 0, Characters: log.character_count || 0, VideoSeconds: log.video_seconds || 0 }} /><Detail title="价格快照" rows={{ 官方币种: log.source_currency || "-", 官方单位: log.source_unit || log.pricing_unit || "-", 官方输入价: log.source_input_price ?? "-", 官方输出价: log.source_output_price ?? "-", 官方图片价: log.source_image_price ?? "-", 官方请求价: log.source_request_price ?? "-", 汇率: log.exchange_rate_to_rmb ?? "-", 成本: formatRMB(log.total_cost_rmb) }} />{log.error_message && <Detail title="错误" rows={{ Error: log.error_message }} />}</div></aside></div>;
}

function Detail({ title, rows }: { title: string; rows: Record<string, string | number> }) {
  return <section className="rounded-2xl bg-surface-elevated p-4"><h3 className="mb-3 font-medium text-text-primary">{title}</h3><div className="space-y-2">{Object.entries(rows).map(([key, value]) => <div key={key} className="grid grid-cols-[110px_1fr] gap-3"><span className="text-text-tertiary">{key}</span><span className="break-all text-text-secondary">{value}</span></div>)}</div></section>;
}

function Breakdown({ rows, onClickName }: { rows: Array<{ name: string; requests: number; cost_rmb: number; failures?: number; tokens?: number }>; onClickName?: (name: string) => void }) {
  if (rows.length === 0) return <Empty />;
  return <div className="space-y-3">{rows.map((item) => <button key={item.name || "unknown"} onClick={() => onClickName?.(item.name)} className={cn("block w-full rounded-2xl bg-surface-elevated px-4 py-3 text-left", onClickName && "hover:bg-surface-hover") }><div className="flex items-center justify-between text-sm"><span className="font-medium text-text-primary">{item.name || "unknown"}</span><span className="font-semibold text-text-primary">{formatRMB(item.cost_rmb)}</span></div><div className="mt-1 text-xs text-text-tertiary">{formatNumber(item.requests)} 次 · 失败 {formatNumber(item.failures || 0)}{item.tokens ? ` · ${formatNumber(item.tokens)} tokens` : ""}</div></button>)}</div>;
}

function ModelMini({ rows }: { rows: Array<{ model: string; provider: string; cost_rmb: number; requests: number; tokens: number }> }) {
  if (rows.length === 0) return <Empty />;
  return <div className="space-y-3">{rows.map((item) => <div key={`${item.provider}-${item.model}`} className="flex items-center justify-between rounded-2xl bg-surface-elevated px-4 py-3 text-sm"><div><div className="font-medium text-text-primary">{item.model || "unknown"}</div><div className="text-xs text-text-tertiary">{item.provider || "unknown"} · {formatNumber(item.tokens)} tokens</div></div><div className="text-right"><div className="font-semibold text-text-primary">{formatRMB(item.cost_rmb)}</div><div className="text-xs text-text-tertiary">{formatNumber(item.requests)} 次</div></div></div>)}</div>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="text-sm"><span className="mb-1 block text-text-tertiary">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 text-text-primary outline-none focus:border-brand"><option value="">全部</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function Input({ label, value, onChange, placeholder, icon }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; icon?: React.ReactNode }) {
  return <label className="text-sm"><span className="mb-1 block text-text-tertiary">{label}</span><div className="flex items-center gap-2 rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 focus-within:border-brand">{icon}<input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-tertiary" /></div></label>;
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

function InlineError({ message }: { message: string }) {
  return <div className="mb-3 flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300"><AlertCircle className="h-4 w-4" />{message}</div>;
}

function numberOrUndefined(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function formatSourcePrice(log: AdminUsageLog) {
  const currency = log.source_currency || "";
  const unit = log.source_unit || log.pricing_unit || "";
  const prices = [
    log.source_input_price ? `in ${currency}${log.source_input_price}` : "",
    log.source_output_price ? `out ${currency}${log.source_output_price}` : "",
    log.source_image_price ? `img ${currency}${log.source_image_price}` : "",
    log.source_request_price ? `req ${currency}${log.source_request_price}` : "",
  ].filter(Boolean);
  if (prices.length === 0) return unit || "-";
  return `${prices.join(" / ")} ${unit ? `/ ${unit}` : ""}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
