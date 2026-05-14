"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, User, Settings, Copy, CheckCircle2 } from "lucide-react";
import { useCredits } from "@/hooks/useCredits";

interface SidebarUserPanelProps {
  user: { name?: string; email?: string } | null;
  collapsed?: boolean;
  onLogout: () => void;
  onShowTooltip?: (text: string) => void;
  onHideTooltip?: () => void;
}

export default function SidebarUserPanel({
  user,
  collapsed,
  onLogout,
  onShowTooltip,
  onHideTooltip,
}: SidebarUserPanelProps) {
  const router = useRouter();
  const { credits, loading } = useCredits();
  const [copied, setCopied] = useState(false);

  const handleUpgrade = () => {
    router.push("/pricing");
  };

  const handleCopy = () => {
    const text = user?.email || "";
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 折叠态：只显示用户头像/退出
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1">
        {user ? (
          <button
            onClick={onLogout}
            onMouseEnter={onShowTooltip ? () => onShowTooltip("退出登录") : undefined}
            onMouseLeave={onHideTooltip}
            className="p-2.5 rounded-xl hover:bg-surface-card transition-colors"
          >
            <LogOut className="w-5 h-5 text-text-tertiary" />
          </button>
        ) : (
          <Link
            href="/login"
            onMouseEnter={onShowTooltip ? () => onShowTooltip("登录") : undefined}
            onMouseLeave={onHideTooltip}
            className="p-2.5 rounded-xl hover:bg-surface-card transition-colors"
          >
            <User className="w-5 h-5 text-text-tertiary" />
          </Link>
        )}
      </div>
    );
  }

  // 未登录态
  if (!user) {
    return (
      <div className="p-2">
        <Link
          href="/login"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
        >
          <User className="w-4 h-4" />
          <span>登录</span>
        </Link>
      </div>
    );
  }

  // 已登录态 — 主题适配卡片
  return (
    <div className="p-2">
      <div className="rounded-xl bg-surface-card border border-surface-border overflow-hidden">
        {/* 积分信息 */}
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center justify-center gap-4 text-sm">
            {/* 基础积分 */}
            <div className="flex items-center gap-1">
              <span className="text-emerald-400 text-xs">💎</span>
              <span className="font-mono tabular-nums text-text-primary font-medium">
                {loading ? "-" : credits?.basic_credits ?? 0}
              </span>
            </div>
            {/* 分隔 */}
            <span className="text-text-tertiary/30">|</span>
            {/* 高级积分 */}
            <div className="flex items-center gap-1">
              <span className="text-violet-400 text-xs">⚡</span>
              <span className="font-mono tabular-nums text-text-primary font-medium">
                {loading ? "-" : credits?.advanced_credits ?? 0}
              </span>
            </div>
            {/* 分隔 */}
            <span className="text-text-tertiary/30">|</span>
            {/* 精英积分 */}
            <div className="flex items-center gap-1">
              <span className="text-amber-400 text-xs">⭐</span>
              <span className="font-mono tabular-nums text-text-primary font-medium">
                {loading ? "-" : credits?.elite_credits ?? 0}
              </span>
            </div>
          </div>

          {/* 提示文字 */}
          <p className="text-center text-[11px] text-text-tertiary mt-1.5">
            升级以获取更多积分
          </p>

          {/* 升级按钮 */}
          <button
            onClick={handleUpgrade}
            className="w-full mt-2 py-2 rounded-lg text-sm font-medium text-slate-900 bg-gradient-to-r from-white via-purple-100 to-blue-100 hover:from-purple-50 hover:via-purple-200 hover:to-blue-200 transition-all duration-200 shadow-lg shadow-purple-500/10"
          >
            升级
          </button>
        </div>

        {/* 底部用户栏 */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-surface-border">
          {/* 左侧：用户头像 + 名称 */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand/20 to-purple-500/20 flex items-center justify-center shrink-0 border border-surface-border">
              <span className="text-xs font-bold text-brand">
                {(user.name || user.email || "U")[0].toUpperCase()}
              </span>
            </div>
            <span className="text-xs text-text-secondary truncate">
              {user.name || user.email}
            </span>
          </div>

          {/* 右侧：操作按钮 */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
              title="复制邮箱"
            >
              {copied ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
            <Link
              href="/settings"
              className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors"
              title="设置"
            >
              <Settings className="w-3.5 h-3.5" />
            </Link>
            <button
              onClick={onLogout}
              className="p-1.5 rounded-md text-text-tertiary hover:text-red-400 hover:bg-surface-elevated transition-colors"
              title="退出"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
