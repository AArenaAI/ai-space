"use client";

import { Bot, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

function ThinkingDots() {
  return (
    <span className="inline-flex w-5 items-center justify-start text-text-tertiary" aria-hidden="true">
      <span className="animate-bounce [animation-delay:0s]">.</span>
      <span className="animate-bounce [animation-delay:0.16s]">.</span>
      <span className="animate-bounce [animation-delay:0.32s]">.</span>
    </span>
  );
}

export default function AssistantPendingShell({
  label = "正在生成回答",
  detail,
  compact = false,
  showAvatar = false,
  className,
}: {
  label?: string;
  detail?: string;
  compact?: boolean;
  showAvatar?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[104px] w-full items-start gap-3 rounded-2xl border border-surface-border/45 bg-surface-card/35 px-3 py-3 text-sm text-text-secondary",
        compact && "min-h-[86px] px-3 py-2.5",
        className,
      )}
      data-chat-pending-shell="true"
      data-chat-pending-compact={compact ? "true" : "false"}
    >
      {showAvatar && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-surface-card">
          <Bot className="h-4 w-4 text-text-secondary" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-center gap-2">
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-brand" />
          <span className="font-medium text-text-secondary">{label}</span>
          <ThinkingDots />
        </div>
        <div className="mt-2 h-2 w-2/3 max-w-[360px] overflow-hidden rounded-full bg-surface-elevated">
          <div className="h-full w-1/2 animate-shimmer rounded-full bg-gradient-to-r from-transparent via-brand/25 to-transparent" />
        </div>
        <div className="mt-2 h-2 w-1/3 max-w-[220px] rounded-full bg-surface-elevated/70" />
        {detail && <div className="mt-2 text-xs text-text-tertiary">{detail}</div>}
      </div>
    </div>
  );
}
