"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark" | "green";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getNextTheme(current: Theme): Theme {
  const order: Theme[] = ["light", "dark", "green"];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length];
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("theme");
    // 兼容旧存储值 "day"/"night"
    if (saved === "day" || saved === "light") setTheme("light");
    else if (saved === "night" || saved === "dark") setTheme("dark");
    else if (saved === "green") setTheme("green");
    // 如果没有存储值，自动检测系统偏好
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;
    // 移除所有主题类
    root.classList.remove("light", "dark", "green");
    // 添加当前主题类
    root.classList.add(theme);

    localStorage.setItem("theme", theme);
  }, [theme, mounted]);

  const toggleTheme = () => {
    setTheme((prev) => getNextTheme(prev));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  return context;
}
