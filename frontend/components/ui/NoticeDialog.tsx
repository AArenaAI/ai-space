"use client";

import { useEffect } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

interface NoticeDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  variant?: "warning" | "success";
  onConfirm: () => void;
}

export default function NoticeDialog({
  isOpen,
  title,
  description,
  confirmText = "我知道了",
  variant = "warning",
  onConfirm,
}: NoticeDialogProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const Icon = variant === "success" ? CheckCircle2 : AlertTriangle;
  const iconClassName = variant === "success" ? "text-green-500" : "text-amber-500";
  const iconBoxClassName = variant === "success"
    ? "bg-green-500/10 border-green-500/20"
    : "bg-amber-500/10 border-amber-500/20";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      {/* 毛玻璃背景 */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onConfirm}
      />

      {/* 弹窗卡片 */}
      <div className="relative w-full max-w-[360px] mx-4 rounded-2xl bg-surface-elevated border border-surface-border shadow-2xl p-6 animate-dialog-appear">
        {/* 图标 */}
        <div className="flex justify-center mb-4">
          <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center ${iconBoxClassName}`}>
            <Icon className={`w-7 h-7 ${iconClassName}`} />
          </div>
        </div>

        <h3 className="text-base font-semibold text-text-primary text-center mb-2">
          {title}
        </h3>
        {description && (
          <p className="text-sm text-text-secondary text-center mb-6 leading-relaxed">
            {description}
          </p>
        )}

        <button
          onClick={onConfirm}
          className="w-full px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-brand hover:bg-brand-hover transition-colors"
        >
          {confirmText}
        </button>
      </div>
    </div>
  );
}
