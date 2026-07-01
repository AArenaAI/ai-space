"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Loader2, RefreshCw, Save, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { getAdminBillingPlans, updateAdminBillingPlan } from "@/lib/admin/api";
import type { AdminBillingPlan } from "@/lib/admin/types";
import { formatNumber } from "@/lib/admin/format";
import { cn } from "@/lib/utils";

type EditablePlan = Omit<AdminBillingPlan, "created_at" | "updated_at">;

export default function AdminBillingPage() {
  const [plans, setPlans] = useState<EditablePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAdminBillingPlans();
      setPlans(data.plans.map(({ created_at: _createdAt, updated_at: _updatedAt, ...plan }) => plan));
    } catch (error) {
      console.error("Billing plans fetch error", error);
      toast.error("加载套餐定价失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const basicPlan = useMemo(() => plans.find((plan) => plan.code === "basic") || plans[0], [plans]);

  const patchPlan = (id: number, patch: Partial<EditablePlan>) => {
    setPlans((prev) => prev.map((plan) => plan.id === id ? { ...plan, ...patch } : plan));
  };

  const savePlan = async (plan: EditablePlan) => {
    setSavingId(plan.id);
    try {
      const { id: _id, ...payload } = plan;
      const result = await updateAdminBillingPlan(plan.id, payload);
      setPlans((prev) => prev.map((item) => item.id === plan.id ? { ...result.plan } : item));
      toast.success("套餐定价已保存");
    } catch (error) {
      console.error("Billing plan save error", error);
      toast.error(error instanceof Error ? error.message : "保存套餐失败");
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return <div className="flex h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-text-tertiary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand">Pricing</p>
          <h1 className="mt-1 text-2xl font-semibold text-text-primary">套餐定价面板</h1>
          <p className="mt-2 text-sm text-text-secondary">配置会员售价、月度基础积分和高级积分。当前先以基础版作为线上定价源。</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
          <RefreshCw className="h-4 w-4" />刷新
        </button>
      </div>

      {basicPlan && (
        <section className="rounded-3xl border border-brand/25 bg-brand/5 p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
                <CreditCard className="h-3.5 w-3.5" />当前基础版
              </div>
              <h2 className="mt-3 text-xl font-semibold text-text-primary">{basicPlan.name}</h2>
              <p className="mt-1 text-sm text-text-secondary">{basicPlan.description || "基础会员套餐"}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryCard label="价格" value={`¥${(basicPlan.price_cents / 100).toFixed(0)}`} helper="每月" />
              <SummaryCard label="基础积分" value={formatNumber(basicPlan.basic_credits)} helper="/ 月" />
              <SummaryCard label="高级积分" value={formatNumber(basicPlan.advanced_credits)} helper="/ 月" />
            </div>
          </div>
        </section>
      )}

      <div className="space-y-4">
        {plans.map((plan) => (
          <section key={plan.id} className="rounded-3xl border border-surface-border bg-surface-card p-5 shadow-sm">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">{plan.name}</h3>
                <p className="mt-1 text-xs text-text-tertiary">code: {plan.code} · {plan.interval || "monthly"} · {plan.currency || "CNY"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => patchPlan(plan.id, { enabled: !plan.enabled })} className={cn("inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm", plan.enabled ? "bg-green-500/10 text-green-600" : "bg-surface-elevated text-text-tertiary")}>
                  {plan.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}{plan.enabled ? "启用" : "停用"}
                </button>
                <button onClick={() => patchPlan(plan.id, { public_visible: !plan.public_visible })} className={cn("rounded-xl px-3 py-2 text-sm", plan.public_visible ? "bg-brand/10 text-brand" : "bg-surface-elevated text-text-tertiary")}>
                  {plan.public_visible ? "前台可见" : "前台隐藏"}
                </button>
                <button onClick={() => savePlan(plan)} disabled={savingId === plan.id} className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {savingId === plan.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Field label="套餐名称" value={plan.name} onChange={(value) => patchPlan(plan.id, { name: value })} />
              <Field label="价格（元/月）" type="number" value={String(plan.price_cents / 100)} onChange={(value) => patchPlan(plan.id, { price_cents: Math.round(Number(value || 0) * 100) })} />
              <Field label="基础积分 / 月" type="number" value={String(plan.basic_credits)} onChange={(value) => patchPlan(plan.id, { basic_credits: Number(value || 0) })} />
              <Field label="高级积分 / 月" type="number" value={String(plan.advanced_credits)} onChange={(value) => patchPlan(plan.id, { advanced_credits: Number(value || 0) })} />
              <Field label="排序" type="number" value={String(plan.sort_order)} onChange={(value) => patchPlan(plan.id, { sort_order: Number(value || 0) })} />
              <Field label="支付渠道" value={plan.provider || "manual"} onChange={(value) => patchPlan(plan.id, { provider: value })} />
              <Field label="渠道价格 ID" value={plan.provider_price_id || ""} onChange={(value) => patchPlan(plan.id, { provider_price_id: value })} />
              <Field label="专家积分 / 月" type="number" value={String(plan.elite_credits || 0)} onChange={(value) => patchPlan(plan.id, { elite_credits: Number(value || 0) })} />
            </div>
            <label className="mt-4 block text-sm">
              <span className="text-xs font-medium text-text-tertiary">套餐说明</span>
              <textarea value={plan.description || ""} onChange={(event) => patchPlan(plan.id, { description: event.target.value })} className="mt-1 min-h-20 w-full rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 text-text-primary outline-none focus:border-brand" />
            </label>
          </section>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return <div className="min-w-36 rounded-2xl border border-surface-border bg-surface-card p-4"><div className="text-xs text-text-tertiary">{label}</div><div className="mt-1 text-2xl font-semibold text-text-primary">{value}</div><div className="mt-1 text-xs text-text-tertiary">{helper}</div></div>;
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-medium text-text-tertiary">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 text-text-primary outline-none focus:border-brand" />
    </label>
  );
}
