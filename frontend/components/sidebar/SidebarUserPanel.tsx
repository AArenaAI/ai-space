"use client";

import { User, Settings } from "lucide-react";

interface SidebarUserPanelProps {
  user: { name?: string; email?: string } | null;
  collapsed?: boolean;
  onOpenSettings?: () => void;
  onShowTooltip?: (text: string) => void;
  onHideTooltip?: () => void;
}

export default function SidebarUserPanel({
  user,
  collapsed,
  onOpenSettings,
  onShowTooltip,
  onHideTooltip,
}: SidebarUserPanelProps) {
  // 折叠态：登录后只保留设置入口，退出登录统一放到设置页
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1">
        {user ? (
          <button
            onClick={onOpenSettings}
            onMouseEnter={onShowTooltip ? () => onShowTooltip("设置") : undefined}
            onMouseLeave={onHideTooltip}
            className="p-2.5 rounded-xl hover:bg-surface-card transition-colors"
          >
            <Settings className="w-5 h-5 text-text-tertiary" />
          </button>
        ) : (
          <a
            href="/login"
            onMouseEnter={onShowTooltip ? () => onShowTooltip("登录") : undefined}
            onMouseLeave={onHideTooltip}
            className="p-2.5 rounded-xl hover:bg-surface-card transition-colors"
          >
            <User className="w-5 h-5 text-text-tertiary" />
          </a>
        )}
      </div>
    );
  }

  // 未登录态
  if (!user) {
    return (
      <div className="p-2">
        <a
          href="/login"
          className="flex min-h-11 items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-surface-card hover:text-text-primary"
        >
          <User className="w-4 h-4" />
          <span>登录</span>
        </a>
      </div>
    );
  }

  // 已登录态
  return (
    <div className="p-2">
      <button
        type="button"
        onClick={onOpenSettings}
        className="group flex min-h-12 w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-card"
        title="账户与设置"
      >
        {/* 左侧：用户头像 + 名称 */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand/20 to-purple-500/20 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-brand">
              {(user.name || user.email || "U")[0].toUpperCase()}
            </span>
          </div>
          <span className="text-xs text-text-secondary truncate">
            {user.name || user.email}
          </span>
        </div>

        {/* 右侧：设置 */}
        <span className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors group-hover:text-text-primary">
          <Settings className="w-4 h-4" />
        </span>
      </button>
    </div>
  );
}
