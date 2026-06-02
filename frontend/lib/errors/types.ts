export type UserErrorSeverity = "info" | "warning" | "error";

export type UserErrorAction =
  | "retry"
  | "upload_again"
  | "login"
  | "switch_model"
  | "reduce_file"
  | "adjust_prompt"
  | "wait"
  | "contact_support"
  | "none";

export type UserErrorCategory =
  | "auth"
  | "quota"
  | "rate_limit"
  | "network"
  | "timeout"
  | "validation"
  | "file"
  | "upload"
  | "model"
  | "content_policy"
  | "image_generation"
  | "image_edit"
  | "video_generation"
  | "translation"
  | "chat"
  | "task"
  | "server"
  | "unknown";

export interface UserFacingError {
  code: string;
  category: UserErrorCategory;
  severity: UserErrorSeverity;
  title: string;
  message: string;
  action: UserErrorAction;
  actionLabel?: string;
  debugMessage?: string;
  httpStatus?: number;
  raw?: unknown;
}

export interface ApiErrorPayload {
  code?: string;
  error?: string;
  message?: string;
  debug?: string;
  detail?: string;
  status?: number;
  rawText?: string;
}

export type ErrorModule = "auth" | "chat" | "file" | "image" | "image_edit" | "video" | "translate" | "template" | "ppt" | "workspace" | "server";

export interface NormalizeErrorOptions {
  module?: ErrorModule;
  httpStatus?: number;
  fallbackTitle?: string;
  fallbackMessage?: string;
  fallbackCode?: string;
}
