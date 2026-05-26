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

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";

  const root = document.documentElement;
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("green")) return "green";

  const saved = localStorage.getItem("theme");
  if (saved === "day" || saved === "light") return "light";
  if (saved === "night" || saved === "dark") return "dark";
  if (saved === "green") return "green";
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";

  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
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
