"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Bot, RefreshCw, Search } from "lucide-react";
import { getAdminModels } from "@/lib/admin/api";
import type { AdminModel } from "@/lib/admin/types";
import { MetricCard } from "@/components/admin/MetricCard";
import { cn } from "@/lib/utils";

const tierLabels: Record<string, string> = { basic: "基础", advanced: "高级", elite: "精英" };

export default function ManagementModelsPage() {
  const [models, setModels] = useState<AdminModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("all");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminModels();
      setModels(data.models || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载模型列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => models.filter((model) => {
    const keyword = q.trim().toLowerCase();
    const matchQ = !keyword || [model.id, model.name, model.provider, model.description].some((value) => value?.toLowerCase().includes(keyword));
    const matchTier = tier === "all" || model.tier === tier;
    return matchQ && matchTier;
  }), [models, q, tier]);

  const providerCount = new Set(models.map((m) => m.provider)).size;
  const searchCount = models.filter((m) => m.capabilities.includes("native_search")).length;
  const fileCount = models.filter((m) => m.capabilities.includes("file")).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand">Model Catalog</p>
          <h1 className="mt-1 text-2xl font-semibold text-text-primary">模型只读面板</h1>
          <p className="mt-2 text-sm text-text-secondary">集中查看当前代码注册的模型、供应商、能力标签和额度等级。编辑配置下一阶段接入。</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
          <RefreshCw className="h-4 w-4" />刷新
        </button>
      </div>

      {error && <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300"><AlertCircle className="h-4 w-4" />{error}</div>}

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="模型数" value={models.length} icon={Bot} helper="modelmeta.AllModels" />
        <MetricCard title="Provider" value={providerCount} icon={Bot} helper="供应商数量" />
        <MetricCard title="原生搜索" value={searchCount} icon={Search} helper="native_search" />
        <MetricCard title="文件能力" value={fileCount} icon={Bot} helper="file / document" />
      </div>

      <section className="rounded-3xl border border-surface-border bg-surface-card p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索模型 / Provider" className="w-full rounded-2xl border border-surface-border bg-surface-elevated py-2.5 pl-9 pr-3 text-sm text-text-primary outline-none focus:border-brand/50" />
          </div>
          <div className="flex gap-2">
            {['all','basic','advanced','elite'].map((value) => (
              <button key={value} onClick={() => setTier(value)} className={cn("rounded-xl px-3 py-2 text-sm", tier === value ? "bg-brand text-white" : "bg-surface-elevated text-text-secondary hover:text-text-primary")}>{value === 'all' ? '全部' : tierLabels[value]}</button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading ? <div className="text-sm text-text-secondary">正在加载模型…</div> : filtered.map((model) => (
            <article key={model.id} className="rounded-3xl border border-surface-border bg-surface-elevated p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-text-primary">{model.name}</h2>
                  <p className="mt-1 text-xs text-text-tertiary">{model.id}</p>
                </div>
                <span className="rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">{tierLabels[model.tier] || model.tier}</span>
              </div>
              <p className="mt-3 line-clamp-2 text-sm leading-6 text-text-secondary">{model.description || "暂无描述"}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full bg-surface-card px-2.5 py-1 text-xs text-text-secondary">{model.provider}</span>
                {model.modalities.map((item) => <span key={item} className="rounded-full bg-surface-card px-2.5 py-1 text-xs text-text-secondary">{item}</span>)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {model.capabilities.map((item) => <span key={item} className="rounded-full border border-surface-border px-2.5 py-1 text-xs text-text-tertiary">{item}</span>)}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
