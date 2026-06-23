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
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-text-tertiary transition-colors hover:bg-surface-card/45 hover:text-text-secondary"
      >
        <Lightbulb className="h-3 w-3 shrink-0 text-text-tertiary" />
        <span className="flex-1 text-xs font-medium">
          {isThinking ? t("chat.reasoning.thinking") : `${t("chat.reasoning.title")}${collapsedLabel}`}
        </span>
        {isThinking && (
          <div className="flex gap-0.5">
            <div className="h-1 w-1 animate-bounce rounded-full bg-text-tertiary" />
            <div className="h-1 w-1 animate-bounce rounded-full bg-text-tertiary [animation-delay:0.15s]" />
            <div className="h-1 w-1 animate-bounce rounded-full bg-text-tertiary [animation-delay:0.3s]" />
          </div>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform duration-300 ease-out ${expanded ? "rotate-180" : "rotate-0"}`}
        />
      </button>
      <div
        aria-hidden={!expanded}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            data-i18n-skip="true"
            className={`reasoning-markdown ml-2 mt-1 border-l border-surface-border py-1.5 pl-3 pr-1 text-text-secondary transition-[transform,filter] duration-300 ease-out ${stabilizeCompletionHeight ? "min-h-[64px]" : ""} ${expanded ? "translate-y-0 blur-0" : "-translate-y-1 blur-[1px]"}`}
          >
            <DeferredMarkdownRenderer
              content={content}
              shouldHydrateRichText={shouldHydrateRichText}
              priorityHydrateRichText={priorityHydrateRichText}
              allowRichLiteFallback={allowRichLiteFallback}
              compactRichLitePreview={compactRichLitePreview}
              messageId={messageId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
