"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Message } from "@/lib/chatTypes";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { isMessageGenerating, parseThinkContent, sanitizeContent } from "@/lib/chatContent";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";
import { StreamingText } from "./StreamingText";
import { ThinkBlock } from "./ThinkBlock";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";
import { formatElapsedTime } from "@/lib/chatGenerationPhase";
import { isTerminalMessage, resolveChatMessageRuntimeState, type ChatMessageRuntimeState } from "@/lib/chatMessageRuntimeState";
import { getAssistantFailureCopy, isAssistantFailureState } from "@/lib/chatErrorState";

type MarkdownRendererComponent = ComponentType<{ content: string; shouldHydrateRichText?: boolean; priorityHydrateRichText?: boolean; allowRichLiteFallback?: boolean; compactRichLitePreview?: boolean; messageId?: string | number }>;

const JUST_COMPLETED_REASONING_EXPAND_MS = 5 * 60 * 1000;
const JUST_COMPLETED_STREAMING_HOLD_MS = 800;

function AssistantInlineError({ message, onRegenerate, t }: { message: Message; onRegenerate?: () => void; t: (key: string, params?: Record<string, string>) => string }) {
  const copy = getAssistantFailureCopy(message, t) || t("chat.error.genericInline");
  return (
    <div className="my-1 inline-flex max-w-full items-center gap-2 rounded-xl border border-red-500/10 bg-red-500/[0.045] px-3 py-2 text-sm leading-relaxed text-text-secondary dark:bg-red-400/[0.07]">
      <AlertCircle className="h-4 w-4 shrink-0 text-red-500/70" />
      <span className="min-w-0 break-words">{copy}</span>
      {message.retryable !== false && onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-lg border border-surface-border/70 bg-surface-card/70 px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-red-500/20 hover:bg-surface-elevated hover:text-text-primary"
        >
          <RefreshCw className="h-3 w-3" />
          {t("chat.action.regenerate")}
        </button>
      )}
    </div>
  );
}

function mayStillRecoverMessage(msg: Message) {
  return !isTerminalMessage(msg) && !!(
    msg.activityStatus ||
    msg.serverMessageId ||
    msg.generationTaskId ||
    msg.backgroundTaskId ||
    msg.useBackground ||
    msg.isComplexTask
  );
}

function generationElapsedMs(message: Message, runtimeState: ChatMessageRuntimeState) {
  const start = runtimeState.generationStartedAt || message.generationStartedAt || message.createdAt;
  const end = runtimeState.completedAt || Date.now();
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
  inlineActivity,
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
  inlineActivity?: ReactNode;
}) {
  const { t } = useI18n();
  const terminalMessage = isTerminalMessage(message);
  const realtime = useMessageRealtime(message.id, !terminalMessage || isStreaming);
  const runtimeState = resolveChatMessageRuntimeState({ message, realtime });
  const generating = isMessageGenerating({ ...message, ...runtimeState }, isStreaming);
  const realtimeHasVisiblePayload = !!(
    runtimeState.content?.trim() ||
    runtimeState.answerContent?.trim() ||
    runtimeState.reasoningContent?.trim()
  );
  const completedAt = runtimeState.terminalSource === "realtime" ? runtimeState.completedAt : undefined;
  const wasStreamingRef = useRef(false);
  const [keepCompletedStreaming, setKeepCompletedStreaming] = useState(false);
  const [keepReasoningExpanded, setKeepReasoningExpanded] = useState(false);
  const justStoppedStreaming = wasStreamingRef.current && !generating;
  const finalizingRealtime = !runtimeState.terminal && !generating && (justStoppedStreaming || keepCompletedStreaming) && realtimeHasVisiblePayload;
  const shouldRenderStreamingText = generating || finalizingRealtime || (!runtimeState.content && recoverEmptyContent && mayStillRecoverMessage(message));

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
    if (!(generating || finalizingRealtime) || !runtimeState.reasoningContent?.trim()) return;
    setKeepReasoningExpanded(true);
    const timer = window.setTimeout(() => setKeepReasoningExpanded(false), JUST_COMPLETED_REASONING_EXPAND_MS);
    return () => window.clearTimeout(timer);
  }, [finalizingRealtime, generating, message.id, runtimeState.reasoningContent]);

  const failureMessage = { ...message, content: runtimeState.content || message.content, errorCode: runtimeState.errorCode || message.errorCode, phase: runtimeState.phase };
  if (isAssistantFailureState(failureMessage)) {
    return <AssistantInlineError message={failureMessage} onRegenerate={onRegenerate} t={t} />;
  }

  if (shouldRenderStreamingText) {
    return (
      <StreamingText
        messageId={message.id}
        content={runtimeState.content || ""}
        reasoningContent={runtimeState.reasoningContent || undefined}
        isStreaming={generating}
        className="text-[15px] leading-relaxed text-text-primary"
        onOpenActivity={onOpenActivity}
      />
    );
  }

  if (!runtimeState.content) {
    return <AssistantInlineError message={{ ...message, content: "", stopped: true }} onRegenerate={onRegenerate} t={t} />;
  }

  const finalContent = runtimeState.reasoningContent?.trim() && !/<think>[\s\S]*?<\/think>/i.test(runtimeState.content || "")
    ? `<think>${runtimeState.reasoningContent}</think>\n\n${runtimeState.content || ""}`.trim()
    : runtimeState.content;
  const { reasoning, answer, isThinking } = parseThinkContent(finalContent);
  const cleanAnswer = sanitizeContent(answer);
  const elapsedLabel = reasoning ? formatElapsedTime(generationElapsedMs(message, runtimeState), t) : "";

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
          inlineActivity={inlineActivity}
        />
      )}
      <MarkdownRenderer content={cleanAnswer} shouldHydrateRichText={shouldHydrateRichText} priorityHydrateRichText={priorityHydrateRichText} allowRichLiteFallback={allowRichLiteFallback} compactRichLitePreview={compactRichLitePreview} messageId={message.id} />
    </div>
  );
}
