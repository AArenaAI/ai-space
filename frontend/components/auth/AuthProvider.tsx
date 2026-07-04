"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AUTH_CHANGED_EVENT,
  AUTH_READY_EVENT,
  ensureAuthSession,
  logoutBrowserSession,
  readAuthState,
  refreshBrowserSession,
  type AuthStateSnapshot,
} from "@/lib/auth/state";

interface AuthContextValue extends AuthStateSnapshot {
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000;
const SESSION_FOCUS_REFRESH_MIN_GAP_MS = 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthStateSnapshot>(() => readAuthState());
  const lastKeepAliveAtRef = useRef(0);

  const sync = useCallback(() => {
    setSnapshot(readAuthState());
  }, []);

  const refreshSession = useCallback(async () => {
    await refreshBrowserSession({ preserveOnMissing: true });
    sync();
  }, [sync]);

  const logout = useCallback(async () => {
    await logoutBrowserSession();
    sync();
  }, [sync]);

  const keepSessionAlive = useCallback(async (reason: "interval" | "focus" | "visible") => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const state = readAuthState();
    if (!state.user && !state.token) return;
    const now = Date.now();
    if (reason !== "interval" && now - lastKeepAliveAtRef.current < SESSION_FOCUS_REFRESH_MIN_GAP_MS) return;
    lastKeepAliveAtRef.current = now;
    await refreshBrowserSession({ preserveOnMissing: true }).catch(() => null);
    sync();
  }, [sync]);

  useEffect(() => {
    sync();
    ensureAuthSession().finally(sync);
    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    window.addEventListener(AUTH_READY_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, sync);
      window.removeEventListener(AUTH_READY_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, [sync]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void keepSessionAlive("interval");
    }, SESSION_KEEPALIVE_INTERVAL_MS);

    const handleFocus = () => {
      void keepSessionAlive("focus");
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void keepSessionAlive("visible");
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [keepSessionAlive]);

  const value = useMemo<AuthContextValue>(() => ({
    ...snapshot,
    refreshSession,
    logout,
  }), [snapshot, refreshSession, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
