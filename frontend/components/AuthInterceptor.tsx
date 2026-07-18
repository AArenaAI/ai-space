"use client";

import { useEffect } from "react";
import { getGuestId } from "@/lib/guestId";
import { normalizeError } from "@/lib/errors";
import { clearBrowserAuthState, ensureAuthSession, refreshBrowserSession } from "@/lib/auth/state";
import { toast } from "sonner";

const AUTH_REFRESH_PATH = "/api/auth/refresh";
const AUTH_SESSION_PATH = "/api/auth/session";
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
  return path === AUTH_REFRESH_PATH || path === AUTH_SESSION_PATH || path === AUTH_LOGIN_PATH || path === AUTH_REGISTER_PATH || path === AUTH_LOGOUT_PATH;
}

function isAdminApiPath(path: string) {
  return path === "/api/admin" || path.startsWith("/api/admin/");
}

function isAdminPagePath(path: string) {
  return path === "/admin" || path.startsWith("/admin/");
}

export default function AuthInterceptor() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    getGuestId();

    const originalFetch = window.fetch;
    const sessionProbePromise = ensureAuthSession();
    let redirecting = false;
    let lastToastKey = "";
    let lastToastAt = 0;
    const refreshFailureLock = { locked: false, lockedAt: 0 };
    const REFRESH_FAILURE_LOCK_MS = 3000;

    const shouldToastOnce = (key: string) => {
      const now = Date.now();
      if (lastToastKey === key && now - lastToastAt < 2500) return false;
      lastToastKey = key;
      lastToastAt = now;
      return true;
    };

    const acquireRefreshFailureLock = () => {
      const now = Date.now();
      if (refreshFailureLock.locked && now - refreshFailureLock.lockedAt < REFRESH_FAILURE_LOCK_MS) return false;
      refreshFailureLock.locked = true;
      refreshFailureLock.lockedAt = now;
      return true;
    };

    const redirectToLogin = () => {
      if (redirecting || window.location.pathname.startsWith("/login") || window.location.pathname.startsWith("/register") || isAdminPagePath(window.location.pathname)) return;
      if (!acquireRefreshFailureLock()) return;
      redirecting = true;
      clearBrowserAuthState();
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?returnUrl=${returnUrl}`;
      setTimeout(() => { redirecting = false; }, 3000);
    };

    const redirectToAdminLogin = () => {
      if (redirecting || window.location.pathname.replace(/\/+$/, "") === "/admin/login") return;
      if (!acquireRefreshFailureLock()) return;
      redirecting = true;
      clearBrowserAuthState();
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/admin/login?returnUrl=${returnUrl}`;
      setTimeout(() => { redirecting = false; }, 3000);
    };

    const retryWithSession = (input: RequestInfo | URL, init: RequestInit | undefined) => {
      const retryHeaders = new Headers(input instanceof Request ? input.headers : init?.headers);
      retryHeaders.delete("Authorization");
      const retryInit: RequestInit = {
        ...(init || {}),
        headers: retryHeaders,
        credentials: (init && init.credentials) || "include",
      };
      return retryInit;
    };

    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const requestForOriginal = input instanceof Request ? input.clone() : input;
      const requestForRetry = input instanceof Request ? input.clone() : input;
      const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
      const isApi = isApiUrl(url);
      if (!isApi) return originalFetch(input, init);

      const path = toPath(url);
      const isAdminApi = isAdminApiPath(path);
      const isAuthLifecycle = isAuthLifecyclePath(path);
      const shouldAttemptRefresh = isApi && !isAuthLifecycle;

      if (!isAuthLifecycle) await sessionProbePromise;

      let nextInit: RequestInit | undefined = init ? { ...init } : undefined;
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
      if (!isAuthLifecycle) headers.delete("Authorization");
      if (!isAdminApi) {
        const guestId = getGuestId();
        if (guestId) headers.set("X-Guest-ID", guestId);
      }
      nextInit = { ...nextInit, headers, credentials: nextInit?.credentials || "include" };

      let res = await originalFetch(requestForOriginal, nextInit);

      if (res.status === 401 && shouldAttemptRefresh) {
        const session = await refreshBrowserSession({ preserveOnMissing: true }).catch(() => null);
        if (session?.user) {
          if (isAdminApi) {
            if (session.user?.role === "admin") {
              res = await originalFetch(requestForRetry, retryWithSession(input, init));
            } else {
              redirectToAdminLogin();
            }
          } else {
            res = await originalFetch(requestForRetry, retryWithSession(input, init));
          }
        } else if (isAdminApi) {
          redirectToAdminLogin();
        } else {
          redirectToLogin();
        }
      }

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
          // ignore non-JSON responses
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
