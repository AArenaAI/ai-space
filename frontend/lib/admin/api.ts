import type {
  AdminBillingPlan,
  AdminBillingPlansResponse,
  AdminModelConfigsResponse,
  AdminModelConfig,
  AdminOverview,
  AdminTasksResponse,
  AdminUsageConversationDetail,
  AdminUsageConversationsResponse,
  AdminUsageLogsResponse,
  AdminUsageModelsResponse,
  AdminUsageModulesResponse,
  AdminUsageSummary,
  AdminUsageUserDetail,
  AdminUsageUsersResponse,
  AdminUser,
  AdminUsersResponse,
} from "./types";
import { readAuthState } from "@/lib/auth/state";

export class AdminApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

async function readErrorMessage(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return `请求失败（${response.status}）`;
  try {
    const json = JSON.parse(text);
    return json?.error || json?.message || text;
  } catch {
    return text;
  }
}

const ADMIN_TOKEN_KEY = "admin_token";
const ADMIN_USER_KEY = "admin_user";

export function getStoredAdminToken() {
  if (typeof window === "undefined") return null;
  const authState = readAuthState();
  if (authState.isAdmin && authState.token) return authState.token;
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function storeAdminSession(token: string, user: AdminUser) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
  localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event("admin-auth-changed"));
}

export function clearAdminSession() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_USER_KEY);
  window.dispatchEvent(new Event("admin-auth-changed"));
}

let adminRefreshPromise: Promise<string | null> | null = null;

async function refreshAdminSession(): Promise<string | null> {
  if (!adminRefreshPromise) {
    adminRefreshPromise = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json();
        if (!data?.token || data.user?.role !== "admin") return null;
        storeAdminSession(data.token, data.user);
        return data.token as string;
      })
      .catch(() => null)
      .finally(() => {
        adminRefreshPromise = null;
      });
  }
  return adminRefreshPromise;
}

function buildAdminHeaders(token: string | null, headers?: HeadersInit) {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };
}

export async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 12000);
  try {
    const run = (token: string | null) => fetch(`/api/admin${path}`, {
      ...options,
      credentials: "include",
      signal: options.signal || controller.signal,
      headers: buildAdminHeaders(token, options.headers),
    });

    let response = await run(getStoredAdminToken());
    if (response.status === 401) {
      const refreshedToken = await refreshAdminSession();
      if (refreshedToken) {
        response = await run(refreshedToken);
      } else {
        clearAdminSession();
      }
    }
    if (!response.ok) throw new AdminApiError(await readErrorMessage(response), response.status);
    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AdminApiError("后台接口请求超时，请检查后端服务状态", 408);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

const adminGetCache = new Map<string, { expiresAt: number; value?: unknown; promise?: Promise<unknown> }>();
const ADMIN_USAGE_CACHE_TTL_MS = 2500;

function cachedAdminFetch<T>(path: string, ttlMs = ADMIN_USAGE_CACHE_TTL_MS): Promise<T> {
  const now = Date.now();
  const cached = adminGetCache.get(path);
  if (cached && cached.expiresAt > now) {
    if (cached.value !== undefined) return Promise.resolve(cached.value as T);
    if (cached.promise) return cached.promise as Promise<T>;
  }
  const promise = adminFetch<T>(path).then((value) => {
    adminGetCache.set(path, { expiresAt: Date.now() + ttlMs, value });
    return value;
  }).catch((error) => {
    adminGetCache.delete(path);
    throw error;
  });
  adminGetCache.set(path, { expiresAt: now + ttlMs, promise });
  return promise;
}

function qs(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function getAdminMe() {
  return adminFetch<{ user: AdminUser }>("/me");
}

export function getAdminOverview() {
  return adminFetch<AdminOverview>("/overview");
}

export function getAdminBillingPlans() {
  return adminFetch<AdminBillingPlansResponse>("/billing/plans");
}

export function createAdminBillingPlan(plan: Omit<AdminBillingPlan, "id" | "created_at" | "updated_at">) {
  return adminFetch<{ plan: AdminBillingPlan }>("/billing/plans", { method: "POST", body: JSON.stringify(plan) });
}

export function updateAdminBillingPlan(id: number, plan: Omit<AdminBillingPlan, "id" | "created_at" | "updated_at">) {
  return adminFetch<{ plan: AdminBillingPlan }>(`/billing/plans/${id}`, { method: "PATCH", body: JSON.stringify(plan) });
}

export function getAdminUsers(params: { page?: number; pageSize?: number; q?: string } = {}) {
  return adminFetch<AdminUsersResponse>(`/users${qs({ page: params.page, page_size: params.pageSize, q: params.q })}`);
}

export function updateAdminUser(id: number, patch: Partial<Pick<AdminUser, "role" | "plan_tier" | "basic_credits" | "advanced_credits" | "elite_credits" | "name">>) {
  return adminFetch<{ user: AdminUser }>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function adjustUserCredits(id: number, tier: "basic" | "advanced" | "beta", amount: number, mode: "add" | "set" = "add", reason?: string) {
  return adminFetch<{ user: AdminUser }>(`/users/${id}/credits/adjust`, {
    method: "POST",
    body: JSON.stringify({ tier, amount, mode, reason: reason || "admin_adjust" }),
  });
}

export function getAdminUsageSummary(range = "7d") {
  return cachedAdminFetch<AdminUsageSummary>(`/usage/summary${qs({ range })}`);
}

export interface AdminUsageLogParams {
  page?: number;
  pageSize?: number;
  range?: string;
  startDate?: string;
  endDate?: string;
  module?: string;
  feature?: string;
  operation?: string;
  status?: string;
  provider?: string;
  service?: string;
  model?: string;
  userId?: number;
  guestId?: string;
  conversationId?: number;
  messageId?: number;
  taskId?: number;
  workspaceId?: number;
  notebookId?: number;
  resourceType?: string;
  resourceId?: number;
  requestId?: string;
  estimated?: string;
  minCost?: number;
  maxCost?: number;
  q?: string;
  sort?: string;
  order?: "asc" | "desc";
}

export function getAdminUsageLogs(params: AdminUsageLogParams = {}) {
  return cachedAdminFetch<AdminUsageLogsResponse>(`/usage/logs${qs({
    page: params.page,
    page_size: params.pageSize,
    range: params.range,
    start_date: params.startDate,
    end_date: params.endDate,
    module: params.module,
    feature: params.feature,
    operation: params.operation,
    status: params.status,
    provider: params.provider,
    service: params.service,
    model: params.model,
    user_id: params.userId,
    guest_id: params.guestId,
    conversation_id: params.conversationId,
    message_id: params.messageId,
    task_id: params.taskId,
    workspace_id: params.workspaceId,
    notebook_id: params.notebookId,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    request_id: params.requestId,
    estimated: params.estimated,
    min_cost: params.minCost,
    max_cost: params.maxCost,
    q: params.q,
    sort: params.sort,
    order: params.order,
  })}`);
}

export function getAdminUsageUsers(params: { page?: number; pageSize?: number; range?: string; service?: string; provider?: string; model?: string } = {}) {
  return cachedAdminFetch<AdminUsageUsersResponse>(`/usage/users${qs({ page: params.page, page_size: params.pageSize, range: params.range, service: params.service, provider: params.provider, model: params.model })}`);
}

export function getAdminUsageUserDetail(id: number, params: { range?: string } = {}) {
  return cachedAdminFetch<AdminUsageUserDetail>(`/usage/users/${id}${qs({ range: params.range })}`);
}

export function getAdminUsageModels(params: { range?: string; service?: string; provider?: string; userId?: number; conversationId?: number; limit?: number } = {}) {
  return cachedAdminFetch<AdminUsageModelsResponse>(`/usage/models${qs({ range: params.range, service: params.service, provider: params.provider, user_id: params.userId, conversation_id: params.conversationId, limit: params.limit })}`);
}

export function getAdminUsageModules(params: { range?: string; module?: string; feature?: string; operation?: string; service?: string; provider?: string; model?: string; limit?: number } = {}) {
  return cachedAdminFetch<AdminUsageModulesResponse>(`/usage/modules${qs({ range: params.range, module: params.module, feature: params.feature, operation: params.operation, service: params.service, provider: params.provider, model: params.model, limit: params.limit })}`);
}

export function getAdminUsageConversations(params: { page?: number; pageSize?: number; range?: string; userId?: number; service?: string; provider?: string; model?: string } = {}) {
  return cachedAdminFetch<AdminUsageConversationsResponse>(`/usage/conversations${qs({ page: params.page, page_size: params.pageSize, range: params.range, user_id: params.userId, service: params.service, provider: params.provider, model: params.model })}`);
}

export function getAdminUsageConversationDetail(id: number, params: { range?: string } = {}) {
  return cachedAdminFetch<AdminUsageConversationDetail>(`/usage/conversations/${id}${qs({ range: params.range })}`);
}

export function getAdminModels() {
  return adminFetch<AdminModelConfigsResponse>("/models");
}

export function getAdminModelConfigs() {
  return adminFetch<AdminModelConfigsResponse>("/model-configs");
}

export function updateAdminModelConfig(modelID: string, patch: Partial<Pick<AdminModelConfig, "enabled" | "tier" | "reasoning_level" | "reasoning_fast_value" | "reasoning_thinking_value" | "reasoning_expert_value" | "status" | "status_message">>) {
  return adminFetch<{ config: AdminModelConfig }>(`/model-configs/${encodeURIComponent(modelID)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function batchUpdateAdminModelConfigs(items: Array<Partial<Pick<AdminModelConfig, "model_id" | "enabled" | "tier" | "reasoning_level" | "reasoning_fast_value" | "reasoning_thinking_value" | "reasoning_expert_value" | "status" | "status_message">>>) {
  return adminFetch<{ updated: number }>("/model-configs/batch", { method: "PUT", body: JSON.stringify(items) });
}

export function getAdminTasks(params: { page?: number; pageSize?: number; status?: string; provider?: string; model?: string } = {}) {
  return adminFetch<AdminTasksResponse>(`/tasks${qs({ page: params.page, page_size: params.pageSize, status: params.status, provider: params.provider, model: params.model })}`);
}
