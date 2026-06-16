"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ChevronLeft, ChevronRight, ExternalLink, Filter,
  Loader2, RefreshCw, Search, Shield, SlidersHorizontal, Users, Wallet,
  X, TrendingUp, Clock, Mail, CreditCard, Tag, CheckCircle2, XCircle
} from "lucide-react";
import { getAdminUsers, updateAdminUser } from "@/lib/admin/api";
import type { AdminUser, AdminUsersResponse, AdminUserUsageSummary } from "@/lib/admin/types";
import { formatDateTime, formatNumber, formatRMB } from "@/lib/admin/format";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { MetricCard } from "@/components/admin/MetricCard";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const PLAN_OPTIONS = ["free", "basic", "plus", "ultra"];

export default function AdminUsersPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [roleFilter, setRoleFilter] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [betaFilter, setBetaFilter] = useState("");

  const totalPages = useMemo(() => Math.max(1, Math.ceil((data?.total || 0) / PAGE_SIZE)), [data?.total]);

  const usageRollup = useMemo(() => {
    return (data?.users || []).reduce((acc, user) => {
      const usage = user.usage_30d;
      if (!usage) return acc;
      acc.cost += usage.cost_rmb || 0;
      acc.requests += usage.requests || 0;
      acc.images += usage.image_count || 0;
      acc.video += usage.video_seconds || 0;
      return acc;
    }, { cost: 0, requests: 0, images: 0, video: 0 });
  }, [data?.users]);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
    if (q.trim()) params.q = q.trim();
    if (roleFilter) params.role = roleFilter;
    if (planFilter) params.plan_tier = planFilter;
    getAdminUsers(params)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "加载用户列表失败"))
      .finally(() => setLoading(false));
  }, [page, q, roleFilter, planFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setTimeout(load, 0);
  };

  const patchUser = async (user: AdminUser, patch: Partial<AdminUser>) => {
    const riskyRoleChange = patch.role && patch.role !== user.role;
    if (riskyRoleChange && !window.confirm(`确认将 ${user.email} 的角色改为 ${patch.role}？`)) return;
    setSavingId(user.id);
    try {
      const updated = await updateAdminUser(user.id, patch);
      setData((prev) =>
        prev
          ? { ...prev, users: prev.users.map((item) => (item.id === user.id ? updated.user : item)) }
          : prev
      );
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingId(null);
    }
  };

  const filteredUsers = useMemo(() => {
    let users = data?.users || [];
    if (betaFilter) {
      users = users.filter((u) => {
        if (betaFilter === "none") return !u.beta_phase;
        return u.beta_phase === betaFilter;
      });
    }
    return users;
  }, [data?.users, betaFilter]);

  const activeFilterCount = [roleFilter, planFilter, betaFilter].filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl border border-surface-border bg-surface-card p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-text-primary">
              <Users className="h-6 w-6 text-brand" />
              用户管理
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              搜索用户、调整套餐/积分，查看 30 天成本、媒体用量和风险标签。
            </p>
          </div>
          <form onSubmit={handleSearch} className="flex w-full gap-2 lg:w-auto">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 lg:w-80">
              <Search className="h-4 w-4 shrink-0 text-text-tertiary" />
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="搜索邮箱、昵称或 ID"
                className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              />
            </div>
            <button
              type="submit"
              className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
            >
              搜索
            </button>
            <button
              type="button"
              onClick={() => setFilterOpen((prev) => !prev)}
              className={cn(
                "relative rounded-xl border px-3 py-2 transition-colors",
                activeFilterCount > 0
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-surface-border bg-surface-elevated text-text-secondary hover:text-text-primary"
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[10px] text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={load}
              className="rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 text-text-secondary hover:text-text-primary"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </form>
        </div>

        {/* Filter Panel */}
        {filterOpen && (
          <div className="mt-4 grid gap-3 rounded-xl border border-surface-border bg-surface-elevated p-4 md:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">角色</label>
              <select
                value={roleFilter}
                onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
                className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-text-primary outline-none"
              >
                <option value="">全部角色</option>
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">套餐</label>
              <select
                value={planFilter}
                onChange={(e) => { setPlanFilter(e.target.value); setPage(1); }}
                className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-text-primary outline-none"
              >
                <option value="">全部套餐</option>
                {PLAN_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">内测阶段</label>
              <select
                value={betaFilter}
                onChange={(e) => { setBetaFilter(e.target.value); setPage(1); }}
                className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-text-primary outline-none"
              >
                <option value="">全部</option>
                <option value="none">未参与</option>
                <option value="phase_1">试探期</option>
                <option value="phase_2">深水区</option>
                <option value="phase_3">枯竭期</option>
                <option value="completed">已完成</option>
              </select>
            </div>
            {activeFilterCount > 0 && (
              <div className="md:col-span-3 flex justify-end">
                <button
                  onClick={() => {
                    setRoleFilter("");
                    setPlanFilter("");
                    setBetaFilter("");
                    setPage(1);
                  }}
                  className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
                >
                  <X className="h-3 w-3" />
                  清除筛选
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          title="当前页用户"
          value={formatNumber(data?.users?.length || 0)}
          icon={Users}
          helper={`共 ${formatNumber(data?.total || 0)} 个用户`}
        />
        <MetricCard
          title="30d 成本"
          value={formatRMB(usageRollup.cost)}
          icon={Wallet}
          helper={`${formatNumber(usageRollup.requests)} 次调用`}
        />
        <MetricCard
          title="图片"
          value={formatNumber(usageRollup.images)}
          icon={TrendingUp}
          helper="当前页用户 30d"
        />
        <MetricCard
          title="视频秒数"
          value={`${formatNumber(usageRollup.video)}s`}
          icon={TrendingUp}
          helper="当前页用户 30d"
        />
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-surface-border bg-surface-card shadow-sm">
        <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
          <div className="text-sm text-text-secondary">
            共 <span className="font-medium text-text-primary">{formatNumber(data?.total || 0)}</span> 个用户
            {activeFilterCount > 0 && (
              <span className="ml-2 text-xs text-brand">（已筛选 {activeFilterCount} 项）</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-tertiary">
              Page {page} / {totalPages}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex h-72 items-center justify-center text-sm text-text-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-brand" />
            正在加载用户…
          </div>
        ) : error ? (
          <div className="flex h-72 flex-col items-center justify-center text-sm text-red-600">
            <AlertCircle className="mb-2 h-5 w-5" />
            {error}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="bg-surface-elevated text-xs uppercase text-text-tertiary">
                <tr>
                  <th className="px-4 py-3 font-medium w-48">用户</th>
                  <th className="px-4 py-3 font-medium w-32">角色/套餐</th>
                  <th className="px-4 py-3 font-medium w-28">内测阶段</th>
                  <th className="px-4 py-3 font-medium w-40">积分</th>
                  <th className="px-4 py-3 font-medium w-28">30d 成本</th>
                  <th className="px-4 py-3 font-medium w-36">30d 用量</th>
                  <th className="px-4 py-3 font-medium w-28">风险</th>
                  <th className="px-4 py-3 font-medium w-32">最近使用</th>
                  <th className="px-4 py-3 font-medium w-24">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {filteredUsers.map((user) => {
                  const usage = user.usage_30d;
                  return (
                    <tr key={user.id} className="hover:bg-surface-elevated/50">
                      {/* User */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand text-xs font-bold">
                            {(user.name || user.email || "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-text-primary">{user.name || user.email}</div>
                            <div className="mt-0.5 flex items-center gap-1 text-xs text-text-tertiary">
                              <Mail className="h-3 w-3" />
                              <span className="truncate">{user.email}</span>
                            </div>
                            <div className="text-xs text-text-tertiary">ID: {user.id}</div>
                          </div>
                        </div>
                      </td>

                      {/* Role/Plan */}
                      <td className="px-4 py-3 align-top">
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5">
                            <select
                              disabled={savingId === user.id}
                              value={user.role}
                              onChange={(event) =>
                                patchUser(user, { role: event.target.value as AdminUser["role"] })
                              }
                              className="rounded-lg border border-surface-border bg-surface-elevated px-2 py-1 text-xs text-text-primary outline-none"
                            >
                              <option value="user">user</option>
                              <option value="admin">admin</option>
                            </select>
                            {user.role === "admin" && (
                              <StatusBadge tone="purple">
                                <Shield className="mr-1 h-3 w-3" />
                                Admin
                              </StatusBadge>
                            )}
                          </div>
                          <select
                            disabled={savingId === user.id}
                            value={user.plan_tier || "free"}
                            onChange={(event) => patchUser(user, { plan_tier: event.target.value })}
                            className="block rounded-lg border border-surface-border bg-surface-elevated px-2 py-1 text-xs text-text-primary outline-none"
                          >
                            {PLAN_OPTIONS.map((plan) => (
                              <option key={plan} value={plan}>
                                {plan}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>

                      {/* Beta Phase */}
                      <td className="px-4 py-3 align-top">
                        {user.beta_phase ? (
                          <div className="flex flex-col gap-1">
                            <StatusBadge tone={getBetaPhaseTone(user.beta_phase)}>
                              {user.beta_phase_name || user.beta_phase}
                            </StatusBadge>
                            <span className="text-xs text-text-tertiary">
                              {getBetaPhaseDesc(user.beta_phase)}
                            </span>
                          </div>
                        ) : (
                          <StatusBadge tone="neutral">未参与</StatusBadge>
                        )}
                      </td>

                      {/* Credits */}
                      <td className="px-4 py-3 text-xs">
                        <div className="space-y-1.5">
                          <CreditInput
                            label="基础"
                            value={user.basic_credits}
                            disabled={savingId === user.id}
                            onSave={(value) => patchUser(user, { basic_credits: value })}
                          />
                          <CreditInput
                            label="高级"
                            value={user.advanced_credits}
                            disabled={savingId === user.id}
                            onSave={(value) => patchUser(user, { advanced_credits: value })}
                          />
                          <CreditInput
                            label="精英"
                            value={user.elite_credits}
                            disabled={savingId === user.id}
                            onSave={(value) => patchUser(user, { elite_credits: value })}
                          />
                        </div>
                      </td>

                      {/* 30d Cost */}
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-text-primary">
                          {formatRMB(usage?.cost_rmb || 0)}
                        </div>
                        <div className="mt-1 text-xs text-text-tertiary">
                          {usage?.requests
                            ? `${formatRMB((usage.cost_rmb || 0) / Math.max(usage.requests, 1))}/次`
                            : "暂无调用"}
                        </div>
                      </td>

                      {/* 30d Usage */}
                      <td className="px-4 py-3 align-top text-xs text-text-secondary">
                        <div>
                          {formatNumber(usage?.requests || 0)} 次 · {formatNumber(usage?.total_tokens || 0)} tok
                        </div>
                        <div className="mt-1 text-text-tertiary">
                          {formatNumber(usage?.image_count || 0)} 图 · {formatNumber(usage?.video_seconds || 0)}s 视频
                        </div>
                      </td>

                      {/* Risk */}
                      <td className="px-4 py-3 align-top">
                        <UserRiskBadges usage={usage} />
                      </td>

                      {/* Last Used */}
                      <td className="px-4 py-3 text-xs text-text-secondary">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-text-tertiary" />
                          {usage?.last_used_at
                            ? formatDateTime(usage.last_used_at)
                            : formatDateTime(user.created_at)}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-col gap-1.5">
                          <a
                            href={`/admin/usage?range=30d&user_id=${user.id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                          >
                            查看成本 <ExternalLink className="h-3 w-3" />
                          </a>
                          <span className="text-[10px] text-text-tertiary">
                            {savingId === user.id ? "保存中…" : "已同步"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-text-tertiary">
                      {data?.users && data.users.length > 0
                        ? "没有符合筛选条件的用户"
                        : "没有找到用户"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-surface-border px-5 py-4">
          <button
            disabled={page <= 1 || loading}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            className="flex items-center gap-1 rounded-xl border border-surface-border px-4 py-2 text-sm text-text-secondary disabled:opacity-40 transition-colors hover:bg-surface-elevated"
          >
            <ChevronLeft className="h-4 w-4" />
            上一页
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = i + 1;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  disabled={loading}
                  className={cn(
                    "h-8 w-8 rounded-lg text-sm font-medium transition-colors",
                    page === p
                      ? "bg-brand text-white"
                      : "text-text-secondary hover:bg-surface-elevated"
                  )}
                >
                  {p}
                </button>
              );
            })}
            {totalPages > 5 && (
              <>
                <span className="px-1 text-text-tertiary">…</span>
                <button
                  onClick={() => setPage(totalPages)}
                  className="h-8 w-8 rounded-lg text-sm text-text-secondary hover:bg-surface-elevated"
                >
                  {totalPages}
                </button>
              </>
            )}
          </div>
          <button
            disabled={page >= totalPages || loading}
            onClick={() => setPage((prev) => prev + 1)}
            className="flex items-center gap-1 rounded-xl border border-surface-border px-4 py-2 text-sm text-text-secondary disabled:opacity-40 transition-colors hover:bg-surface-elevated"
          >
            下一页
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function UserRiskBadges({ usage }: { usage?: AdminUserUsageSummary }) {
  if (!usage || usage.requests === 0)
    return <StatusBadge tone="neutral">暂无成本</StatusBadge>;
  const failureRate = usage.requests ? (usage.failures || 0) / usage.requests : 0;
  const badges: Array<{ label: string; tone: "red" | "purple" | "blue" | "green" | "neutral" }> = [];
  if ((usage.cost_rmb || 0) >= 50) badges.push({ label: "高成本", tone: "red" });
  if (failureRate >= 0.2) badges.push({ label: "失败偏高", tone: "red" });
  if ((usage.video_seconds || 0) > 0) badges.push({ label: "视频", tone: "purple" });
  if ((usage.image_count || 0) >= 20) badges.push({ label: "图片重度", tone: "blue" });
  if (badges.length === 0) badges.push({ label: "正常", tone: "green" });
  return (
    <div className="flex max-w-[180px] flex-wrap gap-1">
      {badges.slice(0, 3).map((badge) => (
        <StatusBadge key={badge.label} tone={badge.tone}>
          {badge.label}
        </StatusBadge>
      ))}
    </div>
  );
}

function getBetaPhaseTone(phase: string): "red" | "orange" | "amber" | "green" | "neutral" {
  switch (phase) {
    case "phase_1":
      return "green";
    case "phase_2":
      return "amber";
    case "phase_3":
      return "orange";
    case "completed":
      return "neutral";
    default:
      return "neutral";
  }
}

function getBetaPhaseDesc(phase: string): string {
  switch (phase) {
    case "phase_1":
      return "试探期 50积分";
    case "phase_2":
      return "深水区 150积分";
    case "phase_3":
      return "枯竭期 100积分";
    case "completed":
      return "内测已完成";
    default:
      return "";
  }
}

function CreditInput({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const parsed = Number(draft);
  const changed = parsed !== value && Number.isFinite(parsed) && parsed >= 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 text-[10px] text-text-tertiary">{label}</span>
      <input
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="w-20 rounded-lg border border-surface-border bg-surface-elevated px-2 py-1 text-xs text-text-primary outline-none focus:border-brand/50"
      />
      <button
        disabled={!changed || disabled}
        onClick={() => onSave(parsed)}
        className={cn(
          "rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
          changed ? "bg-brand text-white hover:bg-brand-hover" : "text-text-tertiary"
        )}
      >
        保存
      </button>
    </div>
  );
}
