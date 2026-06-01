import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function MetricCard({
  title,
  value,
  helper,
  icon: Icon,
  tone = "blue",
}: {
  title: string;
  value: string;
  helper?: string;
  icon: LucideIcon;
  tone?: "blue" | "green" | "amber" | "red" | "purple";
}) {
  const toneClass = {
    blue: "bg-blue-500/10 text-blue-500",
    green: "bg-emerald-500/10 text-emerald-500",
    amber: "bg-amber-500/10 text-amber-500",
    red: "bg-red-500/10 text-red-500",
    purple: "bg-violet-500/10 text-violet-500",
  }[tone];

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-text-tertiary">{title}</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-text-primary">{value}</p>
          {helper && <p className="mt-2 text-xs text-text-tertiary">{helper}</p>}
        </div>
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", toneClass)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
