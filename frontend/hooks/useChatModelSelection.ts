import { useCallback, useEffect, useState } from "react";
import type { ChatModel } from "@/lib/chatTypes";

export const SELECTED_MODEL_STORAGE_KEY = "selected-model";
export const RECENT_MODELS_STORAGE_KEY = "recent-models";

export function loadSavedChatModel(models: ChatModel[]): ChatModel {
  if (typeof window === "undefined") return models[0];
  try {
    const saved = localStorage.getItem(SELECTED_MODEL_STORAGE_KEY);
    if (saved) {
      const model = models.find((candidate) => candidate.id === saved);
      if (model) return model;
    }
  } catch {}
  return models[0];
}

export function persistSelectedChatModel(model: ChatModel) {
  try {
    localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, model.id);
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

export function persistChatModelSelection(model: ChatModel) {
  persistSelectedChatModel(model);
  persistRecentChatModels(model);
}

export function useChatModelSelection(models: ChatModel[]) {
  const defaultModel = models.length > 0 ? models[0] : ({} as ChatModel);
  const [selectedModel, setSelectedModelState] = useState<ChatModel>(defaultModel);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const saved = loadSavedChatModel(models);
    setSelectedModelState(saved);
    setInitialized(true);
  }, []);

  const setSelectedModel = useCallback((model: ChatModel) => {
    setSelectedModelState(model);
    persistChatModelSelection(model);
  }, []);

  return {
    selectedModel,
    setSelectedModel,
    initialized,
  };
}
