"use client";

import { useEffect } from "react";
import { getGuestId, clearGuestId } from "@/lib/guestId";
import { normalizeError } from "@/lib/errors";
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

function clearAuthState() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.dispatchEvent(new Event("auth-changed"));
}

export default function AuthInterceptor() {
  useEffect(() => {
    // 只在客户端执行
    if (typeof window === "undefined") return;

    // 初始化 guest ID（如果已登录则清除）
    const initialToken = localStorage.getItem("token");
    if (initialToken) {
      clearGuestId();
    } else {
      getGuestId(); // 保证存在
    }

    const originalFetch = window.fetch;
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
            localStorage.setItem("token", data.token);
            if (data.user) {
              localStorage.setItem("user", JSON.stringify(data.user));
              if (data.user.default_workspace_id) {
                localStorage.setItem("current-workspace", String(data.user.default_workspace_id));
              }
            }
            clearGuestId();
            window.dispatchEvent(new Event("auth-changed"));
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
      if (redirecting || window.location.pathname.startsWith("/login") || window.location.pathname.startsWith("/register")) return;
      redirecting = true;
      clearAuthState();
      getGuestId();
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?returnUrl=${returnUrl}`;
    };

    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const requestForOriginal = input instanceof Request ? input.clone() : input;
      const requestForRetry = input instanceof Request ? input.clone() : input;
      const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
      const isApi = isApiUrl(url);
      const path = toPath(url);
      const shouldAttemptRefresh = isApi && !isAuthLifecyclePath(path);

      let nextInit: RequestInit | undefined = init ? { ...init } : undefined;

      // 给本域 API 请求自动添加 Authorization / X-Guest-ID。
      if (isApi) {
        const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
        const hasAuth = headers.has("Authorization");
        const token = localStorage.getItem("token");
        if (!hasAuth && token && token !== "null" && token !== "undefined") {
          headers.set("Authorization", `Bearer ${token}`);
        }
        // 只有在未携带 Authorization 时才发送 guest ID（避免已登录用户被误识别为匿名）
        if (!headers.has("Authorization")) {
          const guestId = getGuestId();
          if (guestId) headers.set("X-Guest-ID", guestId);
        }
        nextInit = { ...nextInit, headers, credentials: nextInit?.credentials || "include" };
      }

      let res = await originalFetch(requestForOriginal, nextInit);

      // Access token 过期时：用 HttpOnly refresh cookie 静默续期，成功后重放一次原请求。
      if (res.status === 401 && shouldAttemptRefresh) {
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
          redirectToLogin();
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
