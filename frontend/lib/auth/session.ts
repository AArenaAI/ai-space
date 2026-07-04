export interface AuthSessionUser {
  id: number;
  email: string;
  name?: string;
  role?: string;
  basic_credits?: number;
  advanced_credits?: number;
  elite_credits?: number;
  plan_tier?: string;
  beta_phase?: string;
  beta_batch?: string;
  default_workspace_id?: number;
}

export interface AuthSessionSnapshot {
  token?: string;
  user: AuthSessionUser;
}

async function parseAuthSessionResponse(res: Response, errorPrefix: string): Promise<AuthSessionSnapshot | null> {
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`${errorPrefix}:${res.status}`);

  const data = await res.json();
  if (!data?.user) return null;
  return { token: data.token, user: data.user };
}

export async function fetchAuthSession(): Promise<AuthSessionSnapshot | null> {
  const res = await fetch("/api/auth/session", {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  return parseAuthSessionResponse(res, "auth_session_failed");
}

export async function refreshAuthSession(): Promise<AuthSessionSnapshot | null> {
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  return parseAuthSessionResponse(res, "auth_refresh_failed");
}

export function storeAuthUserSnapshot(snapshot: AuthSessionSnapshot | AuthSessionUser) {
  const user = "user" in snapshot ? snapshot.user : snapshot;
  if ("token" in snapshot && snapshot.token) {
    localStorage.setItem("token", snapshot.token);
  }
  localStorage.setItem("user", JSON.stringify(user));
  if (user.default_workspace_id) {
    localStorage.setItem("current-workspace", String(user.default_workspace_id));
  }
  window.dispatchEvent(new Event("auth-changed"));
}

export function clearAuthSnapshot() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.dispatchEvent(new Event("auth-changed"));
}
