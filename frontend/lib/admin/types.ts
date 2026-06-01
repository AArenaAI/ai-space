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
