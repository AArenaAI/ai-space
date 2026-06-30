"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { Message } from "@/lib/chatTypes";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { isMessageGenerating, parseThinkContent, sanitizeContent } from "@/lib/chatContent";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";
import { StreamingText } from "./StreamingText";
import { ThinkBlock } from "./ThinkBlock";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";
import { formatElapsedTime } from "@/lib/chatGenerationPhase";

type MarkdownRendererComponent = ComponentType<{ content: string; shouldHydrateRichText?: boolean; priorityHydrateRichText?: boolean; allowRichLiteFallback?: boolean; compactRichLitePreview?: boolean; messageId?: string | number }>;

const JUST_COMPLETED_REASONING_EXPAND_MS = 5 * 60 * 1000;
const JUST_COMPLETED_STREAMING_HOLD_MS = 800;

function mayStillRecoverMessage(msg: Message) {
  return !msg.completedAt && !msg.stopped && !!(
    msg.activityStatus ||
    msg.serverMessageId ||
    msg.generationTaskId ||
    msg.backgroundTaskId ||
    msg.useBackground ||
    msg.isComplexTask
  );
}

function generationElapsedMs(message: Message, realtime: ReturnType<typeof useMessageRealtime>) {
  const start = realtime?.generationStartedAt || message.generationStartedAt || message.createdAt;
  const end = realtime?.completedAt || message.completedAt || Date.now();
  return start ? Math.max(0, end - start) : 0;
}

export function AssistantMessageContent({
  message,
  isStreaming,
  className,
  MarkdownRenderer = DeferredMarkdownRenderer,
  shouldHydrateRichText = true,
  priorityHydrateRichText = false,
  allowRichLiteFallback = false,
  compactRichLitePreview = true,
  recoverEmptyContent = false,
  onRegenerate,
  onOpenActivity,
}: {
  message: Message;
  isStreaming: boolean;
  className?: string;
  MarkdownRenderer?: MarkdownRendererComponent;
  shouldHydrateRichText?: boolean;
  priorityHydrateRichText?: boolean;
  allowRichLiteFallback?: boolean;
  compactRichLitePreview?: boolean;
  recoverEmptyContent?: boolean;
  onRegenerate?: () => void;
  onOpenActivity?: () => void;
}) {
  const { t } = useI18n();
  const realtime = useMessageRealtime(message.id);
  const generating = isMessageGenerating(message, isStreaming);
  const realtimeHasVisiblePayload = !!(
    realtime?.content?.trim() ||
    realtime?.answerContent?.trim() ||
    realtime?.reasoningContent?.trim()
  );
  const completedAt = realtime?.completedAt;
  const wasStreamingRef = useRef(false);
  const [keepCompletedStreaming, setKeepCompletedStreaming] = useState(false);
  const [keepReasoningExpanded, setKeepReasoningExpanded] = useState(false);
  const justStoppedStreaming = wasStreamingRef.current && !generating;
  const finalizingRealtime = !generating && (justStoppedStreaming || keepCompletedStreaming) && realtimeHasVisiblePayload;
  const shouldRenderStreamingText = generating || finalizingRealtime || (!message.content && recoverEmptyContent && mayStillRecoverMessage(message));

  useEffect(() => {
    if (!completedAt || !realtimeHasVisiblePayload) return;
    setKeepCompletedStreaming(true);
    const timer = window.setTimeout(() => setKeepCompletedStreaming(false), JUST_COMPLETED_STREAMING_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [completedAt, realtimeHasVisiblePayload]);

  useEffect(() => {
    let timer: number | undefined;
    if (wasStreamingRef.current && !generating) {
      setKeepCompletedStreaming(true);
      timer = window.setTimeout(() => setKeepCompletedStreaming(false), JUST_COMPLETED_STREAMING_HOLD_MS);
    }
    wasStreamingRef.current = generating;
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [generating, message.id]);

  useEffect(() => {
    if (!(generating || finalizingRealtime) || !(realtime?.reasoningContent?.trim() || message.reasoningContent?.trim())) return;
    setKeepReasoningExpanded(true);
    const timer = window.setTimeout(() => setKeepReasoningExpanded(false), JUST_COMPLETED_REASONING_EXPAND_MS);
    return () => window.clearTimeout(timer);
  }, [finalizingRealtime, generating, message.id, message.reasoningContent, realtime?.reasoningContent]);

  if (shouldRenderStreamingText) {
    return (
      <StreamingText
        messageId={message.id}
        content={message.content || ""}
        reasoningContent={message.reasoningContent}
        isStreaming={generating}
        className="text-[15px] leading-relaxed text-text-primary"
        onOpenActivity={onOpenActivity}
      />
    );
  }

  if (!message.content) {
    return (
      <div className="flex max-w-full flex-col gap-3 rounded-xl border border-amber-400/30 bg-amber-50/70 px-3 py-3 text-[15px] leading-relaxed text-amber-900 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
          <div className="min-w-0">
            <div className="font-medium">{t("chat.interrupted.title")}</div>
            <div className="mt-0.5 text-sm text-amber-800/80 dark:text-amber-100/75">{t("chat.interrupted.description")}</div>
          </div>
        </div>
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-amber-500/30 bg-white/70 px-3 py-1.5 text-sm font-medium text-amber-900 transition-colors hover:bg-white dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-900/35"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("chat.interrupted.regenerate")}
          </button>
        )}
      </div>
    );
  }

  const finalContent = message.reasoningContent?.trim() && !/<think>[\s\S]*?<\/think>/i.test(message.content || "")
    ? `<think>${message.reasoningContent}</think>\n\n${message.content || ""}`.trim()
    : message.content;
  const { reasoning, answer, isThinking } = parseThinkContent(finalContent);
  const cleanAnswer = sanitizeContent(answer);
  const elapsedLabel = reasoning ? formatElapsedTime(generationElapsedMs(message, realtime), t) : "";

  return (
    <div className={cn("prose prose-sm max-w-none", className)}>
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
        />
      )}
      <MarkdownRenderer content={cleanAnswer} shouldHydrateRichText={shouldHydrateRichText} priorityHydrateRichText={priorityHydrateRichText} allowRichLiteFallback={allowRichLiteFallback} compactRichLitePreview={compactRichLitePreview} messageId={message.id} />
    </div>
  );
}
