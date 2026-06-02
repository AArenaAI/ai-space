"use client";

import { useEffect } from "react";
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

type MarkdownRendererComponent = ComponentType<{ content: string }>;

const JUST_COMPLETED_REASONING_EXPAND_MS = 5 * 60 * 1000;
const justCompletedReasoningMessageIds = new Map<string, number>();

function markJustCompletedReasoningMessage(messageId: string) {
  justCompletedReasoningMessageIds.set(messageId, Date.now() + JUST_COMPLETED_REASONING_EXPAND_MS);
}

function shouldKeepJustCompletedReasoningExpanded(messageId: string) {
  const expiresAt = justCompletedReasoningMessageIds.get(messageId);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    justCompletedReasoningMessageIds.delete(messageId);
    return false;
  }
  return true;
}

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

export function AssistantMessageContent({
  message,
  isStreaming,
  className,
  MarkdownRenderer = DeferredMarkdownRenderer,
  recoverEmptyContent = false,
  onRegenerate,
}: {
  message: Message;
  isStreaming: boolean;
  className?: string;
  MarkdownRenderer?: MarkdownRendererComponent;
  recoverEmptyContent?: boolean;
  onRegenerate?: () => void;
}) {
  const { t } = useI18n();
  const realtime = useMessageRealtime(message.id);
  const generating = isMessageGenerating(message, isStreaming);
  const realtimeHasVisiblePayload = !!(
    realtime?.content?.trim() ||
    realtime?.answerContent?.trim() ||
    realtime?.reasoningContent?.trim()
  );
  const finalizingRealtime = !generating && !!realtime?.completedAt && realtimeHasVisiblePayload;

  useEffect(() => {
    if ((generating || finalizingRealtime) && (realtime?.reasoningContent?.trim() || message.reasoningContent?.trim())) {
      markJustCompletedReasoningMessage(message.id);
    }
  }, [finalizingRealtime, generating, message.id, message.reasoningContent, realtime?.reasoningContent]);

  if (generating || finalizingRealtime || (!message.content && recoverEmptyContent && mayStillRecoverMessage(message))) {
    return (
      <StreamingText
        messageId={message.id}
        content={message.content || ""}
        reasoningContent={message.reasoningContent}
        isStreaming={generating}
        className="text-[15px] leading-relaxed text-text-primary"
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
  const keepReasoningExpanded = shouldKeepJustCompletedReasoningExpanded(message.id);

  return (
    <div className={cn("prose prose-sm max-w-none", className)}>
      {reasoning && <ThinkBlock content={reasoning} isThinking={isThinking} defaultExpanded={keepReasoningExpanded} />}
      <MarkdownRenderer content={cleanAnswer} />
    </div>
  );
}
