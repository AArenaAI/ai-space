"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  AUTH_CHANGED_EVENT,
  AUTH_READY_EVENT,
  ensureAuthSession,
  logoutBrowserSession,
  readAuthState,
  type AuthStateSnapshot,
} from "@/lib/auth/state";

interface AuthContextValue extends AuthStateSnapshot {
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthStateSnapshot>(() => readAuthState());

  const sync = useCallback(() => {
    setSnapshot(readAuthState());
  }, []);

  const refreshSession = useCallback(async () => {
    await ensureAuthSession({ force: true });
    sync();
  }, [sync]);

  const logout = useCallback(async () => {
    await logoutBrowserSession();
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
