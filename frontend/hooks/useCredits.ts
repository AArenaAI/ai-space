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
  beta_phase?: string;
  beta_phase_name?: string;
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
  remaining: number;
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
  "moonshot-v1-8k": "advanced",

  "gpt-5.5-pro": "elite",
  "deepseek-v4-pro": "elite",
  "chat-1": "elite", // Chat 1: 22元/次，昂贵模型
};

// 昂贵模型列表（需要二次确认）
export const EXPENSIVE_MODELS = new Set(["chat-1"]);

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

  const deductCredits = useCallback(
    async (modelId: string, amount: number = 1): Promise<DeductResult | null> => {
      if (!token) return null;
      try {
        const res = await fetch(`${API_BASE_URL}/api/user/credits/deduct`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ model_id: modelId, amount }),
        });
        if (!res.ok) {
          // 402 Payment Required = 积分不足
          throw await readApiError(res);
        }
        const data = await res.json();
        // 更新本地积分状态
        setCredits((prev) =>
          prev
            ? {
                ...prev,
                basic_credits: data.basic_credits,
                advanced_credits: data.advanced_credits,
                elite_credits: data.elite_credits,
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

  // 检查积分是否足够（已恢复）
  const hasEnoughCredits = useCallback(
    (modelId: string): boolean => {
      if (!credits) return true;
      const tier = getModelTier(modelId);
      const quota = credits.daily_quota?.[tier] ?? 0;
      if (quota < 0) return true;
      switch (tier) {
        case "basic":
          return credits.basic_credits > 0;
        case "advanced":
          return credits.advanced_credits > 0;
        case "elite":
          return credits.elite_credits > 0;
        default:
          return true;
      }
    },
    [credits]
  );

  // 获取显示值（积分，非分）
  const getCreditsDisplay = useCallback((tier: string): number => {
    if (!credits) return 0;
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

  // 登录后自动加载
  useEffect(() => {
    if (token) {
      fetchCredits();
    }
  }, [token, fetchCredits]);

  // 检查是否处于内测阶段额度耗尽状态
  const isCreditExhausted = useCallback((): boolean => {
    if (!credits) return false;
    return (
      credits.basic_credits <= 0 &&
      credits.advanced_credits <= 0 &&
      credits.elite_credits <= 0
    );
  }, [credits]);

  // 获取当前内测阶段信息
  const getBetaPhaseInfo = useCallback(() => {
    if (!credits?.beta_phase) return null;
    const phaseNames: Record<string, string> = {
      phase_1: "试探期",
      phase_2: "深水区",
      phase_3: "枯竭期",
      completed: "已完成",
    };
    return {
      phase: credits.beta_phase,
      phase_name: credits.beta_phase_name || phaseNames[credits.beta_phase] || credits.beta_phase,
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
    getTierCredits: getCreditsDisplay,
    getCreditsDisplay,
    isCreditExhausted,
    getBetaPhaseInfo,
  };
}
