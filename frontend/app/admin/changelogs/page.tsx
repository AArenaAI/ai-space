"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Plus, Save, RotateCcw, Eye, EyeOff, Pin, PinOff, Trash2, Edit3, CheckCircle, XCircle, FileText, Tag, Calendar, ChevronLeft, ChevronRight, Search, Filter } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch } from "@/lib/admin/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Changelog {
  id: number;
  version: string;
  title: string;
  content: string;
  category: "feature" | "fix" | "optimize" | "breaking";
  is_published: boolean;
  published_at?: string;
  is_pinned: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  feature: "新功能",
  fix: "修复",
  optimize: "优化",
  breaking: "重大变更",
};

const CATEGORY_COLORS: Record<string, string> = {
  feature: "bg-emerald-50 text-emerald-700 border-emerald-200",
  fix: "bg-red-50 text-red-700 border-red-200",
  optimize: "bg-blue-50 text-blue-700 border-blue-200",
  breaking: "bg-amber-50 text-amber-700 border-amber-200",
};

export default function ChangelogsPage() {
  const [changelogs, setChangelogs] = useState<Changelog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<Changelog>>({
    version: "",
    title: "",
    content: "",
    category: "feature",
    is_pinned: false,
    sort_order: 0,
  });

  const fetchChangelogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      if (categoryFilter) params.set("category", categoryFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const data = await adminFetch<{ changelogs: Changelog[]; total: number }>(`/api/admin/changelogs?${params}`);
      setChangelogs(data.changelogs || []);
      setTotal(data.total || 0);
    } catch (err) {
      toast.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, categoryFilter, statusFilter]);

  useEffect(() => {
    fetchChangelogs();
  }, [fetchChangelogs]);

  const handleSave = async () => {
    if (!form.version || !form.title || !form.content || !form.category) return;
    setSaving(true);
    try {
      const url = editingId ? `/api/admin/changelogs/${editingId}` : "/api/admin/changelogs";
      const method = editingId ? "PUT" : "POST";
      await adminFetch(url, {
        method,
        body: JSON.stringify(form),
      });
      toast.success(editingId ? "更新已保存" : "更新已创建");
      setShowForm(false);
      setEditingId(null);
      setForm({ version: "", title: "", content: "", category: "feature", is_pinned: false, sort_order: 0 });
      fetchChangelogs();
    } catch (err) {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async (id: number) => {
    try {
      await adminFetch(`/api/admin/changelogs/${id}/publish`, { method: "POST" });
      toast.success("已发布");
      fetchChangelogs();
    } catch (err) {
      toast.error("发布失败");
    }
  };

  const handleUnpublish = async (id: number) => {
    try {
      await adminFetch(`/api/admin/changelogs/${id}/unpublish`, { method: "POST" });
      toast.success("已取消发布");
      fetchChangelogs();
    } catch (err) {
      toast.error("操作失败");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除这条更新日志？")) return;
    try {
      await adminFetch(`/api/admin/changelogs/${id}`, { method: "DELETE" });
      toast.success("已删除");
      fetchChangelogs();
    } catch (err) {
      toast.error("删除失败");
    }
  };

  const handleEdit = (cl: Changelog) => {
    setForm({
      version: cl.version,
      title: cl.title,
      content: cl.content,
      category: cl.category,
      is_pinned: cl.is_pinned,
      sort_order: cl.sort_order,
    });
    setEditingId(cl.id);
    setShowForm(true);
  };

  const filteredChangelogs = changelogs.filter((cl) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      cl.title.toLowerCase().includes(q) ||
      cl.version.toLowerCase().includes(q) ||
      cl.content.toLowerCase().includes(q)
    );
  });

  const totalPages = Math.ceil(total / pageSize);

  return (
    <AdminShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">更新日志</h1>
            <p className="text-sm text-text-tertiary">管理产品更新公告，内测用户将收到推送</p>
          </div>
          <button
            onClick={() => {
              setEditingId(null);
              setForm({ version: "", title: "", content: "", category: "feature", is_pinned: false, sort_order: 0 });
              setShowForm(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-hover"
          >
            <Plus className="h-4 w-4" />
            新建更新
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              placeholder="搜索版本/标题/内容..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-64 rounded-lg border border-surface-border bg-surface-card pl-8 pr-3 text-sm outline-none focus:border-brand/60"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 rounded-lg border border-surface-border bg-surface-card px-3 text-sm outline-none focus:border-brand/60"
          >
            <option value="">全部分类</option>
            <option value="feature">新功能</option>
            <option value="fix">修复</option>
            <option value="optimize">优化</option>
            <option value="breaking">重大变更</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-surface-border bg-surface-card px-3 text-sm outline-none focus:border-brand/60"
          >
            <option value="all">全部状态</option>
            <option value="published">已发布</option>
            <option value="draft">草稿</option>
          </select>
          <button
            onClick={fetchChangelogs}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-surface-border bg-surface-card px-3 text-sm text-text-secondary hover:text-text-primary"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            刷新
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <div className="rounded-2xl border border-surface-border bg-surface-elevated p-5 shadow-sm">
            <h3 className="mb-4 text-base font-semibold text-text-primary">
              {editingId ? "编辑更新" : "新建更新"}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-text-secondary">版本号</label>
                <input
                  type="text"
                  value={form.version || ""}
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                  placeholder="如 v1.2.0"
                  className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm outline-none focus:border-brand/60"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-text-secondary">分类</label>
                <select
                  value={form.category || "feature"}
                  onChange={(e) => setForm({ ...form, category: e.target.value as any })}
                  className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm outline-none focus:border-brand/60"
                >
                  <option value="feature">新功能</option>
                  <option value="fix">修复</option>
                  <option value="optimize">优化</option>
                  <option value="breaking">重大变更</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-text-secondary">标题</label>
                <input
                  type="text"
                  value={form.title || ""}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="更新标题"
                  className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm outline-none focus:border-brand/60"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-text-secondary">内容（支持 Markdown）</label>
                <textarea
                  value={form.content || ""}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="输入 Markdown 格式的更新内容..."
                  rows={8}
                  className="w-full resize-none rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm font-mono outline-none focus:border-brand/60"
                />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={form.is_pinned || false}
                    onChange={(e) => setForm({ ...form, is_pinned: e.target.checked })}
                    className="rounded border-surface-border"
                  />
                  置顶
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-text-secondary">排序</label>
                  <input
                    type="number"
                    value={form.sort_order || 0}
                    onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                    className="w-20 rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-sm text-center outline-none focus:border-brand/60"
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !form.version || !form.title || !form.content}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-hover disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {editingId ? "保存修改" : "创建"}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-surface-border bg-surface-card px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="rounded-2xl border border-surface-border bg-surface-elevated shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface-card/50">
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">版本</th>
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">标题</th>
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">分类</th>
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">状态</th>
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">置顶</th>
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">发布时间</th>
                  <th className="px-4 py-3 text-right font-medium text-text-secondary">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-text-tertiary">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                ) : filteredChangelogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-text-tertiary">
                      暂无更新日志
                    </td>
                  </tr>
                ) : (
                  filteredChangelogs.map((cl) => (
                    <tr key={cl.id} className="border-b border-surface-border hover:bg-surface-card/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-text-primary">{cl.version}</td>
                      <td className="px-4 py-3 max-w-xs truncate text-text-primary" title={cl.title}>
                        {cl.title}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium", CATEGORY_COLORS[cl.category] || "bg-gray-50 text-gray-700 border-gray-200")}>
                          <Tag className="h-3 w-3" />
                          {CATEGORY_LABELS[cl.category] || cl.category}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {cl.is_published ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                            <CheckCircle className="h-3.5 w-3.5" />
                            已发布
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-text-tertiary">
                            <XCircle className="h-3.5 w-3.5" />
                            草稿
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {cl.is_pinned ? (
                          <Pin className="h-4 w-4 text-brand" />
                        ) : (
                          <PinOff className="h-4 w-4 text-text-tertiary" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-tertiary">
                        {cl.published_at ? new Date(cl.published_at).toLocaleDateString("zh-CN") : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {cl.is_published ? (
                            <button
                              onClick={() => handleUnpublish(cl.id)}
                              className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-card hover:text-amber-600"
                              title="取消发布"
                            >
                              <EyeOff className="h-4 w-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handlePublish(cl.id)}
                              className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-card hover:text-emerald-600"
                              title="发布"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleEdit(cl)}
                            className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-card hover:text-brand"
                            title="编辑"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(cl.id)}
                            className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-card hover:text-red-500"
                            title="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-surface-border px-4 py-3">
              <span className="text-sm text-text-tertiary">
                共 {total} 条，第 {page}/{totalPages} 页
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-card disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-card disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
