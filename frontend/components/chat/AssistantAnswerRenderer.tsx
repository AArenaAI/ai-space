"use client";

import type { ComponentType, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Message } from "@/lib/chatTypes";
import { cn } from "@/lib/utils";
import { parseThinkContent, sanitizeContent } from "@/lib/chatContent";
import { formatElapsedTime } from "@/lib/chatGenerationPhase";
import type { ChatMessageRuntimeState } from "@/lib/chatMessageRuntimeState";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";
import { StreamingText } from "./StreamingText";
import { ThinkBlock } from "./ThinkBlock";
import { normalizeSearchSources } from "@/lib/searchSources";
import { resolveAssistantAnswerRenderState, type AssistantGenerationState } from "@/lib/chatGenerationState";

type MarkdownRendererComponent = ComponentType<{
  content: string;
  shouldHydrateRichText?: boolean;
  priorityHydrateRichText?: boolean;
  allowRichLiteFallback?: boolean;
  compactRichLitePreview?: boolean;
  messageId?: string | number;
}>;

function generationElapsedMs(message: Message, runtimeState: ChatMessageRuntimeState) {
  const start = runtimeState.generationStartedAt || message.generationStartedAt || message.createdAt;
  const end = runtimeState.completedAt || Date.now();
  return start ? Math.max(0, end - start) : 0;
}

export function AssistantAnswerRenderer({
  message,
  runtimeState,
  generationState,
  shouldRenderStreamingText,
  keepReasoningExpanded,
  className,
  MarkdownRenderer = DeferredMarkdownRenderer,
  shouldHydrateRichText = true,
  priorityHydrateRichText = false,
  allowRichLiteFallback = false,
  compactRichLitePreview = true,
  onOpenActivity,
  inlineActivity,
  t,
}: {
  message: Message;
  runtimeState: ChatMessageRuntimeState;
  generationState: AssistantGenerationState;
  shouldRenderStreamingText: boolean;
  keepReasoningExpanded: boolean;
  className?: string;
  MarkdownRenderer?: MarkdownRendererComponent;
  shouldHydrateRichText?: boolean;
  priorityHydrateRichText?: boolean;
  allowRichLiteFallback?: boolean;
  compactRichLitePreview?: boolean;
  onOpenActivity?: () => void;
  inlineActivity?: ReactNode;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const renderState = resolveAssistantAnswerRenderState({ generationState, runtimeState, shouldRenderStreamingText });

  if (shouldRenderStreamingText) {
    const sourceCount = normalizeSearchSources(runtimeState.searchSources).length || runtimeState.searchSourcesCount || 0;
    const hasReasoningSignal = Boolean(runtimeState.reasoningContent?.trim() || /<think>[\s\S]*?<\/think>/i.test(runtimeState.content || ""));
    const showSourceOnlyActivityEntry = runtimeState.terminal && !hasReasoningSignal && sourceCount > 0 && !!onOpenActivity;
    return (
      <div data-chat-answer-renderer="true" data-chat-answer-render-state={renderState}>
        {showSourceOnlyActivityEntry && (
          <div className="mt-1 mb-2" data-chat-stream-source-entry="true">
            <button
              type="button"
              aria-expanded={false}
              onClick={() => onOpenActivity?.()}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left text-text-tertiary transition-colors hover:bg-surface-card/45 hover:text-text-secondary"
            >
              <span className="text-xs font-medium">来源 · {sourceCount}</span>
              <ChevronDown className="h-3.5 w-3.5 -rotate-90 shrink-0 text-text-tertiary/80" />
            </button>
            {inlineActivity && <div className="mt-2">{inlineActivity}</div>}
          </div>
        )}
        <StreamingText
          messageId={message.id}
          content={runtimeState.content || ""}
          reasoningContent={runtimeState.reasoningContent || undefined}
          isStreaming={generationState.isGenerating}
          isGenerating={generationState.isGenerating}
          preferCanonicalContent={runtimeState.terminalSource === "message"}
          className="text-[15px] leading-relaxed text-text-primary"
          onOpenActivity={onOpenActivity}
          runtimePhase={generationState.visualPhase}
        />
      </div>
    );
  }

  const finalContent = runtimeState.reasoningContent?.trim() && !/<think>[\s\S]*?<\/think>/i.test(runtimeState.content || "")
    ? `<think>${runtimeState.reasoningContent}</think>\n\n${runtimeState.content || ""}`.trim()
    : runtimeState.content;
  const { reasoning, answer, isThinking } = parseThinkContent(finalContent);
  const cleanAnswer = sanitizeContent(answer);
  const elapsedLabel = reasoning ? formatElapsedTime(generationElapsedMs(message, runtimeState), t) : "";
  const sourceCount = normalizeSearchSources(runtimeState.searchSources).length || runtimeState.searchSourcesCount || 0;
  const showSourceOnlyActivityEntry = !reasoning && sourceCount > 0 && !!onOpenActivity;

  return (
    <div className={cn("prose prose-sm max-w-none", className)} data-chat-answer-renderer="true" data-chat-answer-render-state={renderState}>
      {reasoning && (
        <ThinkBlock
          content={reasoning}
          isThinking={isThinking}
          defaultExpanded={keepReasoningExpanded}
          stabilizeCompletionHeight={keepReasoningExpanded}
          shouldHydrateRichText={shouldHydrateRichText}
          priorityHydrateRichText={priorityHydrateRichText}
          allowRichLiteFallback={allowRichLiteFallback}
          compactRichLitePreview={compactRichLitePreview}
          messageId={message.id}
          onOpenActivity={onOpenActivity}
          elapsedLabel={elapsedLabel}
          inlineActivity={inlineActivity}
        />
      )}
      {showSourceOnlyActivityEntry && (
        <div className="mt-1 mb-2" data-chat-stream-source-entry="true">
          <button
            type="button"
            aria-expanded={false}
            onClick={() => onOpenActivity?.()}
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left text-text-tertiary transition-colors hover:bg-surface-card/45 hover:text-text-secondary"
          >
            <span className="text-xs font-medium">来源 · {sourceCount}</span>
            <ChevronDown className="h-3.5 w-3.5 -rotate-90 shrink-0 text-text-tertiary/80" />
          </button>
          {inlineActivity && <div className="mt-2">{inlineActivity}</div>}
        </div>
      )}
      <MarkdownRenderer
        content={cleanAnswer}
        shouldHydrateRichText={shouldHydrateRichText}
        priorityHydrateRichText={priorityHydrateRichText}
        allowRichLiteFallback={allowRichLiteFallback}
        compactRichLitePreview={compactRichLitePreview}
        messageId={message.id}
      />
    </div>
  );
}
