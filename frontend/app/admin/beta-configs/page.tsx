"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Save, RotateCcw, Coins, Cpu, AlertTriangle, Search, Tag } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch } from "@/lib/admin/api";
import { toast } from "sonner";

interface BetaConfigItem {
  id: number;
  key: string;
  value: string;
  desc?: string;
  parsed_value?: unknown;
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description: string;
  color: string;
  category: string;
  capabilities: string[];
  tier: string;
  status: string;
  enabled: boolean;
}

interface ModelCostMap {
  [modelId: string]: number;
}

export default function BetaConfigPage() {
  const [configs, setConfigs] = useState<BetaConfigItem[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const [configData, modelData] = await Promise.all([
        adminFetch<{ items: BetaConfigItem[] }>("/beta-configs"),
        adminFetch<{ models: ModelInfo[] }>("/model-configs"),
      ]);
      setConfigs(configData.items);
      setModels(modelData.models);
    } catch (err) {
      toast.error("加载配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const updateConfig = async (key: string, value: string) => {
    setSaving(key);
    try {
      await adminFetch(`/beta-configs/${key}`, {
        method: "PATCH",
        body: JSON.stringify({ value }),
      });
      toast.success("配置已更新");
      fetchConfigs();
    } catch (err) {
      toast.error("更新失败");
    } finally {
      setSaving(null);
    }
  };

  const getPhaseConfig = (key: string) => {
    const cfg = configs.find((c) => c.key === key);
    if (!cfg) return { fen: 0, credits: 0 };
    const parsed = cfg.parsed_value as { fen: number; credits: number } | undefined;
    return parsed || { fen: parseInt(cfg.value) || 0, credits: parseInt(cfg.value) / 100 };
  };

  const getModelCosts = (): ModelCostMap => {
    const cfg = configs.find((c) => c.key === "beta_model_costs");
    if (!cfg) return {};
    return (cfg.parsed_value as ModelCostMap) || {};
  };

  const phase1 = getPhaseConfig("beta_phase_1_credits");
  const phase2 = getPhaseConfig("beta_phase_2_credits");
  const phase3 = getPhaseConfig("beta_phase_3_credits");
  const modelCosts = getModelCosts();

  return (
    <AdminShell>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">内测运营配置</h1>
            <p className="text-sm text-text-secondary mt-1">
              配置三阶段额度与模型成本（单位：分，1 积分 = 100 分）
            </p>
          </div>
          <button
            onClick={fetchConfigs}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-surface-card border border-surface-border hover:bg-surface-elevated transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            刷新
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-brand" />
          </div>
        ) : (
          <div className="space-y-8">
            {/* 三阶段额度配置 */}
            <section className="bg-surface-elevated rounded-xl border border-surface-border p-5">
              <div className="flex items-center gap-2 mb-4">
                <Coins className="w-5 h-5 text-brand" />
                <h2 className="text-lg font-medium text-text-primary">三阶段额度配置</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <PhaseConfigCard
                  title="试探期"
                  subtitle="Phase 1"
                  fen={phase1.fen}
                  onSave={(fen) => updateConfig("beta_phase_1_credits", String(fen))}
                  saving={saving === "beta_phase_1_credits"}
                />
                <PhaseConfigCard
                  title="深水区"
                  subtitle="Phase 2"
                  fen={phase2.fen}
                  onSave={(fen) => updateConfig("beta_phase_2_credits", String(fen))}
                  saving={saving === "beta_phase_2_credits"}
                />
                <PhaseConfigCard
                  title="枯竭期"
                  subtitle="Phase 3"
                  fen={phase3.fen}
                  onSave={(fen) => updateConfig("beta_phase_3_credits", String(fen))}
                  saving={saving === "beta_phase_3_credits"}
                />
              </div>
              <div className="mt-4 p-3 bg-amber-500/10 rounded-lg flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-600">
                  修改额度配置仅影响新激活的邀请码，已激活用户的额度不会自动调整。如需调整现有用户额度，请使用用户管理页面的额度调整功能。
                </p>
              </div>
            </section>

            {/* 模型成本配置 */}
            <section className="bg-surface-elevated rounded-xl border border-surface-border p-5">
              <div className="flex items-center gap-2 mb-4">
                <Cpu className="w-5 h-5 text-brand" />
                <h2 className="text-lg font-medium text-text-primary">模型成本配置</h2>
              </div>
              <ModelCostEditor
                costs={modelCosts}
                models={models}
                onSave={(costs) => updateConfig("beta_model_costs", JSON.stringify(costs))}
                saving={saving === "beta_model_costs"}
              />
            </section>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function PhaseConfigCard({
  title,
  subtitle,
  fen,
  onSave,
  saving,
}: {
  title: string;
  subtitle: string;
  fen: number;
  onSave: (fen: number) => void;
  saving: boolean;
}) {
  const [editFen, setEditFen] = useState(String(fen));

  useEffect(() => {
    setEditFen(String(fen));
  }, [fen]);

  const handleSave = () => {
    const val = parseInt(editFen);
    if (isNaN(val) || val < 0) {
      toast.error("请输入有效的整数");
      return;
    }
    onSave(val);
  };

  return (
    <div className="bg-surface-card rounded-lg border border-surface-border p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-medium text-text-primary">{title}</h3>
          <p className="text-xs text-text-tertiary">{subtitle}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-brand">{(fen / 100).toFixed(2)}</div>
          <div className="text-xs text-text-tertiary">积分</div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <div className="flex-1">
          <label className="text-xs text-text-secondary block mb-1">额度（分）</label>
          <input
            type="number"
            value={editFen}
            onChange={(e) => setEditFen(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-elevated border border-surface-border text-sm text-text-primary outline-none focus:border-brand/50"
            min="0"
            step="1"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-5 px-3 py-2 rounded-lg text-sm font-medium text-white bg-brand hover:bg-brand-hover disabled:opacity-50 transition-colors flex items-center gap-1"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          保存
        </button>
      </div>
    </div>
  );
}

function ModelCostEditor({
  costs,
  models,
  onSave,
  saving,
}: {
  costs: ModelCostMap;
  models: ModelInfo[];
  onSave: (costs: ModelCostMap) => void;
  saving: boolean;
}) {
  const [editCosts, setEditCosts] = useState<ModelCostMap>({});
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  useEffect(() => {
    setEditCosts({ ...costs });
  }, [costs]);

  const updateCost = (modelId: string, cost: number) => {
    setEditCosts((prev) => ({ ...prev, [modelId]: cost }));
  };

  const getCategoryLabel = (cat: string) => {
    const map: Record<string, string> = {
      chat: "对话",
      image: "图像",
      video: "视频",
      reasoning: "推理",
      document: "文档",
      search: "搜索",
    };
    return map[cat] || cat;
  };

  const getCategoryIcon = (cat: string) => {
    const map: Record<string, string> = {
      chat: "💬",
      image: "🎨",
      video: "🎬",
      reasoning: "🧠",
      document: "📄",
      search: "🔍",
    };
    return map[cat] || "⚙️";
  };

  const categories = ["all", ...Array.from(new Set(models.map((m) => m.category).filter(Boolean)))];

  const filteredModels = models.filter((m) => {
    const matchSearch =
      !search.trim() ||
      m.id.toLowerCase().includes(search.toLowerCase()) ||
      m.name.toLowerCase().includes(search.toLowerCase());
    const matchCategory = activeCategory === "all" || m.category === activeCategory;
    return matchSearch && matchCategory;
  });

  const hasChanges = JSON.stringify(editCosts) !== JSON.stringify(costs);

  return (
    <div>
      {/* 搜索 + 分类筛选 */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索模型名称或 ID..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-card border border-surface-border text-sm text-text-primary outline-none focus:border-brand/50"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeCategory === cat
                ? "bg-brand text-white"
                : "bg-surface-card border border-surface-border text-text-secondary hover:bg-surface-elevated"
            }`}
          >
            {cat === "all" ? "全部" : `${getCategoryIcon(cat)} ${getCategoryLabel(cat)}`}
          </button>
        ))}
      </div>

      {hasChanges && (
        <div className="mb-4 p-2 bg-amber-500/10 rounded-lg flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-xs text-amber-600">有未保存的修改，请点击下方「保存全部」</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              <th className="text-left py-2 px-3 text-text-secondary font-medium w-8">#</th>
              <th className="text-left py-2 px-3 text-text-secondary font-medium">模型</th>
              <th className="text-left py-2 px-3 text-text-secondary font-medium">分类</th>
              <th className="text-left py-2 px-3 text-text-secondary font-medium">成本（分/次）</th>
              <th className="text-left py-2 px-3 text-text-secondary font-medium">显示（积分）</th>
            </tr>
          </thead>
          <tbody>
            {filteredModels.map((model, idx) => {
              const cost = editCosts[model.id] ?? 0;
              const originalCost = costs[model.id] ?? 0;
              const isModified = cost !== originalCost;
              const isHighCost = cost >= 1000;

              return (
                <tr
                  key={model.id}
                  className={`border-b border-surface-border/50 ${isModified ? "bg-brand/5" : ""}`}
                >
                  <td className="py-2 px-3 text-text-tertiary text-xs">{idx + 1}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: model.color || "#999" }}
                      />
                      <div>
                        <div className="text-sm font-medium text-text-primary">{model.name}</div>
                        <div className="text-xs text-text-tertiary font-mono">{model.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-surface-card border border-surface-border text-text-secondary">
                      <Tag className="w-3 h-3" />
                      {getCategoryLabel(model.category)}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      value={cost}
                      onChange={(e) => updateCost(model.id, parseInt(e.target.value) || 0)}
                      className={`w-24 px-2 py-1 rounded bg-surface-elevated border text-sm text-text-primary outline-none focus:border-brand/50 ${
                        isHighCost ? "border-amber-500/50" : "border-surface-border"
                      }`}
                      min="0"
                    />
                  </td>
                  <td className={`py-2 px-3 text-sm ${isHighCost ? "text-amber-600 font-medium" : "text-text-secondary"}`}>
                    {(cost / 100).toFixed(2)}
                  </td>
                </tr>
              );
            })}
            {filteredModels.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-text-tertiary text-sm">
                  {search || activeCategory !== "all"
                    ? "没有匹配的模型"
                    : "暂无模型数据，请确认模型列表已加载"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-text-tertiary">
          共 {filteredModels.length} 个模型 · 1 积分 = 100 分
          {hasChanges && (
            <span className="ml-2 text-amber-500">· 有未保存的修改</span>
          )}
        </p>
        <button
          onClick={() => onSave(editCosts)}
          disabled={saving || !hasChanges}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand hover:bg-brand-hover disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          保存全部
        </button>
      </div>
    </div>
  );
}
