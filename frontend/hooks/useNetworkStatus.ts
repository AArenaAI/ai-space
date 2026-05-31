"use client";

import { useEffect, useState } from "react";

export type NetworkStatus = "online" | "offline" | "restored";

export function useNetworkStatus(restoreNoticeMs = 3000) {
  const [status, setStatus] = useState<NetworkStatus>(() => {
    if (typeof navigator === "undefined") return "online";
    return navigator.onLine ? "online" : "offline";
  });

  useEffect(() => {
    let restoreTimer: number | undefined;

    const handleOffline = () => {
      if (restoreTimer) window.clearTimeout(restoreTimer);
      setStatus("offline");
    };

    const handleOnline = () => {
      setStatus((previous) => (previous === "offline" ? "restored" : "online"));
      if (restoreTimer) window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => setStatus("online"), restoreNoticeMs);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    if (!navigator.onLine) setStatus("offline");

    return () => {
      if (restoreTimer) window.clearTimeout(restoreTimer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [restoreNoticeMs]);

  return {
    status,
    isOffline: status === "offline",
    justRestored: status === "restored",
  };
}
