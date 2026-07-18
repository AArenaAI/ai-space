import { clearGuestId, getGuestId } from "@/lib/guestId";
import { clearAuthSnapshot, fetchAuthSession, refreshAuthSession, storeAuthUserSnapshot, type AuthSessionSnapshot, type AuthSessionUser } from "./session";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthStateSnapshot {
  status: AuthStatus;
  token: string | null;
  user: AuthSessionUser | null;
  isAdmin: boolean;
}

export const AUTH_CHANGED_EVENT = "auth-changed";
export const AUTH_STATE_CHANGED_EVENT = "auth-state-changed";
export const AUTH_READY_EVENT = "auth-ready";

let sessionProbePromise: Promise<AuthSessionSnapshot | null> | null = null;
let sessionRefreshPromise: Promise<AuthSessionSnapshot | null> | null = null;
let sessionProbeFinished = false;
let currentSession: AuthSessionSnapshot | null = null;

function safeParseUser(raw: string | null): AuthSessionUser | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSessionUser;
  } catch {
    return null;
  }
}

function hasLocalAuthSnapshot() {
  return Boolean(
    localStorage.getItem("user") ||
      localStorage.getItem("admin_user")
  );
}

export function readAuthState(): AuthStateSnapshot {
  if (typeof window === "undefined") {
    return { status: "loading", token: null, user: null, isAdmin: false };
  }
  const localUser = safeParseUser(localStorage.getItem("user"));
  const user = currentSession?.user || localUser;
  return {
    status: sessionProbeFinished ? (user ? "authenticated" : "anonymous") : "loading",
    token: null,
    user,
    isAdmin: user?.role === "admin",
  };
}

function dispatchAuthEvents() {
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  window.dispatchEvent(new Event(AUTH_STATE_CHANGED_EVENT));
}

export function storeAdminAuthSnapshot(token: string | null | undefined, user: AuthSessionUser | null | undefined) {
  if (user?.role !== "admin") return;
  localStorage.removeItem("admin_token");
  localStorage.setItem("admin_user", JSON.stringify(user));
  window.dispatchEvent(new Event("admin-auth-changed"));
}

export function clearAdminAuthSnapshot() {
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin_user");
  window.dispatchEvent(new Event("admin-auth-changed"));
}

export function applyAuthSession(session: AuthSessionSnapshot) {
  currentSession = session;
  storeAuthUserSnapshot(session);
  storeAdminAuthSnapshot(null, session.user);
  clearGuestId();
  sessionProbePromise = Promise.resolve(session);
  sessionProbeFinished = true;
  window.dispatchEvent(new Event(AUTH_READY_EVENT));
  dispatchAuthEvents();
}

export function clearBrowserAuthState() {
  currentSession = null;
  clearAuthSnapshot();
  clearAdminAuthSnapshot();
  getGuestId();
  dispatchAuthEvents();
}

export function markAuthReady() {
  sessionProbeFinished = true;
  window.dispatchEvent(new Event(AUTH_READY_EVENT));
  dispatchAuthEvents();
}

export function resetAuthProbeForTests() {
  sessionProbePromise = null;
  sessionRefreshPromise = null;
  sessionProbeFinished = false;
  currentSession = null;
}

export function ensureAuthSession(options: { force?: boolean; preserveOnMissing?: boolean } = {}): Promise<AuthSessionSnapshot | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!options.force && sessionProbePromise) return sessionProbePromise;

  sessionProbePromise = fetchAuthSession()
    .then((session) => {
      if (session) {
        applyAuthSession(session);
        return session;
      }
      if (!options.preserveOnMissing && hasLocalAuthSnapshot()) {
        clearBrowserAuthState();
      } else {
        getGuestId();
      }
      return null;
    })
    .catch(() => {
      // Network/proxy failure should not destroy a possibly valid local snapshot.
      return null;
    })
    .finally(() => {
      markAuthReady();
    });

  return sessionProbePromise;
}

export function refreshBrowserSession(options: { preserveOnMissing?: boolean } = {}): Promise<AuthSessionSnapshot | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!sessionRefreshPromise) {
    sessionRefreshPromise = refreshAuthSession()
      .then(async (session) => {
        if (session) {
          applyAuthSession(session);
          return session;
        }
        // Rotation races can make /refresh fail while /session is still valid.
        const restored = await ensureAuthSession({ force: true, preserveOnMissing: true }).catch(() => null);
        if (restored?.user) return restored;
        if (!options.preserveOnMissing) clearBrowserAuthState();
        return null;
      })
      .catch(async () => {
        const restored = await ensureAuthSession({ force: true, preserveOnMissing: true }).catch(() => null);
        return restored?.user ? restored : null;
      })
      .finally(() => {
        sessionRefreshPromise = null;
        markAuthReady();
      });
  }
  return sessionRefreshPromise;
}

export async function logoutBrowserSession() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
  clearBrowserAuthState();
  sessionProbePromise = Promise.resolve(null);
  sessionRefreshPromise = null;
  sessionProbeFinished = true;
}
