"use client";

import { CheckCircle2, X } from "lucide-react";
import { useEffect } from "react";

interface DeleteSuccessNoticeProps {
  open: boolean;
  label?: string;
  onClose: () => void;
}

export default function DeleteSuccessNotice({ open, label = "会话", onClose }: DeleteSuccessNoticeProps) {
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(onClose, 2200);
    return () => window.clearTimeout(timer);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-5 z-[1000] -translate-x-1/2 px-4">
      <div className="pointer-events-auto flex min-w-[280px] max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl border border-surface-border bg-surface-card/95 px-4 py-3 shadow-2xl shadow-black/10 backdrop-blur-xl">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">删除成功</p>
          <p className="mt-0.5 text-xs text-text-secondary">{label}已从历史记录中移除</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-elevated hover:text-text-primary"
          aria-label="关闭提示"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
