"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Lightbulb } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";

const DEFAULT_COLLAPSE_THRESHOLD = 2000;

export function ThinkBlock({
  content,
  isThinking,
  collapseThreshold = DEFAULT_COLLAPSE_THRESHOLD,
}: {
  content: string;
  isThinking: boolean;
  collapseThreshold?: number;
}) {
  const { t } = useI18n();
  const shouldCollapseByDefault = !isThinking && content.length >= collapseThreshold;
  const [expanded, setExpanded] = useState(() => !shouldCollapseByDefault);
  const collapsedLabel = shouldCollapseByDefault && !expanded ? ` · ${t("chat.reasoning.collapsed")}` : "";

  return (
    <div className="mb-3 rounded-xl border border-surface-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left transition-colors
          bg-purple-50 hover:bg-purple-100
          dark:bg-[#1A1A2E] dark:hover:bg-[#252542]"
      >
        <Lightbulb className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
        <span className="text-sm font-medium text-text-secondary flex-1">
          {isThinking ? t("chat.reasoning.thinking") : `${t("chat.reasoning.title")}${collapsedLabel}`}
        </span>
        {isThinking && (
          <div className="flex gap-0.5">
            <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce" />
            <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce [animation-delay:0.15s]" />
            <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce [animation-delay:0.3s]" />
          </div>
        )}
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        )}
      </button>
      {expanded && (
        <div data-i18n-skip="true" className="reasoning-markdown px-3 py-2.5 bg-slate-50 dark:bg-[#0F0F1A]">
          <DeferredMarkdownRenderer content={content} />
        </div>
      )}
    </div>
  );
}
