"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, TrendingUp, Users, MousePointer, MessageSquare, CreditCard, AlertTriangle, BarChart3, Activity, Zap, ChevronDown, ChevronUp } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch } from "@/lib/admin/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AnalyticsSummary {
  date: string;
  page_views: number;
  chat_starts: number;
  chat_completes: number;
  model_switches: number;
  credit_uses: number;
  beta_applies: number;
  invite_uses: number;
  bad_case_submits: number;
  errors: number;
  unique_users: number;
  avg_chat_duration_ms: number;
}

interface FunnelStage {
  stage: string;
  users: number;
  conversion: number;
  drop_off: number;
  description: string;
}

interface ModelUsage {
  model_id: string;
  model_name: string;
  usage_count: number;
  user_count: number;
  avg_duration_ms: number;
  error_rate: number;
}

interface RealtimeStats {
  today_events: number;
  last_hour_events: number;
  online_users: number;
  timestamp: string;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(7);
  const [summaries, setSummaries] = useState<AnalyticsSummary[]>([]);
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [modelStats, setModelStats] = useState<ModelUsage[]>([]);
  const [realtime, setRealtime] = useState<RealtimeStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "funnel" | "models">("overview");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryData, funnelData, modelData, realtimeData] = await Promise.all([
        adminFetch<{ summaries: AnalyticsSummary[] }>(`/api/admin/analytics/summary?days=${days}`),
        adminFetch<{ funnel: FunnelStage[] }>(`/api/admin/analytics/funnel?days=${days}`),
        adminFetch<{ stats: ModelUsage[] }>(`/api/admin/analytics/model-usage?days=${days}`),
        adminFetch<RealtimeStats>(`/api/admin/analytics/realtime`),
      ]);

      setSummaries(summaryData.summaries || []);
      setFunnel(funnelData.funnel || []);
      setModelStats(modelData.stats || []);
      setRealtime(realtimeData);
    } catch {
      toast.error("加载分析数据失败");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 汇总数据
  const totalPageViews = summaries.reduce((sum, s) => sum + s.page_views, 0);
  const totalChatStarts = summaries.reduce((sum, s) => sum + s.chat_starts, 0);
  const totalChatCompletes = summaries.reduce((sum, s) => sum + s.chat_completes, 0);
  const totalCreditUses = summaries.reduce((sum, s) => sum + s.credit_uses, 0);
  const totalErrors = summaries.reduce((sum, s) => sum + s.errors, 0);
  const avgCompletionRate = totalChatStarts > 0 ? (totalChatCompletes / totalChatStarts * 100).toFixed(1) : "0";

  return (
    <AdminShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">数据分析</h1>
            <p className="text-sm text-text-tertiary">用户行为追踪与转化分析</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-9 rounded-lg border border-surface-border bg-surface-card px-3 text-sm outline-none focus:border-brand/60"
            >
              <option value={7}>最近7天</option>
              <option value={14}>最近14天</option>
              <option value={30}>最近30天</option>
              <option value={90}>最近90天</option>
            </select>
            <button
              onClick={fetchData}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-surface-border bg-surface-card px-3 text-sm text-text-secondary hover:text-text-primary"
            >
              <Activity className="h-3.5 w-3.5" />
              刷新
            </button>
          </div>
        </div>

        {/* Realtime Stats */}
        {realtime && (
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard
              title="今日事件"
              value={realtime.today_events.toLocaleString()}
              icon={Zap}
              helper="实时"
              color="text-amber-600"
            />
            <MetricCard
              title="近1小时"
              value={realtime.last_hour_events.toLocaleString()}
              icon={Activity}
              helper="事件数"
              color="text-blue-600"
            />
            <MetricCard
              title="在线用户"
              value={realtime.online_users.toLocaleString()}
              icon={Users}
              helper="近1小时活跃"
              color="text-emerald-600"
            />
            <MetricCard
              title="对话完成率"
              value={`${avgCompletionRate}%`}
              icon={TrendingUp}
              helper={`${totalChatCompletes}/${totalChatStarts}`}
              color="text-purple-600"
            />
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-surface-border">
          {[
            { key: "overview", label: "概览", icon: BarChart3 },
            { key: "funnel", label: "漏斗", icon: TrendingUp },
            { key: "models", label: "模型", icon: MousePointer },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors",
                activeTab === tab.key
                  ? "border-b-2 border-brand text-brand"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="space-y-4">
            {loading ? (
              <div className="py-8 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-text-tertiary" />
              </div>
            ) : summaries.length === 0 ? (
              <div className="rounded-2xl border border-surface-border bg-surface-elevated p-8 text-center text-sm text-text-tertiary">
                暂无数据
              </div>
            ) : (
              <div className="rounded-2xl border border-surface-border bg-surface-elevated shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-border bg-surface-card/50">
                        <th className="px-4 py-3 text-left font-medium text-text-secondary">日期</th>
                        <th className="px-4 py-3 text-right font-medium text-text-secondary">页面访问</th>
                        <th className="px-4 py-3 text-right font-medium text-text-secondary">对话开始</th>
                        <th className="px-4 py-3 text-right font-medium text-text-secondary">对话完成</th>
                        <th className="px-4 py-3 text-right font-medium text-text-secondary">积分使用</th>
                        <th className="px-4 py-3 text-right font-medium text-text-secondary">模型切换</th>
                        <th className="px-4 py-3 text-right font-medium text-text-secondary">内测申请</th>
                        <th className="px-4 py-3 text-right font-medium text-text-secondary">错误</th>
                        <th className="px-4 py-3 text-right font-medium text-text-secondary">独立用户</th>
                        <th className="px-4 py-3 text-right font-medium text-text-secondary">平均耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaries.map((s) => (
                        <tr key={s.date} className="border-b border-surface-border hover:bg-surface-card/30">
                          <td className="px-4 py-3 font-mono text-text-primary">{s.date}</td>
                          <td className="px-4 py-3 text-right text-text-primary">{s.page_views.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-text-primary">{s.chat_starts.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-emerald-600">{s.chat_completes.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-amber-600">{s.credit_uses.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-text-primary">{s.model_switches.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-blue-600">{s.beta_applies.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-red-500">{s.errors.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-purple-600">{s.unique_users.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-text-tertiary">
                            {s.avg_chat_duration_ms > 0 ? `${(s.avg_chat_duration_ms / 1000).toFixed(1)}s` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Funnel Tab */}
        {activeTab === "funnel" && (
          <div className="space-y-4">
            {loading ? (
              <div className="py-8 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-text-tertiary" />
              </div>
            ) : funnel.length === 0 ? (
              <div className="rounded-2xl border border-surface-border bg-surface-elevated p-8 text-center text-sm text-text-tertiary">
                暂无数据
              </div>
            ) : (
              <div className="rounded-2xl border border-surface-border bg-surface-elevated p-6 shadow-sm">
                <div className="space-y-4">
                  {funnel.map((stage, index) => (
                    <div key={stage.stage} className="relative">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-text-primary">{stage.stage}</span>
                            <span className="text-sm font-semibold text-text-primary">{stage.users.toLocaleString()} 人</span>
                          </div>
                          <div className="h-2 rounded-full bg-surface-card overflow-hidden">
                            <div
                              className="h-full rounded-full bg-brand transition-all"
                              style={{ width: `${Math.max(stage.conversion, 5)}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-text-tertiary">{stage.description}</span>
                            <div className="flex items-center gap-2 text-xs">
                              {index > 0 && (
                                <>
                                  <span className="text-emerald-600">转化 {stage.conversion.toFixed(1)}%</span>
                                  <span className="text-red-400">流失 {stage.drop_off.toFixed(1)}%</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      {index < funnel.length - 1 && (
                        <div className="ml-5 mt-2 h-4 border-l-2 border-dashed border-surface-border" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Models Tab */}
        {activeTab === "models" && (
          <div className="space-y-4">
            {loading ? (
              <div className="py-8 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-text-tertiary" />
              </div>
            ) : modelStats.length === 0 ? (
              <div className="rounded-2xl border border-surface-border bg-surface-elevated p-8 text-center text-sm text-text-tertiary">
                暂无数据
              </div>
            ) : (
              <div className="rounded-2xl border border-surface-border bg-surface-elevated shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-border bg-surface-card/50">
                        <th className="px-4 py-3 text-left font-medium text-text-secondary">模型</th>
                        <th className="px-4 py-3 text-right font-medium text-text-secondary">使用次数</th>
                        <th className="px-4 py-3 text-right font-medium text-text-secondary">用户数</th>
                        <th className="px-4 py-3 text-right font-medium text-text-secondary">平均耗时</th>
                        <th className="px-4 py-3 text-right font-medium text-text-secondary">错误率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelStats.map((m) => (
                        <tr key={m.model_id} className="border-b border-surface-border hover:bg-surface-card/30">
                          <td className="px-4 py-3">
                            <div className="font-medium text-text-primary">{m.model_name}</div>
                            <div className="text-xs text-text-tertiary font-mono">{m.model_id}</div>
                          </td>
                          <td className="px-4 py-3 text-right text-text-primary">{m.usage_count.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-purple-600">{m.user_count.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-text-tertiary">
                            {m.avg_duration_ms > 0 ? `${(m.avg_duration_ms / 1000).toFixed(1)}s` : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={cn(
                              "text-xs font-medium",
                              m.error_rate > 5 ? "text-red-500" : m.error_rate > 1 ? "text-amber-500" : "text-emerald-600"
                            )}>
                              {m.error_rate.toFixed(2)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function MetricCard({
  title,
  value,
  icon: Icon,
  helper,
  color,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  helper?: string;
  color?: string;
}) {
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-elevated p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-tertiary">{title}</span>
        <Icon className={cn("h-4 w-4", color || "text-text-tertiary")} />
      </div>
      <div className="mt-2 text-2xl font-bold text-text-primary">{value}</div>
      {helper && <div className="mt-1 text-xs text-text-tertiary">{helper}</div>}
    </div>
  );
}
