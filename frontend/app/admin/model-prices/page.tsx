"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, ExternalLink, DollarSign, Coins, ArrowRightLeft } from "lucide-react";
import { adminFetch } from "@/lib/admin/api";
import { toast } from "sonner";

interface ModelPrice {
  provider: string;
  model: string;
  pricing_unit: string;
  source_currency: string;
  source_unit: string;
  source_input_price?: number;
  source_output_price?: number;
  source_input_cache_hit_price?: number;
  source_input_cache_miss_price?: number;
  source_image_input_price?: number;
  source_image_input_cache_hit_price?: number;
  video_pricing_rules?: VideoPricingRule[];
  context_window_tokens?: number;
  pricing_basis: string;
  source_url: string;
}

interface VideoPricingRule {
  resolution: string;
  input_contains_video: boolean;
  source_output_price: number;
  pricing_basis: string;
}

interface ModelCostMap {
  [modelId: string]: number;
}

export default function ModelPricesPage() {
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [costs, setCosts] = useState<ModelCostMap>({});
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [priceData, costData] = await Promise.all([
        adminFetch<{ prices: ModelPrice[] }>("/model-prices"),
        adminFetch<{ items: { key: string; parsed_value?: unknown }[] }>("/api/admin/beta-configs"),
      ]);
      setPrices(priceData.prices);
      // 解析 beta_model_costs
      const costItem = costData.items.find((i) => i.key === "beta_model_costs");
      setCosts((costItem?.parsed_value as ModelCostMap) || {});
    } catch (err) {
      toast.error("加载定价数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getProviderLabel = (p: string) => {
    const map: Record<string, string> = {
      openai: "OpenAI",
      gemini: "Google Gemini",
      deepseek: "DeepSeek",
      moonshot: "Moonshot",
      volcengine: "火山引擎",
      "google-cloud-translate-v3": "Google Cloud",
    };
    return map[p] || p;
  };

  const getUnitLabel = (unit: string) => {
    if (unit === "per_1m_tokens") return "百万 tokens";
    if (unit === "per_1m_characters_source") return "百万字符（源）";
    if (unit === "per_1m_characters_input_output") return "百万字符（输入+输出）";
    return unit;
  };

  // 估算单次对话成本（假设 4k 输入 / 2k 输出）
  const estimateChatCost = (price: ModelPrice) => {
    const inputTokens = 4000;
    const outputTokens = 2000;
    let inputCost = 0;
    let outputCost = 0;

    if (price.source_input_cache_miss_price !== undefined) {
      inputCost = (price.source_input_cache_miss_price * inputTokens) / 1_000_000;
    } else if (price.source_input_price !== undefined) {
      inputCost = (price.source_input_price * inputTokens) / 1_000_000;
    }

    if (price.source_output_price !== undefined) {
      outputCost = (price.source_output_price * outputTokens) / 1_000_000;
    }

    const total = inputCost + outputCost;
    const currency = price.source_currency === "CNY" ? "¥" : "$";
    return { total, currency, inputCost, outputCost };
  };

  // 查找对应的平台积分成本
  const getPlatformCost = (modelId: string) => {
    return costs[modelId] || 0;
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
      <div>
        <h1 className="text-2xl font-bold text-text-primary">模型供应商定价</h1>
        <p className="mt-1 text-sm text-text-secondary">
          来自 config/model-prices.json 的原始供应商成本，与平台积分定价对比
        </p>
      </div>

      <div className="space-y-4">
        {prices.map((price) => {
          const estimate = estimateChatCost(price);
          const platformCostFen = getPlatformCost(price.model);
          const platformCostYuan = platformCostFen / 100;

          return (
            <div
              key={`${price.provider}-${price.model}`}
              className="rounded-xl border border-surface-border bg-surface-card p-5"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-elevated text-lg">
                    {price.source_currency === "CNY" ? "🇨🇳" : "🇺🇸"}
                  </div>
                  <div>
                    <h3 className="font-semibold text-text-primary">{price.model}</h3>
                    <p className="text-xs text-text-secondary">
                      {getProviderLabel(price.provider)} · {getUnitLabel(price.source_unit)}
                    </p>
                  </div>
                </div>
                <a
                  href={price.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-brand hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  来源
                </a>
              </div>

              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* 输入价格 */}
                <div className="rounded-lg bg-surface-elevated p-3">
                  <p className="text-xs text-text-tertiary">输入价格</p>
                  <p className="mt-1 text-sm font-medium text-text-primary">
                    {price.source_input_price !== undefined && (
                      <>
                        {price.source_currency === "CNY" ? "¥" : "$"}
                        {price.source_input_price}
                      </>
                    )}
                    {price.source_input_cache_miss_price !== undefined && (
                      <>
                        {price.source_currency === "CNY" ? "¥" : "$"}
                        {price.source_input_cache_miss_price}
                        <span className="text-xs text-text-tertiary ml-1">(cache miss)</span>
                      </>
                    )}
                    {price.source_input_price === undefined &&
                      price.source_input_cache_miss_price === undefined && (
                        <span className="text-text-tertiary">-</span>
                      )}
                  </p>
                </div>

                {/* 输出价格 */}
                <div className="rounded-lg bg-surface-elevated p-3">
                  <p className="text-xs text-text-tertiary">输出价格</p>
                  <p className="mt-1 text-sm font-medium text-text-primary">
                    {price.source_output_price !== undefined ? (
                      <>
                        {price.source_currency === "CNY" ? "¥" : "$"}
                        {price.source_output_price}
                      </>
                    ) : (
                      <span className="text-text-tertiary">-</span>
                    )}
                  </p>
                </div>

                {/* 估算单次成本 */}
                <div className="rounded-lg bg-surface-elevated p-3">
                  <p className="text-xs text-text-tertiary">估算单次（4k/2k）</p>
                  <p className="mt-1 text-sm font-medium text-text-primary">
                    {estimate.currency}
                    {estimate.total.toFixed(4)}
                  </p>
                </div>

                {/* 平台积分定价 */}
                <div className="rounded-lg bg-brand/5 border border-brand/20 p-3">
                  <p className="text-xs text-brand">平台积分定价</p>
                  <p className="mt-1 text-sm font-medium text-brand">
                    {platformCostYuan > 0 ? (
                      <>
                        <Coins className="inline h-3 w-3 mr-1" />
                        {platformCostYuan.toFixed(2)} 积分
                      </>
                    ) : (
                      <span className="text-text-tertiary">未配置</span>
                    )}
                  </p>
                </div>
              </div>

              {/* 视频定价规则 */}
              {price.video_pricing_rules && price.video_pricing_rules.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs text-text-tertiary mb-2">视频定价规则</p>
                  <div className="flex flex-wrap gap-2">
                    {price.video_pricing_rules.map((rule, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated px-2 py-1 text-xs text-text-secondary"
                      >
                        {rule.resolution}
                        {rule.input_contains_video ? "（含输入视频）" : "（无输入视频）"}
                        <span className="font-medium text-text-primary">
                          ¥{rule.source_output_price}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 定价依据 */}
              <p className="mt-3 text-xs text-text-tertiary">{price.pricing_basis}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
