"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  open?: boolean;
  isOpen?: boolean; // 兼容旧版
  onClose?: () => void;
  onCancel?: () => void; // 兼容旧版
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "danger";
}

export default function ConfirmDialog({
  open,
  isOpen,
  onClose,
  onCancel,
  onConfirm,
  title,
  description,
  confirmText = "确定",
  cancelText = "取消",
  variant = "default",
}: ConfirmDialogProps) {
  const isOpenState = open ?? isOpen ?? false;
  const handleClose = onClose ?? onCancel ?? (() => {});
  useEffect(() => {
    if (isOpenState) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpenState]);

  if (!isOpenState) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative w-full max-w-[400px] mx-4 rounded-2xl bg-surface-elevated border border-surface-border shadow-2xl p-6 animate-dialog-appear">
        <div className="flex items-start gap-3 mb-4">
          {variant === "danger" && (
            <div className="shrink-0 w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
          )}
          <div>
            <h3 className="text-base font-semibold text-text-primary">{title}</h3>
            {description && (
              <p className="text-sm text-text-secondary mt-1 leading-relaxed">{description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary bg-surface-card border border-surface-border hover:bg-surface-elevated transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors",
              variant === "danger"
                ? "bg-red-500 hover:bg-red-600"
                : "bg-brand hover:bg-brand-hover"
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
