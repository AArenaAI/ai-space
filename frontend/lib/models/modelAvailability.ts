import type { ChatModel } from "../chatTypes";

export type ModelAvailabilityStatus = "available" | "disabled" | "maintenance" | "quota_exhausted" | "rate_limited" | string;

const STATUS_LABELS: Record<string, string> = {
  disabled: "暂不可用",
  maintenance: "维护中",
  quota_exhausted: "额度不足",
  rate_limited: "请求较多",
};

export function isModelAvailable(model: ChatModel) {
  if (model.available === false) return false;
  if (model.status && model.status !== "available") return false;
  return true;
}

export function getModelStatusLabel(model: ChatModel) {
  if (isModelAvailable(model)) return "可用";
  if (model.status_message) return model.status_message;
  if (model.status) return STATUS_LABELS[model.status] || "暂不可用";
  return "暂不可用";
}

export function getModelStatusBadge(model: ChatModel) {
  if (isModelAvailable(model)) return null;
  return getModelStatusLabel(model);
}
