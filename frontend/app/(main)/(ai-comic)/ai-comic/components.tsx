import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">{children}</div>;
}

export function PillButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs transition-colors",
        active
          ? "border-brand bg-brand text-white shadow-sm"
          : "border-surface-border bg-surface-card text-text-secondary hover:border-brand/40 hover:text-text-primary"
      )}
    >
      {children}
    </button>
  );
}
