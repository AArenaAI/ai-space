import type { AdminOverview, AdminUser, AdminUsersResponse } from "./types";

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

export async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const response = await fetch(`/api/admin${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new AdminApiError(await readErrorMessage(response), response.status);
  }
  return response.json() as Promise<T>;
}

export function getAdminMe() {
  return adminFetch<{ user: AdminUser }>("/me");
}

export function getAdminOverview() {
  return adminFetch<AdminOverview>("/overview");
}

export function getAdminUsers(params: { page?: number; pageSize?: number; q?: string } = {}) {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("page_size", String(params.pageSize));
  if (params.q) search.set("q", params.q);
  const query = search.toString();
  return adminFetch<AdminUsersResponse>(`/users${query ? `?${query}` : ""}`);
}

export function updateAdminUser(id: number, patch: Partial<Pick<AdminUser, "role" | "plan_tier" | "basic_credits" | "advanced_credits" | "elite_credits" | "name">>) {
  return adminFetch<{ user: AdminUser }>(`/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
