"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, XCircle, Loader2, Search, Filter, ChevronDown, Mail, User, Briefcase, FileText, Clock, Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminShell } from "@/components/admin/AdminShell";

interface BetaApplication {
  id: number;
  email: string;
  name: string;
  industry: string;
  job_title: string;
  use_case: string;
  bad_case_sample: string;
  experience_level: string;
  status: "pending" | "approved" | "rejected";
  invite_code: string;
  review_note: string;
  created_at: string;
  reviewed_at: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "待审核", color: "text-amber-400", icon: <Clock className="h-4 w-4" /> },
  approved: { label: "已通过", color: "text-green-400", icon: <CheckCircle className="h-4 w-4" /> },
  rejected: { label: "已拒绝", color: "text-red-400", icon: <XCircle className="h-4 w-4" /> },
};

const INDUSTRIES = ["金融", "算法", "自媒体", "高级UI", "其他"];

export default function BetaApplicationsPage() {
  const router = useRouter();
  const [applications, setApplications] = useState<BetaApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });

  const fetchApplications = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append("status", statusFilter);
      if (industryFilter) params.append("industry", industryFilter);
      const res = await fetch(`/api/admin/beta-applications?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("获取失败");
      const data = await res.json();
      setApplications(data.items || []);
      setStats({
        total: data.total || 0,
        pending: (data.items || []).filter((a: BetaApplication) => a.status === "pending").length,
        approved: (data.items || []).filter((a: BetaApplication) => a.status === "approved").length,
        rejected: (data.items || []).filter((a: BetaApplication) => a.status === "rejected").length,
      });
    } catch {
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, industryFilter]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleReview = async (id: number, status: "approved" | "rejected") => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/beta-applications/${id}/review`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status,
          review_note: reviewNote,
          invite_code: status === "approved" ? inviteCode : undefined,
        }),
      });
      if (!res.ok) throw new Error("审核失败");
      setReviewingId(null);
      setReviewNote("");
      setInviteCode("");
      fetchApplications();
    } catch {
      alert("审核失败");
    } finally {
      setActionLoading(false);
    }
  };

  const filtered = applications.filter((a) => {
    const q = searchQuery.toLowerCase();
    return (
      !q ||
      a.email.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.use_case.toLowerCase().includes(q)
    );
  });

  return (
    <AdminShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">内测申请审核</h1>
            <p className="text-sm text-text-secondary mt-1">管理 Beta 白名单申请，按批次释放</p>
          </div>
          <div className="flex gap-3">
            {[
              { label: "全部", value: stats.total, color: "bg-surface-elevated" },
              { label: "待审核", value: stats.pending, color: "bg-amber-400/10 text-amber-400" },
              { label: "已通过", value: stats.approved, color: "bg-green-500/10 text-green-400" },
              { label: "已拒绝", value: stats.rejected, color: "bg-red-500/10 text-red-400" },
            ].map((s) => (
              <div key={s.label} className={cn("rounded-xl px-4 py-2 text-center", s.color)}>
                <div className="text-lg font-bold">{s.value}</div>
                <div className="text-xs opacity-70">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索邮箱、姓名、使用场景..."
              className="w-full rounded-xl border border-surface-border bg-surface-elevated pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-surface-border bg-surface-elevated px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            <option value="">全部状态</option>
            <option value="pending">待审核</option>
            <option value="approved">已通过</option>
            <option value="rejected">已拒绝</option>
          </select>
          <select
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
            className="rounded-xl border border-surface-border bg-surface-elevated px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            <option value="">全部行业</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-surface-border bg-surface-elevated overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-hover text-left text-xs uppercase text-text-tertiary">
              <tr>
                <th className="px-4 py-3">申请人</th>
                <th className="px-4 py-3">行业</th>
                <th className="px-4 py-3">使用场景</th>
                <th className="px-4 py-3">Bad Case</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-text-tertiary">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    加载中...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-text-tertiary">
                    暂无申请记录
                  </td>
                </tr>
              ) : (
                filtered.map((app) => {
                  const status = STATUS_LABELS[app.status];
                  return (
                    <tr key={app.id} className="hover:bg-surface-hover/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-text-tertiary" />
                          <div>
                            <div className="font-medium text-text-primary">{app.name}</div>
                            <div className="text-xs text-text-tertiary flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {app.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 text-text-secondary">
                          <Briefcase className="h-3.5 w-3.5" />
                          {app.industry}
                          {app.job_title && <span className="text-text-tertiary">· {app.job_title}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <div className="truncate text-text-secondary" title={app.use_case}>
                          {app.use_case}
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-[150px]">
                        <div className="truncate text-text-secondary" title={app.bad_case_sample}>
                          {app.bad_case_sample || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("flex items-center gap-1 text-xs font-medium", status.color)}>
                          {status.icon}
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-text-tertiary">
                        {new Date(app.created_at).toLocaleDateString("zh-CN")}
                      </td>
                      <td className="px-4 py-3">
                        {app.status === "pending" ? (
                          <button
                            onClick={() => {
                              setReviewingId(app.id);
                              setReviewNote("");
                              setInviteCode("");
                            }}
                            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover transition-colors"
                          >
                            审核
                          </button>
                        ) : (
                          <span className="text-xs text-text-tertiary">{app.review_note || "—"}</span>
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

      {/* Review Modal */}
      {reviewingId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg mx-4 rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl">
            <div className="px-6 py-4 border-b border-surface-border">
              <h2 className="text-lg font-semibold text-text-primary">审核申请</h2>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">审核备注</label>
                <textarea
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="填写审核意见..."
                  className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30 min-h-[80px] resize-y"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary flex items-center gap-2">
                  <Award className="h-4 w-4 text-brand" />
                  分配邀请码（通过时必填）
                </label>
                <input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="输入邀请码"
                  className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-surface-border flex gap-3">
              <button
                onClick={() => setReviewingId(null)}
                className="flex-1 rounded-xl border border-surface-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleReview(reviewingId, "rejected")}
                disabled={actionLoading}
                className="flex-1 rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
              >
                拒绝
              </button>
              <button
                onClick={() => {
                  if (!inviteCode.trim()) {
                    alert("请分配邀请码");
                    return;
                  }
                  handleReview(reviewingId, "approved");
                }}
                disabled={actionLoading}
                className="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover transition-colors"
              >
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "通过"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
