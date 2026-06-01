"use client";

import { X } from "lucide-react";
import { ReactNode, type ClipboardEventHandler } from "react";

export type DialogTheme = {
  name: string;
  primary: string;      // 主色 (text/border)
  primaryBg: string;    // 主色背景 (bg-xxx/10)
  primaryBorder: string;// 主色边框
  gradient: string;     // 头部渐变
  iconBg: string;       // 图标背景
  accent: string;       // 强调色
};

export const THEMES: Record<string, DialogTheme> = {
  blue: {
    name: "文件上传屋",
    primary: "text-blue-500",
    primaryBg: "bg-blue-500/10",
    primaryBorder: "border-blue-500/30",
    gradient: "from-blue-500/10 via-transparent to-transparent",
    iconBg: "bg-blue-500/15 border-blue-500/25",
    accent: "bg-blue-500",
  },
  green: {
    name: "学习游戏屋",
    primary: "text-green-500",
    primaryBg: "bg-green-500/10",
    primaryBorder: "border-green-500/30",
    gradient: "from-green-500/10 via-transparent to-transparent",
    iconBg: "bg-green-500/15 border-green-500/25",
    accent: "bg-green-500",
  },
  teal: {
    name: "文件转换坊",
    primary: "text-teal-500",
    primaryBg: "bg-teal-500/10",
    primaryBorder: "border-teal-500/30",
    gradient: "from-teal-500/10 via-transparent to-transparent",
    iconBg: "bg-teal-500/15 border-teal-500/25",
    accent: "bg-teal-500",
  },
  pink: {
    name: "图文花园",
    primary: "text-pink-500",
    primaryBg: "bg-pink-500/10",
    primaryBorder: "border-pink-500/30",
    gradient: "from-pink-500/10 via-transparent to-transparent",
    iconBg: "bg-pink-500/15 border-pink-500/25",
    accent: "bg-pink-500",
  },
  purple: {
    name: "图片编辑工坊",
    primary: "text-purple-500",
    primaryBg: "bg-purple-500/10",
    primaryBorder: "border-purple-500/30",
    gradient: "from-purple-500/10 via-transparent to-transparent",
    iconBg: "bg-purple-500/15 border-purple-500/25",
    accent: "bg-purple-500",
  },
  orange: {
    name: "模板工具箱",
    primary: "text-orange-500",
    primaryBg: "bg-orange-500/10",
    primaryBorder: "border-orange-500/30",
    gradient: "from-orange-500/10 via-transparent to-transparent",
    iconBg: "bg-orange-500/15 border-orange-500/25",
    accent: "bg-orange-500",
  },
};

export default function DialogShell({
  open,
  onClose,
  title,
  icon,
  children,
  size = "md",
  theme = THEMES.blue,
  onPaste,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  theme?: DialogTheme;
  onPaste?: ClipboardEventHandler<HTMLDivElement>;
}) {
  if (!open) return null;

  const sizeClass = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  }[size];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[85vh] w-full flex-col ${sizeClass} rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 主题化标题栏 */}
        <div className={`relative flex items-center justify-between border-b border-surface-border px-5 py-3.5 bg-gradient-to-r ${theme.gradient}`}>
          {/* 装饰角标 */}
          <div className={`absolute left-0 top-0 h-full w-1 ${theme.accent} opacity-60`} />
          
          <div className="flex items-center gap-2.5">
            {icon && (
              <div className={`flex h-8 w-8 items-center justify-center rounded-xl border ${theme.iconBg}`}>
                {icon}
              </div>
            )}
            <div>
              <h2 className="text-base font-semibold text-text-primary">{title}</h2>
              <p className={`text-[10px] ${theme.primary} font-medium`}>{theme.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-card hover:text-text-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-hide" onPaste={onPaste}>
          {children}
        </div>
      </div>
    </div>
  );
}
