"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  AlertCircle, ChevronLeft, ChevronRight, ExternalLink, Filter,
  Loader2, RefreshCw, Search, Shield, SlidersHorizontal, Users, Wallet,
  X, TrendingUp, Clock, Mail, CreditCard, Tag, CheckCircle2, XCircle, Coins,
 ChevronDown, ChevronUp, Pencil, Save, Ban
} from "lucide-react";
import { getAdminUsers, updateAdminUser, adjustUserCredits } from "@/lib/admin/api";
import type { AdminUser, AdminUsersResponse, AdminUserUsageSummary } from "@/lib/admin/types";
import { formatDateTime, formatNumber, formatRMB } from "@/lib/admin/format";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { MetricCard } from "@/components/admin/MetricCard";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const PLAN_OPTIONS = ["free", "basic", "plus", "ultra"];

export default function AdminUsersPage() {
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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingCredits, setEditingCredits] = useState<Record<number, boolean>>({});
  const [adjustOpen, setAdjustOpen] = useState<number | null>(null);

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
        <MetricCard title="当前页用户" value={formatNumber(data?.users?.length || 0)} icon={Users} helper={`共 ${formatNumber(data?.total || 0)} 个用户`} />
        <CostBreakdownCard cost={usageRollup.cost} images={usageRollup.images} video={usageRollup.video} requests={usageRollup.requests} />
        <MetricCard title="图片" value={formatNumber(usageRollup.images)} icon={TrendingUp} helper={`≈ ${formatRMB(usageRollup.images * 0.5)} 成本`} />
        <MetricCard title="视频秒数" value={`${formatNumber(usageRollup.video)}s`} icon={TrendingUp} helper={`≈ ${formatRMB(usageRollup.video * 0.1)} 成本`} />
      </div>

      {/* User Cards */}
      <div className="space-y-3">
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
        ) : filteredUsers.length === 0 ? (
          <div className="flex h-72 flex-col items-center justify-center text-sm text-text-tertiary">
            <Users className="mb-2 h-8 w-8 opacity-40" />
            {data?.users && data.users.length > 0 ? "没有符合筛选条件的用户" : "没有找到用户"}
          </div>
        ) : (
          filteredUsers.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              isExpanded={expandedId === user.id}
              isEditing={editingCredits[user.id] || false}
              isSaving={savingId === user.id}
              isAdjustOpen={adjustOpen === user.id}
              onToggleExpand={() => setExpandedId(expandedId === user.id ? null : user.id)}
              onToggleEdit={() => setEditingCredits((prev) => ({ ...prev, [user.id]: !prev[user.id] }))}
              onToggleAdjust={() => setAdjustOpen(adjustOpen === user.id ? null : user.id)}
              onPatch={patchUser}
              onAdjust={async (tier, amount, mode, reason) => {
                setSavingId(user.id);
                try {
                  const res = await adjustUserCredits(user.id, tier, amount, mode, reason);
                  setData((prev) =>
                    prev
                      ? { ...prev, users: prev.users.map((item) => (item.id === user.id ? res.user : item)) }
                      : prev
                  );
                  setAdjustOpen(null);
                  window.alert("积分调整成功");
                } catch (err) {
                  window.alert(err instanceof Error ? err.message : "调整失败");
                } finally {
                  setSavingId(null);
                }
              }}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {!loading && !error && filteredUsers.length > 0 && (
        <div className="flex items-center justify-between rounded-2xl border border-surface-border bg-surface-card px-5 py-4">
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
                    page === p ? "bg-brand text-white" : "text-text-secondary hover:bg-surface-elevated"
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
      )}
    </div>
  );
}

function UserCard({
  user,
  isExpanded,
  isEditing,
  isSaving,
  isAdjustOpen,
  onToggleExpand,
  onToggleEdit,
  onToggleAdjust,
  onPatch,
  onAdjust,
}: {
  user: AdminUser;
  isExpanded: boolean;
  isEditing: boolean;
  isSaving: boolean;
  isAdjustOpen: boolean;
  onToggleExpand: () => void;
  onToggleEdit: () => void;
  onToggleAdjust: () => void;
  onPatch: (user: AdminUser, patch: Partial<AdminUser>) => Promise<void>;
  onAdjust: (tier: "basic" | "advanced" | "beta", amount: number, mode: "add" | "set", reason: string) => Promise<void>;
}) {
  const usage = user.usage_30d;
  const membershipCredits = user.basic_credits + user.advanced_credits;
  const betaCredits = user.beta_credit_balance ?? 0;
  const isActiveBeta = Boolean(user.beta_phase && user.beta_phase !== "completed");

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card shadow-sm overflow-hidden">
      {/* Main Row */}
      <div
        className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-surface-hover/50 transition-colors"
        onClick={onToggleExpand}
      >
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand text-sm font-bold">
          {(user.name || user.email || "?")[0].toUpperCase()}
        </div>

        {/* User Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">{user.name || user.email}</span>
            {user.role === "admin" && (
              <StatusBadge tone="purple">
                <Shield className="mr-1 h-3 w-3" />
                Admin
              </StatusBadge>
            )}
            <BetaPhaseBadge phase={user.beta_phase} phaseName={user.beta_phase_name} />
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-text-tertiary">
            <span className="flex items-center gap-1">
              <Mail className="h-3 w-3" />
              {user.email}
            </span>
            <span>ID: {user.id}</span>
          </div>
        </div>

        {/* Plan */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <select
            disabled={isSaving}
            value={user.plan_tier || "free"}
            onChange={(e) => onPatch(user, { plan_tier: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg border border-surface-border bg-surface-elevated px-2 py-1 text-xs text-text-primary outline-none"
          >
            {PLAN_OPTIONS.map((plan) => (
              <option key={plan} value={plan}>{plan}</option>
            ))}
          </select>
        </div>

        {/* Credits Summary */}
        <div className="hidden lg:flex flex-col items-end shrink-0 w-36">
          {isActiveBeta ? (
            <>
              <div className="text-sm font-semibold text-brand">
                内测 {(betaCredits / 100).toFixed(1)} 积分
              </div>
              <div className="text-[10px] text-text-tertiary">
                独立钱包 · 与会员积分分离
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-text-primary">
                {(membershipCredits / 100).toFixed(1)} 会员积分
              </div>
              <div className="text-[10px] text-text-tertiary">
                基础 {(user.basic_credits / 100).toFixed(1)} · 高级 {(user.advanced_credits / 100).toFixed(1)}
              </div>
            </>
          )}
        </div>

        {/* 30d Cost */}
        <div className="hidden xl:flex flex-col items-end shrink-0 w-28">
          <div className="text-sm font-semibold text-text-primary">
            {formatRMB(usage?.cost_rmb || 0)}
          </div>
          <div className="text-[10px] text-text-tertiary">
            {usage?.requests ? `${usage.requests} 次` : "暂无"}
          </div>
          {usage?.cost_rmb ? (
            <div className="mt-1 flex items-center gap-1">
              {usage.image_count > 0 && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-500">
                  图 {usage.image_count}
                </span>
              )}
              {usage.video_seconds > 0 && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-500">
                  视 {usage.video_seconds}s
                </span>
              )}
            </div>
          ) : null}
        </div>

        {/* Risk */}
        <div className="hidden xl:block shrink-0 w-20">
          <UserRiskBadges usage={usage} />
        </div>

        {/* Last Used */}
        <div className="hidden xl:flex items-center gap-1 shrink-0 text-xs text-text-tertiary w-32">
          <Clock className="h-3 w-3" />
          {usage?.last_used_at ? formatDateTime(usage.last_used_at) : formatDateTime(user.created_at)}
        </div>

        {/* Expand Icon */}
        <div className="shrink-0 text-text-tertiary">
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>

      {/* Expanded Detail */}
      {isExpanded && (
        <div className="border-t border-surface-border px-5 py-4 bg-surface-elevated/30">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Credits Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4 text-brand" />
                  积分管理
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleAdjust(); }}
                    className="flex items-center gap-1 rounded-lg border border-surface-border px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                  >
                    <Coins className="h-3 w-3" />
                    调整积分
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleEdit(); }}
                    className="flex items-center gap-1 rounded-lg border border-surface-border px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                  >
                    {isEditing ? <Save className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                    {isEditing ? "完成" : "编辑"}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <div className="rounded-lg border border-brand/20 bg-brand/5 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-brand">内测积分</span>
                    <span className="text-sm font-semibold text-brand">{(betaCredits / 100).toFixed(1)}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-text-tertiary">
                    {user.beta_phase ? `${user.beta_phase_name || user.beta_phase}${user.beta_batch ? ` · ${user.beta_batch}` : ""}` : "未参与内测"}
                    {" · "}累计发放 {((user.beta_credit_granted_total ?? 0) / 100).toFixed(1)} · 已用 {((user.beta_credit_used_total ?? 0) / 100).toFixed(1)}
                  </div>
                </div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">会员积分</div>
                {[
                  { key: "basic", label: "基础积分", value: user.basic_credits, field: "basic_credits" as const },
                  { key: "advanced", label: "高级积分", value: user.advanced_credits, field: "advanced_credits" as const },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-card px-3 py-2">
                    <span className="text-xs text-text-secondary">{item.label}</span>
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          defaultValue={item.value}
                          disabled={isSaving}
                          id={`credit-${user.id}-${item.key}`}
                          className="w-20 rounded-md border border-surface-border bg-surface-elevated px-2 py-1 text-xs text-text-primary outline-none text-right"
                        />
                        <button
                          disabled={isSaving}
                          onClick={(e) => {
                            e.stopPropagation();
                            const input = document.getElementById(`credit-${user.id}-${item.key}`) as HTMLInputElement;
                            const val = parseInt(input.value);
                            if (!isNaN(val) && val >= 0) {
                              onPatch(user, { [item.field]: val });
                            }
                          }}
                          className="rounded-md bg-brand px-2 py-1 text-[10px] text-white hover:bg-brand-hover"
                        >
                          {isSaving ? "..." : "保存"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm font-medium text-text-primary">{(item.value / 100).toFixed(1)}</span>
                    )}
                  </div>
                ))}
              </div>
              {/* 调整积分弹窗 */}
              {isAdjustOpen && (
                <CreditAdjustDialog
                  user={user}
                  onClose={onToggleAdjust}
                  onAdjust={onAdjust}
                  isSaving={isSaving}
                />
              )}
            </div>

            {/* Usage Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-brand" />
                30 天用量
                <span className="text-[10px] text-text-tertiary font-normal ml-1">({formatRMB(usage?.cost_rmb || 0)})</span>
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <StatItem label="请求数" value={formatNumber(usage?.requests || 0)} />
                <StatItem label="Token" value={formatNumber(usage?.total_tokens || 0)} />
                <StatItem label="图片" value={formatNumber(usage?.image_count || 0)} helper={`≈ ${formatRMB((usage?.image_count || 0) * 0.5)}`} />
                <StatItem label="视频(秒)" value={formatNumber(usage?.video_seconds || 0)} helper={`≈ ${formatRMB((usage?.video_seconds || 0) * 0.1)}`} />
                <StatItem label="字符" value={formatNumber(usage?.character_count || 0)} />
                <StatItem label="失败率" value={`${((usage?.failures || 0) / Math.max(usage?.requests || 1, 1) * 100).toFixed(1)}%`} />
              </div>
            </div>

            {/* Role & Actions */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-brand" />
                角色与操作
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-card px-3 py-2">
                  <span className="text-xs text-text-secondary">角色</span>
                  <select
                    disabled={isSaving}
                    value={user.role}
                    onChange={(e) => onPatch(user, { role: e.target.value as AdminUser["role"] })}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-md border border-surface-border bg-surface-elevated px-2 py-1 text-xs text-text-primary outline-none"
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-card px-3 py-2">
                  <span className="text-xs text-text-secondary">套餐</span>
                  <select
                    disabled={isSaving}
                    value={user.plan_tier || "free"}
                    onChange={(e) => onPatch(user, { plan_tier: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-md border border-surface-border bg-surface-elevated px-2 py-1 text-xs text-text-primary outline-none"
                  >
                    {PLAN_OPTIONS.map((plan) => (
                      <option key={plan} value={plan}>{plan}</option>
                    ))}
                  </select>
                </div>
                <a
                  href={`/admin/usage?range=30d&user_id=${user.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center justify-center gap-1 rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  查看成本详情 <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatItem({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-card px-3 py-2">
      <div className="text-[10px] text-text-tertiary">{label}</div>
      <div className="text-sm font-semibold text-text-primary">{value}</div>
      {helper && <div className="text-[9px] text-text-tertiary mt-0.5">{helper}</div>}
    </div>
  );
}

function BetaPhaseBadge({ phase, phaseName }: { phase?: string; phaseName?: string }) {
  if (!phase) return null;
  const toneMap: Record<string, { tone: "green" | "amber" | "red" | "neutral"; label: string }> = {
    phase_1: { tone: "green", label: phaseName || "试探期" },
    phase_2: { tone: "amber", label: phaseName || "深水区" },
    phase_3: { tone: "amber", label: phaseName || "枯竭期" },
    completed: { tone: "neutral", label: phaseName || "已完成" },
  };
  const info = toneMap[phase];
  if (!info) return null;
  return <StatusBadge tone={info.tone}>{info.label}</StatusBadge>;
}

function CreditAdjustDialog({
  user,
  onClose,
  onAdjust,
  isSaving,
}: {
  user: AdminUser;
  onClose: () => void;
  onAdjust: (tier: "basic" | "advanced" | "beta", amount: number, mode: "add" | "set", reason: string) => Promise<void>;
  isSaving: boolean;
}) {
  const [tier, setTier] = useState<"basic" | "advanced" | "beta">(user.beta_phase && user.beta_phase !== "completed" ? "beta" : "basic");
  const [mode, setMode] = useState<"add" | "set">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const tierLabel = { beta: "内测积分", basic: "会员基础积分", advanced: "会员高级积分" };
  const currentValue = { beta: user.beta_credit_balance ?? 0, basic: user.basic_credits, advanced: user.advanced_credits }[tier];

  const handleSubmit = async () => {
    const val = parseInt(amount);
    if (isNaN(val) || val < 0) {
      window.alert("请输入有效的正整数");
      return;
    }
    await onAdjust(tier, val, mode, reason.trim() || "admin_adjust");
  };

  return (
    <div className="mt-4 p-4 rounded-xl border border-surface-border bg-surface-card space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-primary">调整用户积分</h4>
        <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-text-secondary block mb-1">积分类型</label>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as "basic" | "advanced" | "beta")}
            className="w-full rounded-lg border border-surface-border bg-surface-elevated px-3 py-2 text-sm text-text-primary outline-none"
          >
            <option value="beta">内测积分（独立钱包）</option>
            <option value="basic">会员基础积分</option>
            <option value="advanced">会员高级积分</option>
          </select>
          <p className="mt-1 text-[10px] text-text-tertiary">内测积分不会写入会员基础/高级额度。</p>
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1">调整模式</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "add" | "set")}
            className="w-full rounded-lg border border-surface-border bg-surface-elevated px-3 py-2 text-sm text-text-primary outline-none"
          >
            <option value="add">增加（在当前基础上加）</option>
            <option value="set">设值（直接设为指定值）</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-text-secondary block mb-1">
            {mode === "add" ? "增加数量（分）" : "目标值（分）"}
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={mode === "add" ? "例如：5000" : "例如：10000"}
            className="w-full rounded-lg border border-surface-border bg-surface-elevated px-3 py-2 text-sm text-text-primary outline-none"
            min="0"
          />
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1">当前值</label>
          <div className="px-3 py-2 rounded-lg border border-surface-border bg-surface-elevated/50 text-sm text-text-secondary">
            {tierLabel[tier]}：{currentValue} 分（{(currentValue / 100).toFixed(2)} 积分）
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs text-text-secondary block mb-1">调整原因（可选）</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例如：内测额度发放、Bug 补偿、审核通过"
          className="w-full rounded-lg border border-surface-border bg-surface-elevated px-3 py-2 text-sm text-text-primary outline-none"
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-3 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary border border-surface-border"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={isSaving || !amount}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand hover:bg-brand-hover disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          确认调整
        </button>
      </div>
    </div>
  );
}

function UserRiskBadges({ usage }: { usage?: AdminUserUsageSummary }) {
  if (!usage || usage.requests === 0) return <StatusBadge tone="neutral">暂无成本</StatusBadge>;
  const failureRate = usage.requests ? (usage.failures || 0) / usage.requests : 0;
  const badges: Array<{ label: string; tone: "red" | "purple" | "blue" | "green" | "neutral" }> = [];
  if ((usage.cost_rmb || 0) >= 50) badges.push({ label: "高成本", tone: "red" });
  if (failureRate >= 0.2) badges.push({ label: "失败偏高", tone: "red" });
  if ((usage.video_seconds || 0) > 0) badges.push({ label: "视频", tone: "purple" });
  if ((usage.image_count || 0) >= 20) badges.push({ label: "图片重度", tone: "blue" });
  if (badges.length === 0) badges.push({ label: "正常", tone: "green" });
  return (
    <div className="flex flex-wrap gap-1">
      {badges.slice(0, 2).map((badge) => (
        <StatusBadge key={badge.label} tone={badge.tone}>
          {badge.label}
        </StatusBadge>
      ))}
    </div>
  );
}

function CostBreakdownCard({ cost, images, video, requests }: { cost: number; images: number; video: number; requests: number }) {
  const imageCost = images * 0.5;
  const videoCost = video * 0.1;
  const chatCost = Math.max(0, cost - imageCost - videoCost);
  const total = cost || 1;
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-secondary">30d 成本</span>
        <Wallet className="h-4 w-4 text-brand" />
      </div>
      <div className="text-2xl font-bold text-text-primary">{formatRMB(cost)}</div>
      <div className="mt-3 space-y-1.5">
        {chatCost > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-2 rounded-full bg-brand" style={{ width: `${(chatCost / total) * 100}%` }} />
            <span className="text-[10px] text-text-tertiary whitespace-nowrap">对话 {formatRMB(chatCost)}</span>
          </div>
        )}
        {imageCost > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-2 rounded-full bg-purple-500" style={{ width: `${(imageCost / total) * 100}%` }} />
            <span className="text-[10px] text-text-tertiary whitespace-nowrap">图片 {formatRMB(imageCost)}</span>
          </div>
        )}
        {videoCost > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-2 rounded-full bg-amber-500" style={{ width: `${(videoCost / total) * 100}%` }} />
            <span className="text-[10px] text-text-tertiary whitespace-nowrap">视频 {formatRMB(videoCost)}</span>
          </div>
        )}
        {cost === 0 && <div className="text-[10px] text-text-tertiary">暂无成本数据</div>}
      </div>
      <div className="mt-2 text-[10px] text-text-tertiary">{formatNumber(requests)} 次调用</div>
    </div>
  );
}
