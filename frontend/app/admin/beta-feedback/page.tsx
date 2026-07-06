"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Filter, Lightbulb, Loader2, Mail, MessageSquare, Search, Sparkles, User } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { cn } from "@/lib/utils";
import { adminFetch } from "@/lib/admin/api";

interface BetaFeedback {
  id: number;
  user_id?: number;
  email?: string;
  name?: string;
  category: string;
  title: string;
  content: string;
  expected_improvement?: string;
  status: "pending" | "adopted" | "rejected" | "archived";
  reward_note?: string;
  created_at: string;
  updated_at: string;
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  bug: { label: "需要修改", color: "bg-red-500/10 text-red-400" },
  optimization: { label: "需要优化", color: "bg-blue-500/10 text-blue-400" },
  feature: { label: "新功能建议", color: "bg-purple-500/10 text-purple-400" },
  other: { label: "其他反馈", color: "bg-surface-hover text-text-secondary" },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "待查看", color: "text-amber-400" },
  adopted: { label: "已采纳", color: "text-green-400" },
  rejected: { label: "未采纳", color: "text-red-400" },
  archived: { label: "已归档", color: "text-text-tertiary" },
};

function formatDate(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function BetaFeedbackAdminPage() {
  const [items, setItems] = useState<BetaFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<BetaFeedback | null>(null);
  const [total, setTotal] = useState(0);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (category) params.set("category", category);
      if (status) params.set("status", status);
      params.set("page_size", "100");
      const data = await adminFetch<{ items?: BetaFeedback[]; total?: number }>(`/beta-feedback?${params}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, category, status]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  const stats = useMemo(() => ({
    total,
    pending: items.filter((i) => i.status === "pending").length,
    feature: items.filter((i) => i.category === "feature").length,
    optimization: items.filter((i) => i.category === "optimization").length,
  }), [items, total]);

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">内测反馈</h1>
            <p className="mt-1 text-sm text-text-secondary">接收用户在设置页提交的平台修改、优化和新功能建议</p>
          </div>
          <button onClick={fetchFeedback} className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover">
            刷新
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          {[
            { label: "全部建议", value: stats.total, icon: MessageSquare, color: "bg-surface-elevated" },
            { label: "待查看", value: stats.pending, icon: Clock, color: "bg-amber-400/10 text-amber-400" },
            { label: "优化建议", value: stats.optimization, icon: Sparkles, color: "bg-blue-500/10 text-blue-400" },
            { label: "新功能", value: stats.feature, icon: Lightbulb, color: "bg-purple-500/10 text-purple-400" },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className={cn("rounded-2xl p-4", s.color)}>
                <div className="flex items-center justify-between">
                  <span className="text-xs opacity-75">{s.label}</span>
                  <Icon className="h-4 w-4 opacity-70" />
                </div>
                <div className="mt-2 text-2xl font-bold">{s.value}</div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索邮箱、标题、内容..."
              className="w-full rounded-xl border border-surface-border bg-surface-elevated py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-xl border border-surface-border bg-surface-elevated px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30">
            <option value="">全部类型</option>
            <option value="bug">需要修改</option>
            <option value="optimization">需要优化</option>
            <option value="feature">新功能建议</option>
            <option value="other">其他反馈</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-surface-border bg-surface-elevated px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30">
            <option value="">全部状态</option>
            <option value="pending">待查看</option>
            <option value="adopted">已采纳</option>
            <option value="rejected">未采纳</option>
            <option value="archived">已归档</option>
          </select>
        </div>

        <div className="overflow-hidden rounded-xl border border-surface-border bg-surface-elevated">
          <table className="w-full text-sm">
            <thead className="bg-surface-hover text-left text-xs uppercase text-text-tertiary">
              <tr>
                <th className="px-4 py-3">提交人</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">标题 / 内容</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-text-tertiary"><Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />加载中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-text-tertiary">暂无反馈建议</td></tr>
              ) : items.map((item) => {
                const cat = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.other;
                const st = STATUS_LABELS[item.status] || STATUS_LABELS.pending;
                return (
                  <tr key={item.id} className="hover:bg-surface-hover/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-text-tertiary" />
                        <div>
                          <div className="font-medium text-text-primary">{item.name || "未命名用户"}</div>
                          <div className="flex items-center gap-1 text-xs text-text-tertiary"><Mail className="h-3 w-3" />{item.email || "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-1 text-xs font-medium", cat.color)}>{cat.label}</span></td>
                    <td className="max-w-[420px] px-4 py-3">
                      <div className="font-medium text-text-primary">{item.title}</div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">{item.content}</div>
                    </td>
                    <td className="px-4 py-3"><span className={cn("text-xs font-medium", st.color)}>{st.label}</span></td>
                    <td className="px-4 py-3 text-xs text-text-tertiary">{formatDate(item.created_at)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setSelected(item)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-hover">查看</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-surface-border bg-surface-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs text-text-tertiary">#{selected.id} · {formatDate(selected.created_at)}</div>
                <h2 className="mt-2 text-xl font-semibold text-text-primary">{selected.title}</h2>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-elevated">关闭</button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className={cn("rounded-full px-2 py-1 font-medium", (CATEGORY_LABELS[selected.category] || CATEGORY_LABELS.other).color)}>{(CATEGORY_LABELS[selected.category] || CATEGORY_LABELS.other).label}</span>
              <span className={cn("rounded-full bg-surface-elevated px-2 py-1 font-medium", (STATUS_LABELS[selected.status] || STATUS_LABELS.pending).color)}>{(STATUS_LABELS[selected.status] || STATUS_LABELS.pending).label}</span>
              <span className="rounded-full bg-surface-elevated px-2 py-1 text-text-secondary">{selected.email || "无邮箱"}</span>
            </div>
            <div className="mt-5 space-y-5">
              <section>
                <h3 className="text-sm font-semibold text-text-primary">详细说明</h3>
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-elevated p-4 text-sm leading-6 text-text-secondary">{selected.content}</p>
              </section>
              <section>
                <h3 className="text-sm font-semibold text-text-primary">希望最终效果</h3>
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-elevated p-4 text-sm leading-6 text-text-secondary">{selected.expected_improvement || "—"}</p>
              </section>
              {selected.reward_note && (
                <section>
                  <h3 className="text-sm font-semibold text-text-primary">奖励/采纳说明</h3>
                  <p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-elevated p-4 text-sm leading-6 text-text-secondary">{selected.reward_note}</p>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
