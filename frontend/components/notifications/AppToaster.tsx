"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { Toaster } from "sonner";

const toastCardClass = [
  "group relative overflow-hidden rounded-[22px] border border-surface-border/90 bg-surface-card/95 px-4 py-3.5 text-text-primary",
  "shadow-[0_18px_48px_rgba(15,23,42,0.14),0_2px_10px_rgba(15,23,42,0.07)] backdrop-blur-2xl",
  "before:pointer-events-none before:absolute before:inset-y-4 before:left-4 before:w-[3px] before:rounded-full before:bg-text-primary",
  "after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-text-primary/15 after:to-transparent",
  "dark:shadow-[0_20px_56px_rgba(0,0,0,0.46)] green:shadow-[0_18px_48px_rgba(53,62,46,0.16),0_2px_10px_rgba(53,62,46,0.08)]",
].join(" ");

const toastTypeClass = [
  toastCardClass,
  "data-[type=error]:before:bg-destructive",
  "data-[type=warning]:before:bg-text-primary",
  "data-[type=success]:before:bg-text-primary",
  "data-[type=info]:before:bg-text-primary",
].join(" ");

const iconClass = "h-4 w-4 text-text-primary/85";
const errorIconClass = "h-4 w-4 text-destructive";

export default function AppToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 2600,
        classNames: {
          toast: toastTypeClass,
          content: "min-w-0 pl-5",
          title: "text-[14px] font-semibold leading-5 tracking-[-0.01em] text-text-primary",
          description: "mt-1 text-[13px] font-normal leading-5 text-text-secondary",
          icon:
            "ml-5 mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-surface-border bg-surface-elevated text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
          closeButton:
            "border-surface-border bg-surface-card text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
          actionButton:
            "rounded-full bg-text-primary px-3 py-1.5 text-xs font-medium text-surface hover:opacity-90",
          cancelButton:
            "rounded-full border border-surface-border bg-transparent px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-elevated/70",
          success: "text-text-primary",
          error: "text-text-primary",
          warning: "text-text-primary",
          info: "text-text-primary",
          loading: "text-text-primary",
        },
      }}
      icons={{
        success: <CheckCircle2 className={iconClass} strokeWidth={1.8} />,
        error: <XCircle className={errorIconClass} strokeWidth={1.8} />,
        warning: <AlertTriangle className={iconClass} strokeWidth={1.8} />,
        info: <Info className={iconClass} strokeWidth={1.8} />,
        loading: <Loader2 className={`${iconClass} animate-spin`} strokeWidth={1.8} />,
      }}
      richColors={false}
    />
  );
}
