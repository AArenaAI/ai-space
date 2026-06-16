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

interface ModelCostMap {
  [modelId: string]: number;
}

// 模型分类定义（与前端模型选择器一致）
const MODEL_CATEGORIES: { key: string; label: string; icon: string; models: string[] }[] = [
  {
    key: "basic",
    label: "基础模型",
    icon: "📝",
    models: [
      "gpt-5.4-mini",
      "gemini-2.0-flash-exp",
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash",
    ],
  },
  {
    key: "advanced",
    label: "高级模型",
    icon: "⚡",
    models: [
      "gpt-5.4",
      "gpt-5.5",
      "deepseek-v4-flash",
      "kimi-k2.5",
      "kimi-k2.6",
      "claude-3-5-sonnet-20241022",
    ],
  },
  {
    key: "elite",
    label: "精英模型",
    icon: "👑",
    models: [
      "deepseek-v4-pro",
      "gpt-5.5-pro",
      "chat-1",
    ],
  },
  {
    key: "image",
    label: "图像生成",
    icon: "🎨",
    models: [
      "gpt-image-2",
      "gemini-2.5-pro",
      "gemini-3.1-pro-preview",
    ],
  },
  {
    key: "video",
    label: "视频生成",
    icon: "🎬",
    models: [
      "doubao-seedance-2-0-fast-260128",
      "doubao-seedance-2-0-260128",
    ],
  },
];

// 模型显示名称映射
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "gpt-5.4-mini": "GPT 5.4 Mini",
  "gemini-2.0-flash-exp": "Gemini 2.0 Flash",
  "gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "gpt-5.4": "GPT 5.4",
  "gpt-5.5": "GPT 5.5",
  "deepseek-v4-flash": "DeepSeek-V4 Flash",
  "kimi-k2.5": "Kimi K2.5",
  "kimi-k2.6": "Kimi K2.6",
  "claude-3-5-sonnet-20241022": "Claude 3.5 Sonnet",
  "deepseek-v4-pro": "DeepSeek-V4 Pro",
  "gpt-5.5-pro": "GPT 5.5 Pro",
  "chat-1": "Chat 1",
  "gpt-image-2": "GPT Image 2",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  "doubao-seedance-2-0-fast-260128": "Seedance 2.0 Fast",
  "doubao-seedance-2-0-260128": "Seedance 2.0",
};

// 获取模型分类
function getModelCategory(modelId: string): string {
  for (const cat of MODEL_CATEGORIES) {
    if (cat.models.includes(modelId)) return cat.key;
  }
  return "other";
}

// 获取分类标签
function getCategoryLabel(modelId: string): string {
  const cat = MODEL_CATEGORIES.find((c) => c.models.includes(modelId));
  return cat ? cat.label : "其他";
}

// 获取分类图标
function getCategoryIcon(modelId: string): string {
  const cat = MODEL_CATEGORIES.find((c) => c.models.includes(modelId));
  return cat ? cat.icon : "❓";
}

export default function BetaConfigPage() {
  const [configs, setConfigs] = useState<BetaConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminFetch<{ items: BetaConfigItem[] }>("/beta-configs");
      setConfigs(data.items);
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
      <div className="p-6 max-w-5xl mx-auto">
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
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-brand" />
                  <h2 className="text-lg font-medium text-text-primary">模型成本配置</h2>
                </div>
                <div className="text-xs text-text-tertiary">
                  共 {Object.keys(modelCosts).length} 个模型 · 1 积分 = 100 分
                </div>
              </div>

              <ModelCostEditor
                costs={modelCosts}
                onSave={(costs) => updateConfig("beta_model_costs", JSON.stringify(costs))}
                saving={saving === "beta_model_costs"}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                activeCategory={activeCategory}
                onCategoryChange={setActiveCategory}
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
  onSave,
  saving,
  searchQuery,
  onSearchChange,
  activeCategory,
  onCategoryChange,
}: {
  costs: ModelCostMap;
  onSave: (costs: ModelCostMap) => void;
  saving: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeCategory: string | null;
  onCategoryChange: (cat: string | null) => void;
}) {
  const [editCosts, setEditCosts] = useState<ModelCostMap>({});
  const [newModel, setNewModel] = useState("");
  const [newCost, setNewCost] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setEditCosts({ ...costs });
    setHasChanges(false);
  }, [costs]);

  const updateCost = (modelId: string, cost: number) => {
    setEditCosts((prev) => {
      const next = { ...prev, [modelId]: cost };
      setHasChanges(true);
      return next;
    });
  };

  const removeModel = (modelId: string) => {
    setEditCosts((prev) => {
      const next = { ...prev };
      delete next[modelId];
      setHasChanges(true);
      return next;
    });
  };

  const addModel = () => {
    if (!newModel.trim() || !newCost.trim()) return;
    const cost = parseInt(newCost);
    if (isNaN(cost) || cost < 0) {
      toast.error("请输入有效的成本");
      return;
    }
    updateCost(newModel.trim(), cost);
    setNewModel("");
    setNewCost("");
  };

  const handleSave = () => {
    onSave(editCosts);
    setHasChanges(false);
  };

  // 按分类过滤和排序
  const getFilteredModels = () => {
    let entries = Object.entries(editCosts);

    // 搜索过滤
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      entries = entries.filter(([modelId, _]) => {
        const name = MODEL_DISPLAY_NAMES[modelId] || modelId;
        return modelId.toLowerCase().includes(q) || name.toLowerCase().includes(q);
      });
    }

    // 分类过滤
    if (activeCategory) {
      const catModels = MODEL_CATEGORIES.find((c) => c.key === activeCategory)?.models || [];
      entries = entries.filter(([modelId, _]) => catModels.includes(modelId));
    }

    // 按分类排序，然后按名称排序
    return entries.sort(([a], [b]) => {
      const catA = getModelCategory(a);
      const catB = getModelCategory(b);
      if (catA !== catB) {
        const orderA = MODEL_CATEGORIES.findIndex((c) => c.key === catA);
        const orderB = MODEL_CATEGORIES.findIndex((c) => c.key === catB);
        return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
      }
      return a.localeCompare(b);
    });
  };

  const filteredModels = getFilteredModels();

  // 统计各分类模型数量
  const categoryCounts = MODEL_CATEGORIES.map((cat) => ({
    ...cat,
    count: cat.models.filter((m) => editCosts[m] !== undefined).length,
  }));

  return (
    <div>
      {/* 分类筛选 + 搜索 */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => onCategoryChange(null)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              activeCategory === null
                ? "bg-brand text-white"
                : "bg-surface-card border border-surface-border text-text-secondary hover:text-text-primary"
            }`}
          >
            全部
          </button>
          {categoryCounts.map((cat) => (
            <button
              key={cat.key}
              onClick={() => onCategoryChange(cat.key === activeCategory ? null : cat.key)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                activeCategory === cat.key
                  ? "bg-brand text-white"
                  : "bg-surface-card border border-surface-border text-text-secondary hover:text-text-primary"
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
              <span className={`text-[10px] px-1 rounded ${activeCategory === cat.key ? "bg-white/20" : "bg-surface-elevated"}`}>
                {cat.count}
              </span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索模型..."
            className="pl-8 pr-3 py-1.5 rounded-lg bg-surface-card border border-surface-border text-sm text-text-primary outline-none focus:border-brand/50 w-48"
          />
        </div>
      </div>

      {/* 模型成本表格 - 按分类分组 */}
      <div className="overflow-x-auto rounded-lg border border-surface-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-card border-b border-surface-border">
              <th className="text-left py-2.5 px-3 text-text-secondary font-medium w-8">#</th>
              <th className="text-left py-2.5 px-3 text-text-secondary font-medium">模型</th>
              <th className="text-left py-2.5 px-3 text-text-secondary font-medium">分类</th>
              <th className="text-left py-2.5 px-3 text-text-secondary font-medium">成本（分/次）</th>
              <th className="text-left py-2.5 px-3 text-text-secondary font-medium">显示（积分）</th>
              <th className="text-right py-2.5 px-3 text-text-secondary font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredModels.map(([modelId, cost], index) => {
              const displayName = MODEL_DISPLAY_NAMES[modelId] || modelId;
              const category = getCategoryLabel(modelId);
              const icon = getCategoryIcon(modelId);
              const isModified = cost !== (costs[modelId] || 0);

              return (
                <tr
                  key={modelId}
                  className={`border-b border-surface-border/50 ${isModified ? "bg-brand/5" : ""}`}
                >
                  <td className="py-2.5 px-3 text-text-tertiary text-xs">{index + 1}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex flex-col">
                      <span className="text-text-primary font-medium text-sm">{displayName}</span>
                      <span className="text-text-tertiary text-xs font-mono">{modelId}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-surface-card border border-surface-border">
                      <span>{icon}</span>
                      <span className="text-text-secondary">{category}</span>
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <input
                      type="number"
                      value={cost}
                      onChange={(e) => updateCost(modelId, parseInt(e.target.value) || 0)}
                      className="w-24 px-2 py-1 rounded bg-surface-elevated border border-surface-border text-sm text-text-primary outline-none focus:border-brand/50"
                      min="0"
                    />
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`text-sm font-mono ${cost >= 1000 ? "text-orange-500 font-semibold" : "text-text-secondary"}`}>
                      {(cost / 100).toFixed(2)}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => removeModel(modelId)}
                      className="text-xs text-red-500 hover:text-red-600 transition-colors px-2 py-1 rounded hover:bg-red-500/10"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
            {filteredModels.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-text-tertiary text-sm">
                  {searchQuery || activeCategory ? "未找到匹配的模型" : "暂无模型成本配置"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 添加新模型 */}
      <div className="flex items-end gap-2 mt-4 p-3 bg-surface-card rounded-lg border border-surface-border">
        <div className="flex-1">
          <label className="text-xs text-text-secondary block mb-1">模型 ID</label>
          <input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder="例如：gpt-5.4-mini"
            className="w-full px-3 py-2 rounded-lg bg-surface-elevated border border-surface-border text-sm text-text-primary outline-none focus:border-brand/50"
          />
        </div>
        <div className="w-32">
          <label className="text-xs text-text-secondary block mb-1">成本（分）</label>
          <input
            type="number"
            value={newCost}
            onChange={(e) => setNewCost(e.target.value)}
            placeholder="100"
            className="w-full px-3 py-2 rounded-lg bg-surface-elevated border border-surface-border text-sm text-text-primary outline-none focus:border-brand/50"
            min="0"
          />
        </div>
        <button
          onClick={addModel}
          className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-surface-border hover:bg-surface-elevated transition-colors"
        >
          添加
        </button>
      </div>

      {/* 保存按钮 */}
      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-2">
          {hasChanges && (
            <span className="text-xs text-amber-500 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              有未保存的修改
            </span>
          )}
        </div>
        <button
          onClick={handleSave}
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
