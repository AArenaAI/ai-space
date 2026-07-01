"use client";

import type { ComponentType, ReactNode } from "react";
import { Message } from "@/lib/chatTypes";
import { cn } from "@/lib/utils";
import { parseThinkContent, sanitizeContent } from "@/lib/chatContent";
import { formatElapsedTime } from "@/lib/chatGenerationPhase";
import type { ChatMessageRuntimeState } from "@/lib/chatMessageRuntimeState";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";
import { StreamingText } from "./StreamingText";
import { ThinkBlock } from "./ThinkBlock";

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

function resolveAnswerRenderState({
  generating,
  runtimeState,
  shouldRenderStreamingText,
}: {
  generating: boolean;
  runtimeState: ChatMessageRuntimeState;
  shouldRenderStreamingText: boolean;
}): "pending" | "streaming" | "settling" | "completed-stable" | "hydrated" {
  if (generating) return "streaming";
  if (shouldRenderStreamingText && runtimeState.terminal) return "settling";
  if (shouldRenderStreamingText) return runtimeState.content?.trim() ? "settling" : "pending";
  if (runtimeState.terminal) return "hydrated";
  return runtimeState.content?.trim() ? "completed-stable" : "pending";
}

export function AssistantAnswerRenderer({
  message,
  runtimeState,
  generating,
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
  generating: boolean;
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
  const renderState = resolveAnswerRenderState({ generating, runtimeState, shouldRenderStreamingText });

  if (shouldRenderStreamingText) {
    return (
      <div data-chat-answer-renderer="true" data-chat-answer-render-state={renderState}>
        <StreamingText
          messageId={message.id}
          content={runtimeState.content || ""}
          reasoningContent={runtimeState.reasoningContent || undefined}
          isStreaming={generating}
          preferCanonicalContent={runtimeState.terminalSource === "message"}
          className="text-[15px] leading-relaxed text-text-primary"
          onOpenActivity={onOpenActivity}
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
