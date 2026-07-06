"use client";

import { cn } from "@/lib/utils";

const pendingDotStyle = {
  backgroundColor: "color-mix(in srgb, var(--text-secondary) 60%, var(--text-primary) 40%)",
  boxShadow: "0 0 12px color-mix(in srgb, var(--text-secondary) 38%, transparent)",
};

export default function AssistantPendingShell({
  label,
  detail,
  compact = false,
  showAvatar: _showAvatar = false,
  className,
}: {
  label?: string | null;
  detail?: string | null;
  compact?: boolean;
  showAvatar?: boolean;
  className?: string;
}) {
  const accessibleLabel = label || detail || "正在生成";
  return (
    <div
      className={cn(
        "flex w-full min-w-0 items-center gap-2 py-1.5 text-sm text-text-secondary",
        compact && "py-1 text-xs",
        className,
      )}
      data-chat-pending-shell="true"
      data-chat-pending-compact={compact ? "true" : "false"}
      aria-label={accessibleLabel}
    >
      <span
        className="inline-flex h-3.5 w-3.5 shrink-0 animate-pulse rounded-full"
        style={pendingDotStyle}
        data-chat-pending-dot-core="true"
        aria-hidden="true"
      />
      {label && <span className="min-w-0 truncate text-xs font-medium text-text-tertiary">{label}</span>}
      {detail && <span className="ml-1 truncate text-xs text-text-tertiary/80">{detail}</span>}
    </div>
  );
}
