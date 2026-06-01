import { cn } from "@/lib/utils";

export function StatusBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "blue" | "amber" | "red" | "purple" }) {
  const toneClass = {
    neutral: "border-surface-border bg-surface-elevated text-text-secondary",
    green: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-600",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-600",
    red: "border-red-500/20 bg-red-500/10 text-red-600",
    purple: "border-violet-500/20 bg-violet-500/10 text-violet-600",
  }[tone];
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", toneClass)}>{children}</span>;
}
