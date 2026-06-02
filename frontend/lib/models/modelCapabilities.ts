import type { ChatModel } from "../chatTypes";

export type ModelCapability =
  | "fast"
  | "cheap"
  | "strong"
  | "reasoning"
  | "long_context"
  | "coding"
  | "chinese"
  | "vision"
  | "search"
  | "file";

export interface ModelCapabilityMeta {
  key: ModelCapability;
  label: string;
  tone: "blue" | "green" | "purple" | "amber" | "cyan" | "slate";
}

export const MODEL_CAPABILITY_META: Record<ModelCapability, ModelCapabilityMeta> = {
  fast: { key: "fast", label: "model.capability.fast", tone: "green" },
  cheap: { key: "cheap", label: "model.capability.cheap", tone: "green" },
  strong: { key: "strong", label: "model.capability.strong", tone: "purple" },
  reasoning: { key: "reasoning", label: "model.capability.reasoning", tone: "purple" },
  long_context: { key: "long_context", label: "model.capability.long_context", tone: "blue" },
  coding: { key: "coding", label: "model.capability.coding", tone: "cyan" },
  chinese: { key: "chinese", label: "model.capability.chinese", tone: "amber" },
  vision: { key: "vision", label: "model.capability.vision", tone: "blue" },
  search: { key: "search", label: "model.capability.search", tone: "cyan" },
  file: { key: "file", label: "model.capability.file", tone: "slate" },
};

function textOf(model: ChatModel) {
  return `${model.id} ${model.name} ${model.provider} ${model.description} ${(model.capabilities || []).join(" ")} ${(model.supported_inputs || []).join(" ")}`.toLowerCase();
}

function hasAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function pushUnique(items: ModelCapability[], capability: ModelCapability) {
  if (!items.includes(capability)) items.push(capability);
}

export function getModelCapabilities(model: ChatModel): ModelCapability[] {
  const text = textOf(model);
  const caps = new Set((model.capabilities || []).map((item) => item.toLowerCase()));
  const inputs = new Set((model.supported_inputs || []).map((item) => item.toLowerCase()));
  const result: ModelCapability[] = [];

  if (
    caps.has("vision") ||
    caps.has("image") ||
    inputs.has("image") ||
    inputs.has("vision") ||
    hasAny(text, ["vision", "image", "图像", "视觉", "gemini", "gpt-5.5"])
  ) {
    pushUnique(result, "vision");
  }

  if (
    caps.has("search") ||
    caps.has("web_search") ||
    inputs.has("search") ||
    hasAny(text, ["search", "联网", "搜索"])
  ) {
    pushUnique(result, "search");
  }

  if (
    caps.has("file") ||
    caps.has("document") ||
    inputs.has("file") ||
    inputs.has("document") ||
    inputs.has("pdf") ||
    inputs.has("word") ||
    inputs.has("excel") ||
    inputs.has("ppt") ||
    inputs.has("csv") ||
    inputs.has("txt") ||
    (model.supported_file_extensions?.length || 0) > 0 ||
    (model.supported_file_mime_types?.length || 0) > 0 ||
    !!model.file_accept
  ) {
    pushUnique(result, "file");
  }

  if (hasAny(text, ["long", "context", "128k", "200k", "1m", "长上下文", "长文档", "claude", "gemini", "gpt-5.5"])) {
    pushUnique(result, "long_context");
  }

  if (caps.has("reasoning") || hasAny(text, ["reason", "reasoner", "thinking", "推理", "思考", "o1", "o3", "pro"])) {
    pushUnique(result, "reasoning");
  }

  if (hasAny(text, ["code", "coder", "coding", "代码", "编程", "deepseek", "claude", "gpt-5.5"])) {
    pushUnique(result, "coding");
  }

  if (hasAny(text, ["deepseek", "moonshot", "qwen", "doubao", "kimi", "中文", "中国", "月之暗面", "豆包"])) {
    pushUnique(result, "chinese");
  }

  if (hasAny(text, ["mini", "flash", "fast", "turbo", "快速", "speed", "seedance"])) {
    pushUnique(result, "fast");
  }

  if (hasAny(text, ["mini", "flash", "cheap", "低成本", "economy", "lite"])) {
    pushUnique(result, "cheap");
  }

  if (hasAny(text, ["pro", "opus", "sonnet", "gpt-5.5", "最强", "旗舰", "advanced"])) {
    pushUnique(result, "strong");
  }

  return result.slice(0, 6);
}

export function getPrimaryModelCapabilities(model: ChatModel, limit = 4): ModelCapabilityMeta[] {
  return getModelCapabilities(model).slice(0, limit).map((key) => MODEL_CAPABILITY_META[key]);
}

export function getModelCapabilitySummary(model: ChatModel) {
  const capabilities = getModelCapabilities(model);
  if (capabilities.includes("vision")) return "model.summary.vision";
  if (capabilities.includes("reasoning")) return "model.summary.reasoning";
  if (capabilities.includes("long_context")) return "model.summary.long_context";
  if (capabilities.includes("coding")) return "model.summary.coding";
  if (capabilities.includes("fast")) return "model.summary.fast";
  if (capabilities.includes("cheap")) return "model.summary.cheap";
  return "model.summary.default";
}

export function supportsModelCapability(model: ChatModel, capability: ModelCapability) {
  return getModelCapabilities(model).includes(capability);
}
