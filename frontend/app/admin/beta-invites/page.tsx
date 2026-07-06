"use client";

import { useState, useEffect, useCallback } from "react";
import { Copy, Plus, Loader2, Search, RefreshCw, CheckCircle, XCircle, Clock, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch } from "@/lib/admin/api";

interface BetaInvite {
  id: number;
  code: string;
  email: string;
  status: "unused" | "used" | "revoked";
  batch: string;
  industry: string;
  credits_basic: number;
  credits_advanced: number;
  credits_elite: number;
  user_id: number;
  used_at: string;
  created_at: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  unused: { label: "未使用", color: "text-green-400", icon: <CheckCircle className="h-4 w-4" /> },
  used: { label: "已使用", color: "text-blue-400", icon: <Clock className="h-4 w-4" /> },
  revoked: { label: "已撤销", color: "text-red-400", icon: <XCircle className="h-4 w-4" /> },
};

const BATCHES = ["batch-1", "batch-2", "batch-3"];
const DEFAULT_PHASE_1_CREDITS_FEN = 5000;

const formatCredits = (fen: number) => `${(fen / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} Credits`;

export default function BetaInvitesPage() {
  const [invites, setInvites] = useState<BetaInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [batchFilter, setBatchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateForm, setGenerateForm] = useState({
    count: 10,
    batch: "batch-1",
    industry: "",
    credits_basic: DEFAULT_PHASE_1_CREDITS_FEN,
    credits_advanced: 0,
    credits_elite: 0,
  });
  const [generating, setGenerating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (batchFilter) params.append("batch", batchFilter);
      if (statusFilter) params.append("status", statusFilter);
      const data = await adminFetch<{ items?: BetaInvite[] }>(`/beta-invites?${params}`);
      setInvites(data.items || []);
    } catch {
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, [batchFilter, statusFilter]);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const data = await adminFetch<{ count: number }>("/beta-invites/generate", { method: "POST", body: JSON.stringify(generateForm) });
      alert(`成功生成 ${data.count} 个邀请码`);
      setGenerateOpen(false);
      fetchInvites();
    } catch {
      alert("生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const filtered = invites.filter((i) => {
    const q = searchQuery.toLowerCase();
    return !q || i.code.toLowerCase().includes(q) || i.email?.toLowerCase().includes(q);
  });

  const stats = {
    total: invites.length,
    unused: invites.filter((i) => i.status === "unused").length,
    used: invites.filter((i) => i.status === "used").length,
  };

  return (
    <AdminShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">邀请码管理</h1>
            <p className="text-sm text-text-secondary mt-1">批量生成、分发、追踪内测邀请码</p>
          </div>
          <button
            onClick={() => setGenerateOpen(true)}
            className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover transition-colors flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            生成邀请码
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-3">
          {[
            { label: "全部", value: stats.total, color: "bg-surface-elevated" },
            { label: "未使用", value: stats.unused, color: "bg-green-500/10 text-green-400" },
            { label: "已使用", value: stats.used, color: "bg-blue-500/10 text-blue-400" },
          ].map((s) => (
            <div key={s.label} className={cn("rounded-xl px-4 py-2 text-center", s.color)}>
              <div className="text-lg font-bold">{s.value}</div>
              <div className="text-xs opacity-70">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索邀请码或邮箱..."
              className="w-full rounded-xl border border-surface-border bg-surface-elevated pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <select
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            className="rounded-xl border border-surface-border bg-surface-elevated px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            <option value="">全部批次</option>
            {BATCHES.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-surface-border bg-surface-elevated px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            <option value="">全部状态</option>
            <option value="unused">未使用</option>
            <option value="used">已使用</option>
            <option value="revoked">已撤销</option>
          </select>
          <button
            onClick={fetchInvites}
            className="rounded-xl border border-surface-border bg-surface-elevated px-4 py-2.5 text-sm text-text-secondary hover:bg-surface-hover transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-surface-border bg-surface-elevated overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-hover text-left text-xs uppercase text-text-tertiary">
              <tr>
                <th className="px-4 py-3">邀请码</th>
                <th className="px-4 py-3">批次</th>
                <th className="px-4 py-3">行业</th>
                <th className="px-4 py-3">内测 Credit</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">使用者</th>
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-text-tertiary">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    加载中...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-text-tertiary">
                    暂无邀请码
                  </td>
                </tr>
              ) : (
                filtered.map((invite) => {
                  const status = STATUS_LABELS[invite.status];
                  return (
                    <tr key={invite.id} className="hover:bg-surface-hover/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <code className="rounded-lg bg-surface px-2 py-1 text-sm font-mono text-brand">
                            {invite.code}
                          </code>
                          <button
                            onClick={() => copyCode(invite.code)}
                            className="rounded p-1 text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
                          >
                            {copiedCode === invite.code ? (
                              <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-surface px-2 py-1 text-xs text-text-secondary">
                          {invite.batch}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{invite.industry || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 text-xs">
                          <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-amber-400 w-fit" title={`${invite.credits_basic} 分`}>{formatCredits(invite.credits_basic)}</span>

                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("flex items-center gap-1 text-xs font-medium", status.color)}>
                          {status.icon}
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {invite.user_id ? `用户 #${invite.user_id}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-text-tertiary">
                        {invite.used_at
                          ? new Date(invite.used_at).toLocaleDateString("zh-CN")
                          : new Date(invite.created_at).toLocaleDateString("zh-CN")}
                      </td>
                      <td className="px-4 py-3">
                        {invite.status === "unused" && (
                          <button
                            onClick={() => copyCode(invite.code)}
                            className="rounded-lg bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/20 transition-colors"
                          >
                            复制
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generate Modal */}
      {generateOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl">
            <div className="px-6 py-4 border-b border-surface-border">
              <h2 className="text-lg font-semibold text-text-primary">批量生成邀请码</h2>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">数量</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={generateForm.count}
                  onChange={(e) => setGenerateForm({ ...generateForm, count: parseInt(e.target.value) || 1 })}
                  className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">批次</label>
                <select
                  value={generateForm.batch}
                  onChange={(e) => setGenerateForm({ ...generateForm, batch: e.target.value })}
                  className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
                >
                  {BATCHES.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">行业标签</label>
                <input
                  value={generateForm.industry}
                  onChange={(e) => setGenerateForm({ ...generateForm, industry: e.target.value })}
                  placeholder="例如：金融"
                  className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
              <div className="space-y-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-text-primary">Phase 1 内测 Credit（分）</label>
                  <input
                    type="number"
                    value={generateForm.credits_basic}
                    onChange={(e) => setGenerateForm({ ...generateForm, credits_basic: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                  <p className="text-xs text-text-tertiary">{formatCredits(generateForm.credits_basic)}，Phase 1 默认 50 Credits = 5000 分</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-surface-border flex gap-3">
              <button
                onClick={() => setGenerateOpen(false)}
                className="flex-1 rounded-xl border border-surface-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className={cn(
                  "flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors",
                  generating ? "bg-brand/40 cursor-not-allowed" : "bg-brand hover:bg-brand-hover"
                )}
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "生成"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
