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
      title: "model.recommend.vision.title",
      message: "model.recommend.vision.message",
      reason: "model.recommend.vision.reason",
    };
  }

  if (context.hasDocumentAttachment) {
    return {
      capability: "file",
      title: "model.recommend.file.title",
      message: "model.recommend.file.message",
      reason: "model.recommend.file.reason",
    };
  }

  // 联网搜索不是模型硬能力限制：支持 native search 的模型走 provider tool，
  // 其它模型会由后端注入 Tavily/Brave 第三方搜索上下文。因此开启搜索
  // 不应再触发“必须切换到支持搜索模型”的推荐或过滤。

  if (CODE_PATTERN.test(context.inputText || "")) {
    return {
      capability: "coding",
      title: "model.recommend.coding.title",
      message: "model.recommend.coding.message",
      reason: "model.recommend.coding.reason",
    };
  }

  if (hasLongText(context.inputText)) {
    return {
      capability: "long_context",
      title: "model.recommend.long_context.title",
      message: "model.recommend.long_context.message",
      reason: "model.recommend.long_context.reason",
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
