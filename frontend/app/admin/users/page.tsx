"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ExternalLink, Loader2, RefreshCw, Search, Shield, TrendingUp, Users, Wallet } from "lucide-react";
import { getAdminUsers, updateAdminUser } from "@/lib/admin/api";
import type { AdminUser, AdminUsersResponse, AdminUserUsageSummary } from "@/lib/admin/types";
import { formatDateTime, formatNumber, formatRMB } from "@/lib/admin/format";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { MetricCard } from "@/components/admin/MetricCard";

const PAGE_SIZE = 20;
const PLAN_OPTIONS = ["free", "basic", "plus", "ultra"];

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);

  const totalPages = useMemo(() => Math.max(1, Math.ceil((data?.total || 0) / PAGE_SIZE)), [data?.total]);
  const usageRollup = useMemo(() => (data?.users || []).reduce((acc, user) => {
    const usage = user.usage_30d;
    if (!usage) return acc;
    acc.cost += usage.cost_rmb || 0;
    acc.requests += usage.requests || 0;
    acc.images += usage.image_count || 0;
    acc.video += usage.video_seconds || 0;
    return acc;
  }, { cost: 0, requests: 0, images: 0, video: 0 }), [data?.users]);

  const load = () => {
    setLoading(true);
    setError("");
    getAdminUsers({ page, pageSize: PAGE_SIZE, q: q.trim() || undefined })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "加载用户列表失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

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
      setData((prev) => prev ? { ...prev, users: prev.users.map((item) => item.id === user.id ? updated.user : item) } : prev);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-surface-border bg-surface-card p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-text-primary"><Users className="h-6 w-6 text-brand" />用户管理与成本入口</h1>
            <p className="mt-2 text-sm text-text-secondary">搜索用户、调整套餐/积分，并直接查看 30 天成本、媒体用量和风险标签。</p>
          </div>
          <form onSubmit={handleSearch} className="flex w-full gap-2 lg:w-auto">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 lg:w-80">
              <Search className="h-4 w-4 shrink-0 text-text-tertiary" />
              <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="搜索邮箱、昵称或 ID" className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary" />
            </div>
            <button className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover">搜索</button>
            <button type="button" onClick={load} className="rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 text-text-secondary hover:text-text-primary"><RefreshCw className="h-4 w-4" /></button>
          </form>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="当前页用户" value={formatNumber(data?.users?.length || 0)} icon={Users} helper={`共 ${formatNumber(data?.total || 0)} 个用户`} />
        <MetricCard title="30d 成本" value={formatRMB(usageRollup.cost)} icon={Wallet} helper={`${formatNumber(usageRollup.requests)} 次调用`} />
        <MetricCard title="图片" value={formatNumber(usageRollup.images)} icon={TrendingUp} helper="当前页用户 30d" />
        <MetricCard title="视频秒数" value={`${formatNumber(usageRollup.video)}s`} icon={TrendingUp} helper="当前页用户 30d" />
      </div>

      <div className="rounded-2xl border border-surface-border bg-surface-card shadow-sm">
        <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
          <div className="text-sm text-text-secondary">共 <span className="font-medium text-text-primary">{formatNumber(data?.total || 0)}</span> 个用户</div>
          <StatusBadge tone="blue">Page {page} / {totalPages}</StatusBadge>
        </div>

        {loading ? (
          <div className="flex h-72 items-center justify-center text-sm text-text-secondary"><Loader2 className="mr-2 h-4 w-4 animate-spin text-brand" />正在加载用户…</div>
        ) : error ? (
          <div className="flex h-72 flex-col items-center justify-center text-sm text-red-600"><AlertCircle className="mb-2 h-5 w-5" />{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="bg-surface-elevated text-xs uppercase text-text-tertiary">
                <tr>
                  <th className="px-4 py-3 font-medium">用户</th>
                  <th className="px-4 py-3 font-medium">角色/套餐</th>
                  <th className="px-4 py-3 font-medium">积分</th>
                  <th className="px-4 py-3 font-medium">30d 成本</th>
                  <th className="px-4 py-3 font-medium">30d 用量</th>
                  <th className="px-4 py-3 font-medium">风险</th>
                  <th className="px-4 py-3 font-medium">最近使用</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {(data?.users || []).map((user) => {
                  const usage = user.usage_30d;
                  return (
                  <tr key={user.id} className="hover:bg-surface-elevated/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-text-primary">{user.name || user.email}</div>
                      <div className="mt-1 text-xs text-text-tertiary">#{user.id} · {user.email}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <select disabled={savingId === user.id} value={user.role} onChange={(event) => patchUser(user, { role: event.target.value as AdminUser["role"] })} className="mb-2 rounded-lg border border-surface-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary outline-none">
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                      {user.role === "admin" && <div className="mb-2"><StatusBadge tone="purple"><Shield className="mr-1 h-3 w-3" />Admin</StatusBadge></div>}
                      <select disabled={savingId === user.id} value={user.plan_tier || "free"} onChange={(event) => patchUser(user, { plan_tier: event.target.value })} className="block rounded-lg border border-surface-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary outline-none">
                        {PLAN_OPTIONS.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-secondary">
                      <CreditInput label="基础" value={user.basic_credits} disabled={savingId === user.id} onSave={(value) => patchUser(user, { basic_credits: value })} />
                      <CreditInput label="高级" value={user.advanced_credits} disabled={savingId === user.id} onSave={(value) => patchUser(user, { advanced_credits: value })} />
                      <CreditInput label="精英" value={user.elite_credits} disabled={savingId === user.id} onSave={(value) => patchUser(user, { elite_credits: value })} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-text-primary">{formatRMB(usage?.cost_rmb || 0)}</div>
                      <div className="mt-1 text-xs text-text-tertiary">{usage?.requests ? `${formatRMB((usage.cost_rmb || 0) / Math.max(usage.requests, 1))}/次` : "暂无调用"}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-text-secondary">
                      <div>{formatNumber(usage?.requests || 0)} 次 · {formatNumber(usage?.total_tokens || 0)} tok</div>
                      <div className="mt-1">{formatNumber(usage?.image_count || 0)} 图 · {formatNumber(usage?.video_seconds || 0)}s 视频 · {formatNumber(usage?.character_count || 0)} 字符</div>
                    </td>
                    <td className="px-4 py-3 align-top"><UserRiskBadges usage={usage} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{usage?.last_used_at ? formatDateTime(usage.last_used_at) : formatDateTime(user.created_at)}</td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-2">
                        <a href={`/admin/usage?range=30d&user_id=${user.id}`} className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">查看成本 <ExternalLink className="h-3 w-3" /></a>
                        <span className="text-xs text-text-tertiary">{savingId === user.id ? "保存中…" : "已同步"}</span>
                      </div>
                    </td>
                  </tr>
                );})}
                {(data?.users || []).length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-text-tertiary">没有找到用户</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-surface-border px-5 py-4">
          <button disabled={page <= 1 || loading} onClick={() => setPage((prev) => Math.max(1, prev - 1))} className="rounded-xl border border-surface-border px-4 py-2 text-sm text-text-secondary disabled:opacity-40">上一页</button>
          <button disabled={page >= totalPages || loading} onClick={() => setPage((prev) => prev + 1)} className="rounded-xl border border-surface-border px-4 py-2 text-sm text-text-secondary disabled:opacity-40">下一页</button>
        </div>
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
  return <div className="flex max-w-[180px] flex-wrap gap-1">{badges.slice(0, 3).map((badge) => <StatusBadge key={badge.label} tone={badge.tone}>{badge.label}</StatusBadge>)}</div>;
}

function CreditInput({ label, value, disabled, onSave }: { label: string; value: number; disabled: boolean; onSave: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const parsed = Number(draft);
  const changed = parsed !== value && Number.isFinite(parsed) && parsed >= 0;
  return (
    <div className="mb-1 flex items-center gap-2 last:mb-0">
      <span className="w-8 text-text-tertiary">{label}</span>
      <input disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)} className="w-20 rounded-lg border border-surface-border bg-surface-elevated px-2 py-1 text-xs text-text-primary outline-none" />
      <button disabled={!changed || disabled} onClick={() => onSave(parsed)} className="rounded-md px-2 py-1 text-xs text-brand disabled:text-text-tertiary">保存</button>
    </div>
  );
}
