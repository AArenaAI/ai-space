import type { ChatModel } from "../chatTypes";

export type ModelAvailabilityStatus = "available" | "disabled" | "maintenance" | "quota_exhausted" | "rate_limited" | string;

const STATUS_LABELS: Record<string, string> = {
  disabled: "model.status.disabled",
  maintenance: "model.status.maintenance",
  quota_exhausted: "model.status.quota_exhausted",
  rate_limited: "model.status.rate_limited",
};

export function isModelAvailable(model: ChatModel) {
  if (model.available === false) return false;
  if (model.status && model.status !== "available") return false;
  return true;
}

export function getModelStatusLabel(model: ChatModel) {
  if (isModelAvailable(model)) return "model.status.available";
  if (model.status_message) return model.status_message;
  if (model.status) return STATUS_LABELS[model.status] || "model.status.disabled";
  return "model.status.disabled";
}

export function getModelStatusBadge(model: ChatModel) {
  if (isModelAvailable(model)) return null;
  return getModelStatusLabel(model);
}
