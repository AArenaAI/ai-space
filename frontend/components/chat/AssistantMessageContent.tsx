"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { AlertCircle, ChevronDown, RefreshCw } from "lucide-react";
import { Message } from "@/lib/chatTypes";
import { useI18n } from "@/lib/i18n";
import { isMessageGenerating } from "@/lib/chatContent";
import { DeferredMarkdownRenderer } from "./DeferredMarkdownRenderer";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";
import { isTerminalMessage, resolveChatMessageRuntimeState, type ChatMessageRuntimeState } from "@/lib/chatMessageRuntimeState";
import { getAssistantFailureCopy, isAssistantFailureState } from "@/lib/chatErrorState";
import { AssistantAnswerRenderer } from "./AssistantAnswerRenderer";
import { normalizeSearchSources } from "@/lib/searchSources";


type MarkdownRendererComponent = ComponentType<{ content: string; shouldHydrateRichText?: boolean; priorityHydrateRichText?: boolean; allowRichLiteFallback?: boolean; compactRichLitePreview?: boolean; messageId?: string | number }>;

const JUST_COMPLETED_REASONING_EXPAND_MS = 5 * 60 * 1000;
const JUST_COMPLETED_STREAMING_HOLD_MS = 800;
const JUST_COMPLETED_VISUAL_STABLE_MS = 2500;

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

function FailureActivityEntry({ sourceCount, onOpenActivity, inlineActivity }: { sourceCount: number; onOpenActivity?: () => void; inlineActivity?: ReactNode }) {
  if (!sourceCount || !onOpenActivity) return null;
  return (
    <div className="mt-1 mb-2">
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
  const [keepCompletedVisualStable, setKeepCompletedVisualStable] = useState(false);
  const [keepReasoningExpanded, setKeepReasoningExpanded] = useState(false);
  const hasRenderedStableAnswerLayerRef = useRef(false);
  const justStoppedStreaming = wasStreamingRef.current && !generating;
  const finalizingRealtime = !runtimeState.terminal && !generating && (justStoppedStreaming || keepCompletedStreaming) && realtimeHasVisiblePayload;
  const stableCompletedVisual = keepCompletedVisualStable && realtimeHasVisiblePayload && runtimeState.terminal;
  const rawShouldRenderStreamingText = generating || finalizingRealtime || stableCompletedVisual || (!runtimeState.content && recoverEmptyContent && mayStillRecoverMessage(message));
  if (rawShouldRenderStreamingText && (realtimeHasVisiblePayload || generating)) {
    hasRenderedStableAnswerLayerRef.current = true;
  }
  const preserveCompletedStableLayer = hasRenderedStableAnswerLayerRef.current && runtimeState.terminal && Boolean(runtimeState.content?.trim() || runtimeState.answerContent?.trim());
  const shouldRenderStreamingText = rawShouldRenderStreamingText || preserveCompletedStableLayer;

  useEffect(() => {
    if (!completedAt || !realtimeHasVisiblePayload) return;
    setKeepCompletedStreaming(true);
    setKeepCompletedVisualStable(true);
    const timer = window.setTimeout(() => setKeepCompletedStreaming(false), JUST_COMPLETED_STREAMING_HOLD_MS);
    const stableTimer = window.setTimeout(() => setKeepCompletedVisualStable(false), JUST_COMPLETED_VISUAL_STABLE_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(stableTimer);
    };
  }, [completedAt, realtimeHasVisiblePayload]);

  useEffect(() => {
    let timer: number | undefined;
    let stableTimer: number | undefined;
    if (wasStreamingRef.current && !generating) {
      setKeepCompletedStreaming(true);
      setKeepCompletedVisualStable(true);
      timer = window.setTimeout(() => setKeepCompletedStreaming(false), JUST_COMPLETED_STREAMING_HOLD_MS);
      stableTimer = window.setTimeout(() => setKeepCompletedVisualStable(false), JUST_COMPLETED_VISUAL_STABLE_MS);
    }
    wasStreamingRef.current = generating;
    return () => {
      if (timer) window.clearTimeout(timer);
      if (stableTimer) window.clearTimeout(stableTimer);
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
    const sourceCount = normalizeSearchSources(runtimeState.searchSources).length || runtimeState.searchSourcesCount || 0;
    return (
      <>
        <AssistantInlineError message={failureMessage} onRegenerate={onRegenerate} t={t} />
        <FailureActivityEntry sourceCount={sourceCount} onOpenActivity={onOpenActivity} inlineActivity={inlineActivity} />
      </>
    );
  }

  if (!shouldRenderStreamingText && !runtimeState.content) {
    return <AssistantInlineError message={{ ...message, content: "", stopped: true }} onRegenerate={onRegenerate} t={t} />;
  }

  return (
    <AssistantAnswerRenderer
      message={message}
      runtimeState={runtimeState}
      generating={generating}
      shouldRenderStreamingText={shouldRenderStreamingText}
      keepReasoningExpanded={keepReasoningExpanded}
      className={className}
      MarkdownRenderer={MarkdownRenderer}
      shouldHydrateRichText={shouldHydrateRichText}
      priorityHydrateRichText={priorityHydrateRichText}
      allowRichLiteFallback={allowRichLiteFallback}
      compactRichLitePreview={compactRichLitePreview}
      onOpenActivity={onOpenActivity}
      inlineActivity={inlineActivity}
      t={t}
    />
  );
}
