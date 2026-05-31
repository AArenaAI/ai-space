"use client";

import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

function ThinkingDots() {
  return (
    <span className="inline-flex items-center">
      <span className="animate-bounce [animation-delay:0s]">.</span>
      <span className="animate-bounce [animation-delay:0.2s]">.</span>
      <span className="animate-bounce [animation-delay:0.4s]">.</span>
    </span>
  );
}

function WaveText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("relative inline-block overflow-hidden", className)}>
      <span className="text-text-secondary">{text}</span>
      <span
        className="pointer-events-none absolute inset-0 block -translate-x-full animate-shimmer"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
        }}
      />
    </span>
  );
}

export default function CompareLoadingSlot({ isComplexTask, deepReasoningLabel }: { isComplexTask: boolean; deepReasoningLabel: string }) {
  return (
    <div className="flex gap-3 animate-message-appear">
      <div className="mt-1 w-7 shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-surface-border bg-surface-card">
          <Bot className="h-4 w-4 text-text-secondary" />
        </div>
      </div>
      <div className="flex-1">
        <div className="inline-flex rounded-2xl rounded-bl-sm bg-surface-elevated px-4 py-3 text-sm text-text-secondary">
          {isComplexTask ? (
            <span className="inline-flex items-center gap-0.5">
              <WaveText text={deepReasoningLabel} />
              <ThinkingDots />
            </span>
          ) : (
            <ThinkingDots />
          )}
        </div>
      </div>
    </div>
  );
}
