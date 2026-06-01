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
  users: {
    total: number;
    today_new: number;
  };
  usage: {
    today_requests: number;
    today_cost_rmb: number;
    today_failures: number;
  };
  tasks: {
    running: number;
    failed_today: number;
  };
  models: {
    top_by_cost: Array<{
      model: string;
      provider: string;
      cost_rmb: number;
      requests: number;
    }>;
  };
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
  provider: string;
  model: string;
  model_type: string;
  resource_type: string;
  resource_id: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_cost_rmb: number;
  status: string;
  image_count: number;
  estimated: boolean;
  error_message?: string;
  created_at: string;
}

export interface AdminUsageSummary {
  requests: number;
  failures: number;
  successes: number;
  cost_rmb: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  image_count: number;
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
