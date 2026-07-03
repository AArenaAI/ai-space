"use client";

import { useEffect } from "react";
import { getGuestId } from "@/lib/guestId";
import { normalizeError } from "@/lib/errors";
import { applyAuthSession, clearBrowserAuthState, ensureAuthSession, readAuthState, storeAdminAuthSnapshot } from "@/lib/auth/state";
import { toast } from "sonner";

const AUTH_REFRESH_PATH = "/api/auth/refresh";
const AUTH_LOGIN_PATH = "/api/auth/login";
const AUTH_REGISTER_PATH = "/api/auth/register";
const AUTH_LOGOUT_PATH = "/api/auth/logout";

function isApiUrl(url: string) {
  if (typeof window === "undefined") return false;
  return url.startsWith("/api/") || url.startsWith(window.location.origin + "/api/");
}

function toPath(url: string) {
  if (typeof window === "undefined") return url;
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url;
  }
}

function isAuthLifecyclePath(path: string) {
  return path === AUTH_REFRESH_PATH || path === AUTH_LOGIN_PATH || path === AUTH_REGISTER_PATH || path === AUTH_LOGOUT_PATH;
}

function isAdminApiPath(path: string) {
  return path === "/api/admin" || path.startsWith("/api/admin/");
}

function isAdminPagePath(path: string) {
  return path === "/admin" || path.startsWith("/admin/");
}


export default function AuthInterceptor() {
  useEffect(() => {
    // 只在客户端执行
    if (typeof window === "undefined") return;

    // 初始化 guest ID：即使存在 token 也保留匿名兜底，避免脏/过期 token 导致 guest_id_required。
    getGuestId();

    const originalFetch = window.fetch;
    const sessionProbePromise = ensureAuthSession();
    let refreshPromise: Promise<string | null> | null = null;
    let redirecting = false;
    let lastToastKey = "";
    let lastToastAt = 0;
    const shouldToastOnce = (key: string) => {
      const now = Date.now();
      if (lastToastKey === key && now - lastToastAt < 2500) return false;
      lastToastKey = key;
      lastToastAt = now;
      return true;
    };

    const refreshAccessToken = async (): Promise<string | null> => {
      if (!refreshPromise) {
        refreshPromise = originalFetch(AUTH_REFRESH_PATH, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        })
          .then(async (res) => {
            if (!res.ok) return null;
            const data = await res.json();
            if (!data?.token) return null;
            if (data.user) {
              applyAuthSession({ token: data.token, user: data.user });
            }
            return data.token as string;
          })
          .catch(() => null)
          .finally(() => {
            refreshPromise = null;
          });
      }
      return refreshPromise;
    };

    const redirectToLogin = () => {
      if (redirecting || window.location.pathname.startsWith("/login") || window.location.pathname.startsWith("/register") || isAdminPagePath(window.location.pathname)) return;
      redirecting = true;
      clearBrowserAuthState();
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?returnUrl=${returnUrl}`;
    };

    const redirectToAdminLogin = () => {
      if (redirecting || window.location.pathname.replace(/\/+$/, "") === "/admin/login") return;
      redirecting = true;
      clearBrowserAuthState();
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/admin/login?returnUrl=${returnUrl}`;
    };

    const restoreSessionAfterRefreshFailure = async () => {
      // Refresh token rotation or request races can occasionally make /refresh fail while
      // the HttpOnly session cookie is still valid. Do one authoritative session probe
      // before redirecting so a transient refresh 401 does not kick the user to login.
      const session = await ensureAuthSession({ force: true }).catch(() => null);
      return session?.token ? session : null;
    };

    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const requestForOriginal = input instanceof Request ? input.clone() : input;
      const requestForRetry = input instanceof Request ? input.clone() : input;
      const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
      const isApi = isApiUrl(url);
      if (!isApi) {
        return originalFetch(input, init);
      }
      const path = toPath(url);
      const isAdminApi = isAdminApiPath(path);
      const isAuthLifecycle = isAuthLifecyclePath(path);
      const shouldAttemptRefresh = isApi && !isAdminApi && !isAuthLifecycle;

      // 首屏业务请求必须等 session 探测完成，避免旧/过期 localStorage token 抢跑 401 后跳登录。
      if (!isAuthLifecycle) {
        await sessionProbePromise;
      }

      let nextInit: RequestInit | undefined = init ? { ...init } : undefined;

      // 给本域 API 请求自动添加 Authorization / X-Guest-ID；后台 API 使用独立 admin_token，不混用普通业务 token。
      if (isApi) {
        const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
        const hasAuth = headers.has("Authorization");
        if (!hasAuth && !isAuthLifecycle) {
          const authState = readAuthState();
          const token = isAdminApi ? (authState.isAdmin ? authState.token : localStorage.getItem("admin_token")) : authState.token;
          if (token && token !== "null" && token !== "undefined") {
            headers.set("Authorization", `Bearer ${token}`);
          }
        }
        if (!isAdminApi) {
          // 始终携带 guest ID 作为匿名兜底；有效 Authorization 仍由后端优先识别为登录用户。
          const guestId = getGuestId();
          if (guestId) headers.set("X-Guest-ID", guestId);
        }
        nextInit = { ...nextInit, headers, credentials: nextInit?.credentials || "include" };
      }

      let res = await originalFetch(requestForOriginal, nextInit);

      if (res.ok && (path === AUTH_LOGIN_PATH || path === AUTH_REGISTER_PATH || path === AUTH_REFRESH_PATH)) {
        try {
          const data = await res.clone().json();
          if (data?.token && data?.user) {
            applyAuthSession({ token: data.token, user: data.user });
          }
        } catch {
          // 非 JSON 认证响应忽略
        }
      }

      // Access token 过期时：用 HttpOnly refresh cookie 静默续期并重试；后台接口也走这里，兼容未使用 adminFetch 的旧页面。
      if (res.status === 401 && isAdminApi) {
        const newToken = await refreshAccessToken();
        if (newToken) {
          const adminUserRaw = localStorage.getItem("user");
          const adminUser = adminUserRaw ? JSON.parse(adminUserRaw) : null;
          if (adminUser?.role === "admin") {
            storeAdminAuthSnapshot(newToken, adminUser);
            const retryHeaders = new Headers(input instanceof Request ? input.headers : init?.headers);
            retryHeaders.set("Authorization", `Bearer ${newToken}`);
            const retryInit: RequestInit = {
              ...(init || {}),
              headers: retryHeaders,
              credentials: (init && init.credentials) || "include",
            };
            res = await originalFetch(requestForRetry, retryInit);
          } else {
            redirectToAdminLogin();
          }
        } else {
          const restored = await restoreSessionAfterRefreshFailure();
          if (restored?.user?.role === "admin") {
            storeAdminAuthSnapshot(restored.token, restored.user);
            const retryHeaders = new Headers(input instanceof Request ? input.headers : init?.headers);
            retryHeaders.set("Authorization", `Bearer ${restored.token}`);
            const retryInit: RequestInit = {
              ...(init || {}),
              headers: retryHeaders,
              credentials: (init && init.credentials) || "include",
            };
            res = await originalFetch(requestForRetry, retryInit);
          } else {
            redirectToAdminLogin();
          }
        }
      } else if (res.status === 401 && shouldAttemptRefresh) {
        const newToken = await refreshAccessToken();
        if (newToken) {
          const retryHeaders = new Headers(input instanceof Request ? input.headers : init?.headers);
          retryHeaders.set("Authorization", `Bearer ${newToken}`);
          const retryInit: RequestInit = {
            ...(init || {}),
            headers: retryHeaders,
            credentials: (init && init.credentials) || "include",
          };
          res = await originalFetch(requestForRetry, retryInit);
        } else {
          const restored = await restoreSessionAfterRefreshFailure();
          if (restored?.token) {
            const retryHeaders = new Headers(input instanceof Request ? input.headers : init?.headers);
            retryHeaders.set("Authorization", `Bearer ${restored.token}`);
            const retryInit: RequestInit = {
              ...(init || {}),
              headers: retryHeaders,
              credentials: (init && init.credentials) || "include",
            };
            res = await originalFetch(requestForRetry, retryInit);
          } else {
            redirectToLogin();
          }
        }
      }

      // 只全局处理跨模块通用错误，业务错误交给具体页面，避免重复 toast。
      if (isApi && [400, 401, 403, 409, 429].includes(res.status)) {
        try {
          const clone = res.clone();
          const data = await clone.json();
          if (data && typeof data === "object") {
            const code = String((data as any).error || (data as any).code || "");
            const handledGlobalCodes = new Set(["guest_id_required", "guest_limit_exceeded", "file_not_ready", "login_required"]);
            if (handledGlobalCodes.has(code) && shouldToastOnce(`${code}:${res.status}`)) {
              const userError = normalizeError(data, { httpStatus: res.status });
              if (userError.severity === "info") toast.info(userError.message, { description: userError.title, duration: 4200 });
              else if (userError.severity === "warning") toast.warning(userError.message, { description: userError.title, duration: 4200 });
              else toast.error(userError.message, { description: userError.title, duration: 4200 });
            }
          }
        } catch {
          // 非 JSON 响应，忽略
        }
      }

      return res;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
