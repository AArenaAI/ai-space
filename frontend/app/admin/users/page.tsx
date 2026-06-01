"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, Search, Shield, Users } from "lucide-react";
import { getAdminUsers, updateAdminUser } from "@/lib/admin/api";
import type { AdminUser, AdminUsersResponse } from "@/lib/admin/types";
import { formatDateTime, formatNumber } from "@/lib/admin/format";
import { StatusBadge } from "@/components/admin/StatusBadge";

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
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-text-primary"><Users className="h-6 w-6 text-brand" />用户管理</h1>
            <p className="mt-2 text-sm text-text-secondary">搜索用户、调整套餐、积分与管理员角色。高风险操作会要求确认。</p>
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
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-surface-elevated text-xs uppercase text-text-tertiary">
                <tr>
                  <th className="px-4 py-3 font-medium">用户</th>
                  <th className="px-4 py-3 font-medium">角色</th>
                  <th className="px-4 py-3 font-medium">套餐</th>
                  <th className="px-4 py-3 font-medium">积分</th>
                  <th className="px-4 py-3 font-medium">注册时间</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {(data?.users || []).map((user) => (
                  <tr key={user.id} className="hover:bg-surface-elevated/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-text-primary">{user.name || user.email}</div>
                      <div className="mt-1 text-xs text-text-tertiary">#{user.id} · {user.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select disabled={savingId === user.id} value={user.role} onChange={(event) => patchUser(user, { role: event.target.value as AdminUser["role"] })} className="rounded-lg border border-surface-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary outline-none">
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                      {user.role === "admin" && <div className="mt-2"><StatusBadge tone="purple"><Shield className="mr-1 h-3 w-3" />Admin</StatusBadge></div>}
                    </td>
                    <td className="px-4 py-3">
                      <select disabled={savingId === user.id} value={user.plan_tier || "free"} onChange={(event) => patchUser(user, { plan_tier: event.target.value })} className="rounded-lg border border-surface-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary outline-none">
                        {PLAN_OPTIONS.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-secondary">
                      <CreditInput label="基础" value={user.basic_credits} disabled={savingId === user.id} onSave={(value) => patchUser(user, { basic_credits: value })} />
                      <CreditInput label="高级" value={user.advanced_credits} disabled={savingId === user.id} onSave={(value) => patchUser(user, { advanced_credits: value })} />
                      <CreditInput label="精英" value={user.elite_credits} disabled={savingId === user.id} onSave={(value) => patchUser(user, { elite_credits: value })} />
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{formatDateTime(user.created_at)}</td>
                    <td className="px-4 py-3 text-text-tertiary">{savingId === user.id ? "保存中…" : "已同步"}</td>
                  </tr>
                ))}
                {(data?.users || []).length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-text-tertiary">没有找到用户</td></tr>}
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
