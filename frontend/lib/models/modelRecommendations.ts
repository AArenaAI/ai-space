import type { ChatModel } from "../chatTypes";
import type { ModelCapability } from "./modelCapabilities";
import { supportsModelCapability } from "./modelCapabilities";
import { isModelAvailable } from "./modelAvailability";

export interface ModelRecommendationContext {
  searchEnabled?: boolean;
  hasImageAttachment?: boolean;
  hasDocumentAttachment?: boolean;
  inputText?: string;
}

export interface ModelRecommendation {
  capability: ModelCapability;
  title: string;
  message: string;
  reason: string;
}

const CODE_PATTERN = /\b(error|exception|traceback|stack trace|typescript|javascript|python|golang|go\s+test|sql|react|next\.js|bug|报错|异常|代码|函数|接口|数据库)\b/i;
const LONG_TEXT_THRESHOLD = 1200;

function hasLongText(text?: string) {
  return !!text && text.trim().length >= LONG_TEXT_THRESHOLD;
}

export function getModelRecommendation(context?: ModelRecommendationContext): ModelRecommendation | null {
  if (!context) return null;

  if (context.hasImageAttachment) {
    return {
      capability: "vision",
      title: "当前包含图片",
      message: "建议选择支持图像理解的模型。",
      reason: "图片附件需要视觉能力，避免模型无法读取图片内容。",
    };
  }

  if (context.hasDocumentAttachment) {
    return {
      capability: "file",
      title: "当前包含文件",
      message: "建议选择适合文件或长上下文的模型。",
      reason: "文件问答更依赖文档理解、长上下文和稳定检索能力。",
    };
  }

  if (context.searchEnabled) {
    return {
      capability: "search",
      title: "当前开启联网搜索",
      message: "建议选择支持搜索的模型。",
      reason: "联网搜索需要模型支持搜索上下文，避免请求失败或结果不稳定。",
    };
  }

  if (CODE_PATTERN.test(context.inputText || "")) {
    return {
      capability: "coding",
      title: "检测到代码任务",
      message: "建议选择代码或推理能力更强的模型。",
      reason: "代码、报错和调试问题通常需要更强的推理与代码理解能力。",
    };
  }

  if (hasLongText(context.inputText)) {
    return {
      capability: "long_context",
      title: "当前输入较长",
      message: "建议选择长上下文模型。",
      reason: "长文本更适合上下文容量更大的模型，能降低遗漏信息的概率。",
    };
  }

  return null;
}

export function isModelRecommended(model: ChatModel, recommendation: ModelRecommendation | null) {
  if (!recommendation) return false;
  if (recommendation.capability === "file") {
    return supportsModelCapability(model, "file") || supportsModelCapability(model, "long_context");
  }
  if (recommendation.capability === "coding") {
    return supportsModelCapability(model, "coding") || supportsModelCapability(model, "reasoning");
  }
  return supportsModelCapability(model, recommendation.capability);
}

export function getRecommendedModels(models: ChatModel[], recommendation: ModelRecommendation | null, limit = 2) {
  if (!recommendation) return [];
  return models.filter((model) => isModelAvailable(model) && isModelRecommended(model, recommendation)).slice(0, limit);
}
