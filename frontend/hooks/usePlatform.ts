"use client";

import { useState, useEffect } from "react";

export interface PlatformInfo {
  isMac: boolean;
  isWin: boolean;
  isLinux: boolean;
  mod: string;
  alt: string;
}

export function usePlatform(): PlatformInfo {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    const platform = navigator.platform || "";
    const ua = navigator.userAgent || "";
    const mac =
      platform.toLowerCase().includes("mac") ||
      ua.toLowerCase().includes("macintosh") ||
      ua.toLowerCase().includes("mac os");
    setIsMac(mac);
  }, []);

  return {
    isMac,
    isWin: !isMac && (navigator.platform || "").toLowerCase().includes("win"),
    isLinux:
      !isMac && (navigator.platform || "").toLowerCase().includes("linux"),
    mod: isMac ? "⌘" : "Ctrl",
    alt: isMac ? "⌥" : "Alt",
  };
}
