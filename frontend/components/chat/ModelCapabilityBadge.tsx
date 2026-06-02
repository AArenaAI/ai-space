"use client";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { ModelCapabilityMeta } from "@/lib/models/modelCapabilities";

const TONE_CLASS: Record<ModelCapabilityMeta["tone"], string> = {
  blue: "border-blue-400/25 bg-blue-500/10 text-blue-500 dark:text-blue-300",
  green: "border-emerald-400/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  purple: "border-purple-400/25 bg-purple-500/10 text-purple-600 dark:text-purple-300",
  amber: "border-amber-400/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  cyan: "border-cyan-400/25 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300",
  slate: "border-surface-border bg-surface-card text-text-tertiary",
};

export function ModelCapabilityBadge({ capability, compact = false }: { capability: ModelCapabilityMeta; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border font-medium leading-none",
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
        TONE_CLASS[capability.tone]
      )}
    >
      {t(capability.label)}
    </span>
  );
}

export function ModelCapabilityBadges({ capabilities, compact = false, className }: { capabilities: ModelCapabilityMeta[]; compact?: boolean; className?: string }) {
  if (capabilities.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {capabilities.map((capability) => (
        <ModelCapabilityBadge key={capability.key} capability={capability} compact={compact} />
      ))}
    </div>
  );
}

