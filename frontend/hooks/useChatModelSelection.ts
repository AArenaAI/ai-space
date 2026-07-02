import { useCallback, useEffect, useState } from "react";
import type { ChatModel } from "@/lib/chatTypes";

export const SELECTED_MODEL_STORAGE_KEY = "selected-model";
export const RECENT_MODELS_STORAGE_KEY = "recent-models";

export function loadSavedChatModel(models: ChatModel[], storageKey = SELECTED_MODEL_STORAGE_KEY, defaultModelId?: string): ChatModel {
  if (typeof window === "undefined") return models[0];
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const model = models.find((candidate) => candidate.id === saved);
      if (model) return model;
    }
  } catch {}
  if (defaultModelId) {
    const model = models.find((candidate) => candidate.id === defaultModelId);
    if (model) return model;
  }
  return models[0];
}

export function persistSelectedChatModel(model: ChatModel, storageKey = SELECTED_MODEL_STORAGE_KEY) {
  try {
    localStorage.setItem(storageKey, model.id);
  } catch {}
}

export function buildRecentModelIds(previous: string[], selectedModelId: string, limit = 3): string[] {
  const recent = previous.filter((id) => id !== selectedModelId);
  recent.unshift(selectedModelId);
  return recent.slice(0, limit);
}

export function persistRecentChatModels(model: ChatModel, limit = 3) {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_MODELS_STORAGE_KEY) || "[]");
    const previous = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    localStorage.setItem(RECENT_MODELS_STORAGE_KEY, JSON.stringify(buildRecentModelIds(previous, model.id, limit)));
  } catch {}
}

export function persistChatModelSelection(model: ChatModel, storageKey = SELECTED_MODEL_STORAGE_KEY) {
  persistSelectedChatModel(model, storageKey);
  persistRecentChatModels(model);
}

export function preserveSelectedChatModel(current: ChatModel | undefined, models: ChatModel[], storageKey?: string, defaultModelId?: string): ChatModel {
  if (current?.id && models.some((model) => model.id === current.id)) {
    return current;
  }
  return loadSavedChatModel(models, storageKey, defaultModelId);
}

export function useChatModelSelection(models: ChatModel[], options?: { storageKey?: string; defaultModelId?: string }) {
  const configuredDefault = options?.defaultModelId ? models.find((model) => model.id === options.defaultModelId) : undefined;
  const defaultModel = configuredDefault || (models.length > 0 ? models[0] : ({} as ChatModel));
  const [selectedModel, setSelectedModelState] = useState<ChatModel>(defaultModel);
  const [initialized, setInitialized] = useState(false);
  const modelIdsKey = models.map((model) => model.id).join("|");

  useEffect(() => {
    setSelectedModelState((current) => preserveSelectedChatModel(current, models, options?.storageKey, options?.defaultModelId));
    setInitialized(true);
  }, [modelIdsKey, options?.storageKey, options?.defaultModelId]);

  const setSelectedModel = useCallback((model: ChatModel) => {
    setSelectedModelState(model);
    persistChatModelSelection(model, options?.storageKey);
  }, [options?.storageKey]);

  return {
    selectedModel,
    setSelectedModel,
    initialized,
  };
}
