"use client";

import { Sun, Moon, Eye } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { useI18n } from "@/lib/i18n";

const themeIcons: Record<string, React.ReactNode> = {
  light: <Sun className="w-4 h-4 text-amber-500" />,
  dark: <Moon className="w-4 h-4 text-indigo-300" />,
  green: <Eye className="w-4 h-4 text-emerald-600" />,
};

export default function ThemeToggle() {
  const themeContext = useTheme();
  const { t } = useI18n();

  // 如果没有上下文（服务端渲染时），显示默认按钮
  if (!themeContext) {
    return (
      <button className="relative w-8 h-8 rounded-lg flex items-center justify-center">
        <Moon className="w-4 h-4 text-text-secondary" />
      </button>
    );
  }

  const { theme, toggleTheme } = themeContext;
  const themeLabel = t(`appearance.theme.${theme}`) || theme;

  return (
    <button
      onClick={toggleTheme}
      className="relative w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-200 hover:bg-surface-card group"
      title={t("theme.current", { label: themeLabel })}
    >
      {themeIcons[theme] || <Sun className="w-4 h-4 text-amber-500" />}
      {/* 悬浮提示显示下一个模式 */}
      <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap px-1.5 py-0.5 rounded bg-surface-card border border-surface-border text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-50">
        {themeLabel}
      </span>
    </button>
  );
}
