"use client";

import { Copy, Quote } from "lucide-react";
import { cn } from "@/lib/utils";

export type TextSelectionFloatingBarState = {
  text: string;
  top: number;
  left: number;
};

export default function TextSelectionFloatingBar({
  selection,
  copyLabel,
  quoteLabel,
  onCopy,
  onCopyQuote,
}: {
  selection: TextSelectionFloatingBarState | null;
  copyLabel: string;
  quoteLabel: string;
  onCopy: () => void;
  onCopyQuote: () => void;
}) {
  if (!selection) return null;

  return (
    <div
      data-testid="chat-text-selection-bar"
      className={cn(
        "fixed z-[95] flex -translate-x-1/2 items-center gap-1 rounded-xl border border-surface-border bg-surface-elevated/95 p-1 shadow-xl backdrop-blur",
        "text-text-secondary animate-fade-in"
      )}
      style={{ top: selection.top, left: selection.left }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        data-testid="chat-text-selection-copy"
        onClick={onCopy}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-card hover:text-text-primary"
      >
        <Copy className="h-3.5 w-3.5" />
        {copyLabel}
      </button>
      <button
        type="button"
        data-testid="chat-text-selection-copy-quote"
        onClick={onCopyQuote}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-card hover:text-text-primary"
      >
        <Quote className="h-3.5 w-3.5" />
        {quoteLabel}
      </button>
    </div>
  );
}
