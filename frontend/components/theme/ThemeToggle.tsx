"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export default function ThemeToggle() {
  const themeContext = useTheme();
  
  // 如果没有上下文（服务端渲染时），显示默认按钮
  if (!themeContext) {
    return (
      <button className="relative w-8 h-8 rounded-lg flex items-center justify-center">
        <Moon className="w-4 h-4 text-text-secondary" />
      </button>
    );
  }
  
  const { theme, toggleTheme } = themeContext;

  return (
    <button
      onClick={toggleTheme}
      className="relative w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-200 hover:bg-surface-card"
      title={theme === "dark" ? "切换到白天模式" : "切换到夜晚模式"}
    >
      {theme === "dark" ? (
        <Moon className="w-4 h-4 text-text-secondary" />
      ) : (
        <Sun className="w-4 h-4 text-amber-500" />
      )}
    </button>
  );
}
