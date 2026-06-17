"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Bell, AlertTriangle, CheckCircle2, XCircle, Plus, Trash2, Edit2, Mail, Clock, Activity } from "lucide-react";
import { adminFetch } from "@/lib/admin/api";
import { toast } from "sonner";

interface AlertRule {
  id: number;
  name: string;
  event_type: string;
  metric: string;
  threshold: number;
  window_min: number;
  enabled: boolean;
  notify_email: string;
  created_at: string;
}

interface AlertHistory {
  id: number;
  rule_name: string;
  event_type: string;
  metric: string;
  value: number;
  threshold: number;
  status: "firing" | "resolved";
  message: string;
  created_at: string;
  resolved_at?: string;
}

interface AlertStats {
  total_firing: number;
  total_resolved: number;
  total_today: number;
}

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistory[]>([]);
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"rules" | "history">("rules");
  const [editOpen, setEditOpen] = useState(false);
  const [editRule, setEditRule] = useState<AlertRule | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [rulesData, historyData, statsData] = await Promise.all([
        adminFetch<{ rules: AlertRule[] }>("/api/admin/alert-rules"),
        adminFetch<{ alerts: AlertHistory[]; total: number }>("/api/admin/alert-history?page=1&page_size=50"),
        adminFetch<AlertStats>("/api/admin/alert-stats"),
      ]);
      setRules(rulesData.rules);
      setHistory(historyData.alerts);
      setStats(statsData);
    } catch (err) {
      toast.error("加载告警数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleResolve = async (id: number) => {
    try {
      await adminFetch(`/api/admin/alert-history/${id}/resolve`, { method: "PATCH" });
      toast.success("已标记为已恢复");
      fetchData();
    } catch {
      toast.error("操作失败");
    }
  };

  const handleDeleteRule = async (id: number) => {
    if (!confirm("确定删除此告警规则？")) return;
    try {
      await adminFetch(`/api/admin/alert-rules/${id}`, { method: "DELETE" });
      toast.success("已删除");
      fetchData();
    } catch {
      toast.error("删除失败");
    }
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editRule) return;
    try {
      const url = editRule.id
        ? `/api/admin/alert-rules/${editRule.id}`
        : "/api/admin/alert-rules";
      const method = editRule.id ? "PUT" : "POST";
      await adminFetch(url, {
        method,
        body: JSON.stringify(editRule),
      });
      toast.success(editRule.id ? "已更新" : "已创建");
      setEditOpen(false);
      setEditRule(null);
      fetchData();
    } catch {
      toast.error("保存失败");
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">异常监控告警</h1>
          <p className="mt-1 text-sm text-text-secondary">自动检测异常并发送通知</p>
        </div>
        <button
          onClick={() => {
            setEditRule({
              id: 0,
              name: "",
              event_type: "error",
              metric: "error_rate",
              threshold: 5,
              window_min: 5,
              enabled: true,
              notify_email: "",
              created_at: "",
            });
            setEditOpen(true);
          }}
          className="flex items-center gap-2 rounded-lg bg-text-primary px-4 py-2 text-sm font-medium text-surface hover:bg-text-primary/90"
        >
          <Plus className="h-4 w-4" />
          新建规则
        </button>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-surface-border bg-surface-card p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <span className="text-sm text-text-secondary">未恢复告警</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-destructive">{stats.total_firing}</p>
          </div>
          <div className="rounded-xl border border-surface-border bg-surface-card p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="text-sm text-text-secondary">已恢复</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-green-500">{stats.total_resolved}</p>
          </div>
          <div className="rounded-xl border border-surface-border bg-surface-card p-4">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-text-primary" />
              <span className="text-sm text-text-secondary">今日告警</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-text-primary">{stats.total_today}</p>
          </div>
        </div>
      )}

      {/* 标签页 */}
      <div className="flex gap-4 border-b border-surface-border">
        <button
          onClick={() => setActiveTab("rules")}
          className={`pb-3 text-sm font-medium ${
            activeTab === "rules"
              ? "border-b-2 border-text-primary text-text-primary"
              : "text-text-secondary"
          }`}
        >
          告警规则 ({rules.length})
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`pb-3 text-sm font-medium ${
            activeTab === "history"
              ? "border-b-2 border-text-primary text-text-primary"
              : "text-text-secondary"
          }`}
        >
          告警历史 ({history.length})
        </button>
      </div>

      {/* 规则列表 */}
      {activeTab === "rules" && (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-card p-4"
            >
              <div className="flex items-center gap-4">
                <div className={`h-2 w-2 rounded-full ${rule.enabled ? "bg-green-500" : "bg-text-tertiary"}`} />
                <div>
                  <p className="font-medium text-text-primary">{rule.name}</p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {rule.event_type} · {rule.metric} {rule.threshold} · {rule.window_min}分钟窗口
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {rule.notify_email && (
                  <span className="flex items-center gap-1 text-xs text-text-tertiary">
                    <Mail className="h-3 w-3" />
                    {rule.notify_email}
                  </span>
                )}
                <button
                  onClick={() => {
                    setEditRule(rule);
                    setEditOpen(true);
                  }}
                  className="rounded-lg p-2 hover:bg-surface-hover"
                >
                  <Edit2 className="h-4 w-4 text-text-secondary" />
                </button>
                <button
                  onClick={() => handleDeleteRule(rule.id)}
                  className="rounded-lg p-2 hover:bg-surface-hover"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 历史列表 */}
      {activeTab === "history" && (
        <div className="space-y-3">
          {history.map((alert) => (
            <div
              key={alert.id}
              className={`rounded-xl border p-4 ${
                alert.status === "firing"
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-surface-border bg-surface-card"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {alert.status === "firing" ? (
                    <Bell className="h-5 w-5 text-destructive" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  )}
                  <div>
                    <p className="font-medium text-text-primary">{alert.rule_name}</p>
                    <p className="mt-0.5 text-sm text-text-secondary">{alert.message}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-tertiary">
                    <Clock className="mr-1 inline h-3 w-3" />
                    {new Date(alert.created_at).toLocaleString()}
                  </span>
                  {alert.status === "firing" && (
                    <button
                      onClick={() => handleResolve(alert.id)}
                      className="rounded-lg bg-green-500 px-3 py-1 text-xs font-medium text-white hover:bg-green-600"
                    >
                      标记恢复
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 编辑弹窗 */}
      {editOpen && editRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-surface-card p-6 shadow-xl">
            <h3 className="text-lg font-bold text-text-primary">
              {editRule.id ? "编辑规则" : "新建规则"}
            </h3>
            <form onSubmit={handleSaveRule} className="mt-4 space-y-4">
              <div>
                <label className="text-sm text-text-secondary">规则名称</label>
                <input
                  value={editRule.name}
                  onChange={(e) => setEditRule({ ...editRule, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-surface-border bg-surface p-2 text-sm"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-text-secondary">事件类型</label>
                  <select
                    value={editRule.event_type}
                    onChange={(e) => setEditRule({ ...editRule, event_type: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-surface-border bg-surface p-2 text-sm"
                  >
                    <option value="error">错误</option>
                    <option value="credit_use">积分使用</option>
                    <option value="chat_complete">聊天完成</option>
                    <option value="bad_case_submit">BadCase</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-text-secondary">指标</label>
                  <select
                    value={editRule.metric}
                    onChange={(e) => setEditRule({ ...editRule, metric: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-surface-border bg-surface p-2 text-sm"
                  >
                    <option value="error_rate">错误率 (%)</option>
                    <option value="count">次数</option>
                    <option value="completion_rate">完成率 (%)</option>
                    <option value="latency">耗时 (ms)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-text-secondary">阈值</label>
                  <input
                    type="number"
                    value={editRule.threshold}
                    onChange={(e) => setEditRule({ ...editRule, threshold: parseFloat(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-surface-border bg-surface p-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm text-text-secondary">窗口 (分钟)</label>
                  <input
                    type="number"
                    value={editRule.window_min}
                    onChange={(e) => setEditRule({ ...editRule, window_min: parseInt(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-surface-border bg-surface p-2 text-sm"
                    min={1}
                    max={60}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm text-text-secondary">通知邮箱</label>
                <input
                  type="email"
                  value={editRule.notify_email}
                  onChange={(e) => setEditRule({ ...editRule, notify_email: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-surface-border bg-surface p-2 text-sm"
                  placeholder="admin@example.com"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editRule.enabled}
                  onChange={(e) => setEditRule({ ...editRule, enabled: e.target.checked })}
                  className="h-4 w-4"
                />
                <span className="text-sm text-text-secondary">启用规则</span>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditOpen(false);
                    setEditRule(null);
                  }}
                  className="rounded-lg border border-surface-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-text-primary px-4 py-2 text-sm font-medium text-surface hover:bg-text-primary/90"
                >
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
