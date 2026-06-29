"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Lightbulb } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";

const DEFAULT_COLLAPSE_THRESHOLD = 0;

export function ThinkBlock({
  content,
  isThinking,
  collapseThreshold = DEFAULT_COLLAPSE_THRESHOLD,
  defaultExpanded = false,
  shouldHydrateRichText = true,
  priorityHydrateRichText = false,
  allowRichLiteFallback = false,
  compactRichLitePreview = true,
  messageId,
  stabilizeCompletionHeight = false,
  onOpenActivity,
}: {
  content: string;
  isThinking: boolean;
  collapseThreshold?: number;
  defaultExpanded?: boolean;
  shouldHydrateRichText?: boolean;
  priorityHydrateRichText?: boolean;
  allowRichLiteFallback?: boolean;
  compactRichLitePreview?: boolean;
  messageId?: string | number;
  stabilizeCompletionHeight?: boolean;
  onOpenActivity?: () => void;
}) {
  const { t } = useI18n();
  const shouldCollapseByDefault = !defaultExpanded && !isThinking && content.length >= collapseThreshold;
  const [expanded, setExpanded] = useState(() => !shouldCollapseByDefault);

  useEffect(() => {
    if (defaultExpanded) setExpanded(true);
  }, [defaultExpanded]);

  const collapsedLabel = shouldCollapseByDefault && !expanded ? ` · ${t("chat.reasoning.collapsed")}` : "";

  return (
    <div className="mb-2">
      <button
        onClick={() => onOpenActivity?.()}
        aria-expanded={false}
        className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-text-tertiary transition-colors hover:bg-surface-card/45 hover:text-text-secondary"
      >
        <span className="text-xs font-medium">
          {isThinking ? "思考中" : "已思考"}
        </span>
        <ChevronDown
          className="h-3.5 w-3.5 -rotate-90 shrink-0 text-text-tertiary/80"
        />
      </button>

    </div>
  );
}
