"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ChatBootstrapPayload } from "@/lib/chatBootstrapCoordinator";

type AppBootstrapContextValue = {
  chatBootstrap?: ChatBootstrapPayload;
  setChatBootstrap: (payload?: ChatBootstrapPayload) => void;
};

const AppBootstrapContext = createContext<AppBootstrapContextValue | undefined>(undefined);

export function AppBootstrapProvider({ children }: { children: ReactNode }) {
  const [chatBootstrap, setChatBootstrapState] = useState<ChatBootstrapPayload | undefined>(undefined);
  const setChatBootstrap = useCallback((payload?: ChatBootstrapPayload) => {
    setChatBootstrapState(payload);
  }, []);
  const value = useMemo(() => ({ chatBootstrap, setChatBootstrap }), [chatBootstrap, setChatBootstrap]);
  return <AppBootstrapContext.Provider value={value}>{children}</AppBootstrapContext.Provider>;
}

export function useAppBootstrap() {
  const context = useContext(AppBootstrapContext);
  if (!context) {
    return { chatBootstrap: undefined, setChatBootstrap: () => {} } satisfies AppBootstrapContextValue;
  }
  return context;
}
