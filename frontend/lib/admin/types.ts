export type AdminRole = "user" | "admin";

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: AdminRole;
  plan_tier: string;
  basic_credits: number;
  advanced_credits: number;
  elite_credits: number;
  created_at: string;
  updated_at: string;
}

export interface AdminOverview {
  users: { total: number; today_new: number };
  usage: { today_requests: number; today_cost_rmb: number; today_failures: number };
  tasks: { running: number; failed_today: number };
  models: { top_by_cost: Array<{ model: string; provider: string; cost_rmb: number; requests: number }> };
}

export interface AdminUsersResponse {
  users: AdminUser[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminUsageLog {
  id: number;
  user_id: number;
  guest_id: string;
  service: string;
  module?: string;
  feature?: string;
  operation?: string;
  provider: string;
  model: string;
  model_type: string;
  resource_type: string;
  resource_id: number;
  conversation_id: number;
  message_id: number;
  task_id: number;
  workspace_id: number;
  notebook_id: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_cost_rmb: number;
  status: string;
  image_count: number;
  character_count?: number;
  video_seconds?: number;
  audio_seconds?: number;
  estimated: boolean;
  pricing_unit?: string;
  unit_count?: number;
  input_unit_price_rmb?: number;
  output_unit_price_rmb?: number;
  image_unit_price_rmb?: number;
  source_currency?: string;
  source_unit?: string;
  source_input_price?: number;
  source_input_cache_hit_price?: number;
  source_input_cache_miss_price?: number;
  source_output_price?: number;
  source_image_price?: number;
  source_request_price?: number;
  exchange_rate_to_rmb?: number;
  request_id?: string;
  error_message?: string;
  created_at: string;
}

export interface AdminUsageMetric {
  requests: number;
  failures?: number;
  cost_rmb: number;
  total_tokens?: number;
  tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  image_count?: number;
  character_count?: number;
  video_seconds?: number;
  audio_seconds?: number;
}

export interface AdminUsageSummary extends AdminUsageMetric {
  successes: number;
  range_start: string;
  daily: Array<{ date: string; requests: number; failures: number; cost_rmb: number }>;
  top_models: Array<{ model: string; provider: string; cost_rmb: number; requests: number; tokens: number }>;
  provider_breakdown: Array<{ name: string; requests: number; cost_rmb: number; failures: number }>;
  service_breakdown: Array<{ name: string; requests: number; cost_rmb: number; failures: number }>;
}

export interface AdminUsageLogsResponse {
  logs: AdminUsageLog[];
  total: number;
  page: number;
  page_size: number;
  summary?: AdminUsageMetric;
}

export interface AdminUsageServiceRow extends AdminUsageMetric {
  name: string;
  tokens: number;
  image_count: number;
}

export interface AdminUsageModelRow extends AdminUsageMetric {
  service: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  image_count: number;
}

export interface AdminUsageUserRow extends AdminUsageMetric {
  user_id: number;
  email: string;
  name: string;
  total_tokens: number;
  image_count: number;
  last_used_at: string;
  services: AdminUsageServiceRow[];
}

export interface AdminUsageUsersResponse {
  users: AdminUsageUserRow[];
  page: number;
  page_size: number;
}

export interface AdminUsageConversationRow extends AdminUsageMetric {
  conversation_id: number;
  title: string;
  user_id: number;
  email: string;
  total_tokens: number;
  last_used_at: string;
  models: AdminUsageModelRow[];
}

export interface AdminUsageConversationsResponse {
  conversations: AdminUsageConversationRow[];
  page: number;
  page_size: number;
}

export interface AdminUsageModelsResponse {
  models: AdminUsageModelRow[];
}

export interface AdminUsageUserDetail {
  user: AdminUser;
  summary: AdminUsageMetric;
  services: AdminUsageServiceRow[];
  models: AdminUsageModelRow[];
  conversations: AdminUsageConversationRow[];
}

export interface AdminUsageConversationDetail {
  conversation: { id: number; title: string; user_id: number; guest_id?: string; model?: string; created_at: string; updated_at: string };
  summary: AdminUsageMetric;
  models: AdminUsageModelRow[];
  logs: AdminUsageLog[];
}

export interface AdminModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  color: string;
  category: string;
  tier: string;
  modalities: string[];
  capabilities: string[];
}

export interface AdminModelsResponse {
  models: AdminModel[];
  total: number;
}

export interface AdminTask {
  id: number;
  response_id: string;
  user_id: number;
  guest_id: string;
  conversation_id: number;
  assistant_message_id: number;
  model: string;
  provider: string;
  status: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface AdminTasksResponse {
  tasks: AdminTask[];
  total: number;
  page: number;
  page_size: number;
  summary: Array<{ status: string; count: number }>;
}
