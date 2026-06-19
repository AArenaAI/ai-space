"use client";

import { useState, useCallback, useEffect } from "react";
import { getErrorMessage, readApiError } from "@/lib/errors";

const API_BASE_URL = "";

export interface CreditsData {
  basic_credits: number;
  advanced_credits: number;
  elite_credits: number;
  basic_credits_display?: number;
  advanced_credits_display?: number;
  elite_credits_display?: number;
  plan_tier: string;
  credits_reset_at: string;
  daily_quota: Record<string, number>;
  tier_names: Record<string, string>;
  beta_batch?: string;
  beta_phase?: string;
  beta_phase_name?: string;
  beta_credit_balance?: number;
  beta_credit_balance_display?: number;
  beta_credit_granted_total?: number;
  beta_credit_granted_display?: number;
  beta_credit_used_total?: number;
  beta_credit_used_display?: number;
  next_phase?: {
    phase: string;
    phase_name: string;
    unlock_condition: string;
    credits: number;
  };
}

export interface DeductResult {
  success: boolean;
  tier: string;
  tier_name: string;
  deducted: number;
  basic_credits: number;
  advanced_credits: number;
  elite_credits: number;
  beta_credit_balance?: number;
  beta_credit_balance_display?: number;
  beta_credit_granted_total?: number;
  beta_credit_used_total?: number;
  remaining: number;
}

interface BetaPublicConfig {
  model_costs_fen?: Record<string, number>;
  model_costs?: Record<string, number>;
  batch_model_rules?: Record<string, { blocked_models?: string[]; message?: string }>;
}

// 模型等级映射（与后端保持一致）
export const MODEL_TIER_MAP: Record<string, string> = {
  "gpt-5.4-mini": "basic",
  "gemini-2.0-flash-exp": "basic",
  "gemini-3.5-flash": "basic",

  "gpt-5.4": "advanced",
  "gpt-5.5": "advanced",
  "claude-3-5-sonnet-20241022": "advanced",
  "deepseek-v4-flash": "advanced",
  "kimi-k2.5": "advanced",
  "kimi-k2.6": "advanced",

  "gpt-5.5-pro": "elite",
  "deepseek-v4-pro": "elite",
  "chat-1": "elite", // Chat 1: 22 Credits/次，昂贵模型
};

// 昂贵模型列表（需要二次确认）
export const EXPENSIVE_MODELS = new Set(["chat-1", "gpt-5.5-pro"]);

export function isExpensiveModel(modelId: string): boolean {
  return EXPENSIVE_MODELS.has(modelId);
}

export function getModelTier(modelId: string): string {
  return MODEL_TIER_MAP[modelId] || "basic";
}

export function getTierName(tier: string): string {
  const names: Record<string, string> = {
    basic: "基础",
    advanced: "高级",
    elite: "精英",
  };
  return names[tier] || "基础";
}

export function getTierIcon(tier: string): string {
  switch (tier) {
    case "basic":
      return "☕";
    case "advanced":
      return "🔥";
    case "elite":
      return "⭐";
    default:
      return "☕";
  }
}

export function getTierColor(tier: string): string {
  switch (tier) {
    case "basic":
      return "#fbbf24"; // amber-400
    case "advanced":
      return "#fb923c"; // orange-400
    case "elite":
      return "#c084fc"; // purple-400
    default:
      return "#fbbf24";
  }
}

export function useCredits() {
  const [credits, setCredits] = useState<CreditsData | null>(null);
  const [modelCostsFen, setModelCostsFen] = useState<Record<string, number>>({});
  const [batchModelRules, setBatchModelRules] = useState<Record<string, { blocked_models?: string[]; message?: string }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const fetchCredits = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/user/credits`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw await readApiError(res);
      const data = await res.json();
      setCredits(data);
    } catch (err) {
      setError(getErrorMessage(err, { module: "auth", fallbackMessage: "获取积分失败，请刷新重试。" }));
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchBetaConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/beta/config`);
      if (!res.ok) return;
      const data = (await res.json()) as BetaPublicConfig;
      if (data.batch_model_rules) {
        setBatchModelRules(data.batch_model_rules);
      }
      if (data.model_costs_fen) {
        setModelCostsFen(data.model_costs_fen);
        return;
      }
      if (data.model_costs) {
        const fen: Record<string, number> = {};
        for (const [modelId, creditsCost] of Object.entries(data.model_costs)) {
          fen[modelId] = Math.round(Number(creditsCost) * 100);
        }
        setModelCostsFen(fen);
      }
    } catch {
      // 成本配置不可用时走后端最终校验，避免阻塞正常使用。
    }
  }, []);

  const deductCredits = useCallback(
    async (modelId: string, amount?: number): Promise<DeductResult | null> => {
      if (!token) return null;
      try {
        const res = await fetch(`${API_BASE_URL}/api/user/credits/deduct`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(amount && amount > 0 ? { model_id: modelId, amount } : { model_id: modelId }),
        });
        if (!res.ok) {
          throw await readApiError(res);
        }
        const data = await res.json();
        setCredits((prev) =>
          prev
            ? {
                ...prev,
                basic_credits: data.basic_credits,
                advanced_credits: data.advanced_credits,
                elite_credits: data.elite_credits,
                beta_credit_balance: data.beta_credit_balance ?? prev.beta_credit_balance,
                beta_credit_balance_display: data.beta_credit_balance_display ?? prev.beta_credit_balance_display,
                beta_credit_granted_total: data.beta_credit_granted_total ?? prev.beta_credit_granted_total,
                beta_credit_used_total: data.beta_credit_used_total ?? prev.beta_credit_used_total,
              }
            : null
        );
        return data;
      } catch (err) {
        setError(getErrorMessage(err, { module: "auth", fallbackMessage: "积分不足，请升级套餐或稍后重试。" }));
        return null;
      }
    },
    [token]
  );

  const getModelCostFen = useCallback((modelId: string): number => {
    return modelCostsFen[modelId] ?? 100;
  }, [modelCostsFen]);

  const isBetaModelAllowed = useCallback((modelId: string): boolean => {
    const batch = credits?.beta_batch;
    if (!credits?.beta_phase || credits.beta_phase === "completed" || !batch) return true;
    return !(batchModelRules[batch]?.blocked_models || []).includes(modelId);
  }, [credits, batchModelRules]);

  const getBetaModelBlockedMessage = useCallback((modelId: string): string | null => {
    const batch = credits?.beta_batch;
    if (!credits?.beta_phase || credits.beta_phase === "completed" || !batch) return null;
    const rule = batchModelRules[batch];
    if ((rule?.blocked_models || []).includes(modelId)) {
      return rule?.message || "当前内测批次暂未开放该模型";
    }
    return null;
  }, [credits, batchModelRules]);

  // 检查积分是否足够：内测使用独立 beta wallet；会员使用 basic/advanced/elite。
  const hasEnoughCredits = useCallback(
    (modelId: string): boolean => {
      if (!credits) return true;
      if (!isBetaModelAllowed(modelId)) return false;
      const requiredFen = getModelCostFen(modelId);
      if (credits.beta_phase && credits.beta_phase !== "completed") {
        return (credits.beta_credit_balance ?? 0) >= requiredFen;
      }
      const tier = getModelTier(modelId);
      const quota = credits.daily_quota?.[tier] ?? 0;
      if (quota < 0) return true;
      switch (tier) {
        case "basic":
          return credits.basic_credits >= requiredFen;
        case "advanced":
          return credits.advanced_credits >= requiredFen;
        case "elite":
          return credits.elite_credits >= requiredFen;
        default:
          return true;
      }
    },
    [credits, getModelCostFen, isBetaModelAllowed]
  );

  // 获取显示值（积分，非分）
  const getCreditsDisplay = useCallback((tier: string): number => {
    if (!credits) return 0;
    if (tier === "beta") {
      return credits.beta_credit_balance_display ?? (credits.beta_credit_balance ?? 0) / 100;
    }
    switch (tier) {
      case "basic":
        return credits.basic_credits_display ?? credits.basic_credits / 100;
      case "advanced":
        return credits.advanced_credits_display ?? credits.advanced_credits / 100;
      case "elite":
        return credits.elite_credits_display ?? credits.elite_credits / 100;
      default:
        return 0;
    }
  }, [credits]);

  useEffect(() => {
    fetchBetaConfig();
    if (token) {
      fetchCredits();
    }
  }, [token, fetchCredits, fetchBetaConfig]);

  // 检查是否处于内测阶段额度耗尽状态
  const isCreditExhausted = useCallback((): boolean => {
    if (!credits) return false;
    if (credits.beta_phase && credits.beta_phase !== "completed") {
      return (credits.beta_credit_balance ?? 0) <= 0;
    }
    return (
      credits.basic_credits <= 0 &&
      credits.advanced_credits <= 0 &&
      credits.elite_credits <= 0
    );
  }, [credits]);

  const getBetaPhaseInfo = useCallback(() => {
    if (!credits?.beta_phase) return null;
    const phaseNames: Record<string, string> = {
      phase_1: "试探期",
      phase_2: "深水区",
      phase_3: "枯竭期",
      completed: "已完成",
    };
    return {
      batch: credits.beta_batch,
      phase: credits.beta_phase,
      phase_name: credits.beta_phase_name || phaseNames[credits.beta_phase] || credits.beta_phase,
      balance: credits.beta_credit_balance ?? 0,
      balance_display: credits.beta_credit_balance_display ?? (credits.beta_credit_balance ?? 0) / 100,
      granted_total: credits.beta_credit_granted_total ?? 0,
      used_total: credits.beta_credit_used_total ?? 0,
      next_phase: credits.next_phase,
    };
  }, [credits]);

  return {
    credits,
    loading,
    error,
    fetchCredits,
    deductCredits,
    hasEnoughCredits,
    getModelCostFen,
    isBetaModelAllowed,
    getBetaModelBlockedMessage,
    getTierCredits: getCreditsDisplay,
    getCreditsDisplay,
    isCreditExhausted,
    getBetaPhaseInfo,
  };
}
