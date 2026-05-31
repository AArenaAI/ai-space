"use client";

import { CheckCircle2, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

export default function NetworkStatusHint({
  isOffline,
  justRestored,
  offlineLabel,
  restoredLabel,
}: {
  isOffline: boolean;
  justRestored: boolean;
  offlineLabel: string;
  restoredLabel: string;
}) {
  if (!isOffline && !justRestored) return null;

  return (
    <div className="mb-2 flex justify-center" role="status" aria-live="polite">
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-sm backdrop-blur",
          isOffline
            ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        )}
      >
        {isOffline ? <WifiOff className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        <span>{isOffline ? offlineLabel : restoredLabel}</span>
      </div>
    </div>
  );
}
