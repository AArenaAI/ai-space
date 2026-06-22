"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Bot, Check, RefreshCw, Save, Search, Shield } from "lucide-react";
import { getAdminModelConfigs, updateAdminModelConfig, batchUpdateAdminModelConfigs } from "@/lib/admin/api";
import type { AdminModelConfig } from "@/lib/admin/types";
import { MetricCard } from "@/components/admin/MetricCard";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { cn } from "@/lib/utils";

const tierLabels: Record<string, string> = { basic: "基础", advanced: "高级" };
const tierOptions = ["basic", "advanced"];
const reasoningLabels: Record<string, string> = { fast: "快速", thinking: "思考", expert: "专家" };
const reasoningOptions = ["fast", "thinking", "expert"];
const statusOptions = [
  { value: "available", label: "可用" },
  { value: "disabled", label: "禁用" },
  { value: "maintenance", label: "维护" },
  { value: "quota_exhausted", label: "配额耗尽" },
  { value: "rate_limited", label: "限流" },
];

// Provider 思考等级选项（统一全集，各 provider 实际支持子集）。
// 后台配置保存明确值，不暴露“继承默认”，避免 JSON/DB 主从语义混淆。
const reasoningValueOptions = [
  { value: "minimal", label: "minimal" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];

// 按模型/Provider 显示推荐的等级子集。
// Gemini 2.5 不支持 thinkingLevel，只支持 thinkingBudget；Gemini 3 才使用 minimal/low/medium/high。
function getModelReasoningOptions(model: AdminModelConfig) {
  const p = (model.provider || "").toLowerCase();
  const modelID = (model.model_id || "").toLowerCase();
  if (p === "openai") {
    return [
      { value: "low", label: "low" },
      { value: "medium", label: "medium" },
      { value: "high", label: "high" },
      { value: "xhigh", label: "xhigh" },
    ];
  }
  if (p === "deepseek") {
    return [
      { value: "off", label: "off / 非思考" },
      { value: "high", label: "high" },
      { value: "max", label: "max" },
    ];
  }
  if (modelID.startsWith("gemini-2.5-")) {
    return [
      { value: "1024", label: "1024" },
      { value: "-1", label: "-1 动态" },
      { value: "32768", label: "32768" },
    ];
  }
  if (p === "google" || p === "gemini") {
    return [
      { value: "minimal", label: "minimal" },
      { value: "low", label: "low" },
      { value: "medium", label: "medium" },
      { value: "high", label: "high" },
    ];
  }
  // 通用 fallback
  return reasoningValueOptions;
}

export default function ManagementModelsPage() {
  const [models, setModels] = useState<AdminModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [pendingChanges, setPendingChanges] = useState<Map<string, Partial<AdminModelConfig>>>(new Map());
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminModelConfigs();
      setModels(data.models || []);
      setPendingChanges(new Map());
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载模型配置失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const providers = useMemo(() => {
    const set = new Set(models.map((m) => m.provider));
    return Array.from(set).sort();
  }, [models]);

  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return models.filter((model) => {
      const matchQ = !keyword || [model.model_id, model.name, model.provider, model.description].some((value) => value?.toLowerCase().includes(keyword));
      const matchProvider = providerFilter === "all" || model.provider === providerFilter;
      const matchTier = tierFilter === "all" || model.tier === tierFilter;
      const matchStatus = statusFilter === "all" || model.status === statusFilter;
      return matchQ && matchProvider && matchTier && matchStatus;
    });
  }, [models, q, providerFilter, tierFilter, statusFilter]);

  const enabledCount = models.filter((m) => m.enabled).length;
  const disabledCount = models.filter((m) => !m.enabled).length;
  const chatCount = models.filter((m) => m.capabilities.includes("chat")).length;
  const mediaCount = models.filter((m) => m.capabilities.includes("image") || m.capabilities.includes("video")).length;

  const updateLocal = useCallback((modelID: string, patch: Partial<AdminModelConfig>) => {
    setModels((prev) => prev.map((m) => (m.model_id === modelID ? { ...m, ...patch } : m)));
    setPendingChanges((prev) => {
      const next = new Map(prev);
      const existing = next.get(modelID) || {};
      next.set(modelID, { ...existing, ...patch });
      return next;
    });
  }, []);

  const saveSingle = async (modelID: string) => {
    const patch = pendingChanges.get(modelID);
    if (!patch) return;
    setSavingIds((prev) => new Set(prev).add(modelID));
    try {
      await updateAdminModelConfig(modelID, patch);
      setPendingChanges((prev) => {
        const next = new Map(prev);
        next.delete(modelID);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(modelID);
        return next;
      });
    }
  };

  const saveBatch = async () => {
    if (pendingChanges.size === 0) return;
    const items = Array.from(pendingChanges.entries()).map(([model_id, patch]) => ({ model_id, ...patch }));
    setShowBatchConfirm(false);
    try {
      await batchUpdateAdminModelConfigs(items);
      setPendingChanges(new Map());
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量保存失败");
    }
  };

  const toggleEnabled = (model: AdminModelConfig) => {
    updateLocal(model.model_id, { enabled: !model.enabled });
  };

  const changeTier = (model: AdminModelConfig, tier: string) => {
    updateLocal(model.model_id, { tier });
  };

  const changeReasoningLevel = (model: AdminModelConfig, reasoning_level: string) => {
    updateLocal(model.model_id, {
      reasoning_level,
      reasoning_level_name: reasoningLabels[reasoning_level] || reasoning_level,
    });
  };

  const changeReasoningMapping = (model: AdminModelConfig, field: "reasoning_fast_value" | "reasoning_thinking_value" | "reasoning_expert_value", value: string) => {
    updateLocal(model.model_id, { [field]: value });
  };

  const changeStatus = (model: AdminModelConfig, status: string) => {
    updateLocal(model.model_id, { status });
  };

  const hasPending = pendingChanges.size > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand">Model Catalog</p>
          <h1 className="mt-1 text-2xl font-semibold text-text-primary">模型配置面板</h1>
          <p className="mt-2 text-sm text-text-secondary">启用/禁用模型、调整等级和状态。修改后点击保存生效。</p>
        </div>
        <div className="flex items-center gap-2">
          {hasPending && (
            <button
              onClick={() => setShowBatchConfirm(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            >
              <Save className="h-4 w-4" />
              保存 {pendingChanges.size} 项修改
            </button>
          )}
          <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />刷新
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="模型总数" value={models.length} icon={Bot} helper="代码注册模型" />
        <MetricCard title="已启用" value={enabledCount} icon={Check} tone="green" helper={`禁用 ${disabledCount}`} />
        <MetricCard title="对话模型" value={chatCount} icon={Bot} helper="chat capability" />
        <MetricCard title="媒体模型" value={mediaCount} icon={Shield} helper="image / video" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-2xl border border-surface-border bg-surface-card p-4 sm:flex-row sm:items-center">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索模型 / Provider"
            className="w-full rounded-xl border border-surface-border bg-surface-elevated py-2.5 pl-9 pr-3 text-sm text-text-primary outline-none focus:border-brand/50"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 text-sm text-text-primary outline-none"
          >
            <option value="all">全部 Provider</option>
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 text-sm text-text-primary outline-none"
          >
            <option value="all">全部等级</option>
            {tierOptions.map((t) => (
              <option key={t} value={t}>{tierLabels[t]}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 text-sm text-text-primary outline-none"
          >
            <option value="all">全部状态</option>
            {statusOptions.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <section className="overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-elevated text-xs uppercase text-text-tertiary">
              <tr>
                <th className="px-4 py-3 font-medium">启用</th>
                <th className="px-4 py-3 font-medium">模型</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">等级</th>
                <th className="px-4 py-3 font-medium">思考映射</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">能力</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-text-tertiary">
                    {loading ? "加载中…" : "没有匹配的模型"}
                  </td>
                </tr>
              ) : (
                filtered.map((model) => {
                  const isSaving = savingIds.has(model.model_id);
                  const isChanged = pendingChanges.has(model.model_id);
                  return (
                    <tr key={model.model_id} className={cn("hover:bg-surface-elevated/60", isChanged && "bg-brand/5")}>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleEnabled(model)}
                          disabled={isSaving}
                          className={cn(
                            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                            model.enabled ? "bg-brand" : "bg-surface-border",
                            isSaving && "opacity-60"
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                              model.enabled ? "translate-x-6" : "translate-x-1"
                            )}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: model.color }} />
                          <div>
                            <div className="font-medium text-text-primary">{model.name}</div>
                            <div className="text-xs text-text-tertiary">{model.model_id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{model.provider}</td>
                      <td className="px-4 py-3">
                        <select
                          value={model.tier}
                          onChange={(e) => changeTier(model, e.target.value)}
                          disabled={isSaving}
                          className="rounded-lg border border-surface-border bg-surface-elevated px-2 py-1 text-xs text-text-primary outline-none"
                        >
                          {tierOptions.map((t) => (
                            <option key={t} value={t}>{tierLabels[t]}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        {model.capabilities.includes("reasoning") ? (
                          <div className="space-y-2">
                            <div className="text-[10px] text-text-tertiary">{model.reasoning_parameter || "provider_default"}</div>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-text-tertiary w-8">快速</span>
                              <select
                                value={model.reasoning_fast_value || ""}
                                onChange={(e) => changeReasoningMapping(model, "reasoning_fast_value", e.target.value)}
                                disabled={isSaving}
                                className="w-24 rounded-lg border border-surface-border bg-surface-elevated px-2 py-1 text-xs text-text-primary outline-none"
                              >
                                {getModelReasoningOptions(model).map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-text-tertiary w-8">思考</span>
                              <select
                                value={model.reasoning_thinking_value || ""}
                                onChange={(e) => changeReasoningMapping(model, "reasoning_thinking_value", e.target.value)}
                                disabled={isSaving}
                                className="w-24 rounded-lg border border-surface-border bg-surface-elevated px-2 py-1 text-xs text-text-primary outline-none"
                              >
                                {getModelReasoningOptions(model).map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-text-tertiary w-8">专家</span>
                              <select
                                value={model.reasoning_expert_value || ""}
                                onChange={(e) => changeReasoningMapping(model, "reasoning_expert_value", e.target.value)}
                                disabled={isSaving}
                                className="w-24 rounded-lg border border-surface-border bg-surface-elevated px-2 py-1 text-xs text-text-primary outline-none"
                              >
                                {getModelReasoningOptions(model).map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ) : (
                          <span className="rounded-md bg-surface-elevated px-2 py-1 text-xs text-text-tertiary">无</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <select
                            value={model.status}
                            onChange={(e) => changeStatus(model, e.target.value)}
                            disabled={isSaving}
                            className={cn(
                              "rounded-lg border px-2 py-1 text-xs outline-none",
                              model.status === "available" ? "border-green-500/30 bg-green-500/10 text-green-600" :
                              model.status === "disabled" ? "border-red-500/30 bg-red-500/10 text-red-600" :
                              model.status === "maintenance" ? "border-amber-500/30 bg-amber-500/10 text-amber-600" :
                              "border-surface-border bg-surface-elevated text-text-secondary"
                            )}
                          >
                            {statusOptions.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                          {model.status_message && (
                            <span className="text-xs text-text-tertiary">{model.status_message}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {model.capabilities.slice(0, 4).map((cap) => (
                            <span key={cap} className="rounded-md bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary">
                              {cap}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isChanged && (
                          <button
                            onClick={() => saveSingle(model.model_id)}
                            disabled={isSaving}
                            className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover disabled:opacity-50"
                          >
                            {isSaving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            保存
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
      </section>

      {/* Batch Confirm Modal */}
      {showBatchConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-text-primary">确认批量保存</h3>
            <p className="mt-2 text-sm text-text-secondary">即将保存 {pendingChanges.size} 项模型配置修改，是否继续？</p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowBatchConfirm(false)}
                className="rounded-xl border border-surface-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-elevated"
              >
                取消
              </button>
              <button
                onClick={saveBatch}
                className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
              >
                确认保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
