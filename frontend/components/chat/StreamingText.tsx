"use client";

import { Lightbulb } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";
import { useMessageStream } from "@/hooks/useMessageStream";
import { useSmoothStreaming } from "@/hooks/useSmoothStreaming";

function ThinkingDots() {
  return (
    <span className="inline-flex items-center">
      <span className="animate-bounce [animation-delay:0s]">.</span>
      <span className="animate-bounce [animation-delay:0.2s]">.</span>
      <span className="animate-bounce [animation-delay:0.4s]">.</span>
    </span>
  );
}

function StreamingCursor() {
  return <span className="inline-block w-[2px] h-[1.2em] bg-brand ml-0.5 animate-cursor-blink align-middle" />;
}

function parseThinkContent(content: string): { reasoning: string | null; answer: string; isThinking: boolean } {
  const startIdx = content.indexOf("<think>");
  if (startIdx === -1) return { reasoning: null, answer: content, isThinking: false };

  const endIdx = content.indexOf("</think>");
  if (endIdx === -1) {
    return {
      reasoning: content.slice(startIdx + 7),
      answer: content.slice(0, startIdx),
      isThinking: true,
    };
  }

  return {
    reasoning: content.slice(startIdx + 7, endIdx).trim(),
    answer: (content.slice(0, startIdx) + content.slice(endIdx + 8)).trim(),
    isThinking: false,
  };
}

export function StreamingText({
  messageId,
  content,
  isStreaming,
  className,
  as = "div",
}: {
  messageId: string;
  content: string;
  isStreaming: boolean;
  className?: string;
  as?: "div" | "span";
}) {
  const { t } = useI18n();
  const realtime = useMessageRealtime(isStreaming ? messageId : "");
  const streamText = useMessageStream(messageId, isStreaming);
  const effectiveText = isStreaming ? (streamText || content) : content;
  const hasSplitRealtime = isStreaming && !!realtime && (realtime.answerContent !== undefined || realtime.reasoningContent !== undefined);
  const hasThinkTag = !hasSplitRealtime && effectiveText.includes("<think>");
  const fullParsed = hasSplitRealtime
    ? {
        reasoning: realtime?.reasoningContent || null,
        answer: realtime?.answerContent ?? effectiveText,
        isThinking: !!realtime?.isReasoning,
      }
    : parseThinkContent(effectiveText);
  const displayedText = useSmoothStreaming(effectiveText, isStreaming && !hasThinkTag && !hasSplitRealtime, `${messageId}:full`);
  const displayedReasoning = useSmoothStreaming(fullParsed.reasoning || "", isStreaming && (hasThinkTag || hasSplitRealtime), `${messageId}:reasoning`);
  const displayedAnswer = useSmoothStreaming(fullParsed.answer, isStreaming && (hasThinkTag || hasSplitRealtime), `${messageId}:answer`);

  // 含 <think> 的消息必须用完整实时内容解析边界，不能先做整段打字机截断；
  // 否则 </think> 尚未显示时正文会被临时归入思考块。
  // 解析出 reasoning / answer 后分别做打字机，让思考块和正文都逐字显示。
  const parsed = hasThinkTag || hasSplitRealtime
    ? { ...fullParsed, reasoning: fullParsed.reasoning === null ? null : displayedReasoning, answer: displayedAnswer }
    : parseThinkContent(displayedText);
  const hasReason = !!parsed.reasoning;
  const hasContent = !!parsed.answer.trim();
  const Host = as;

  return (
    <Host className={className}>
      {hasReason && (
        <div className="mb-3 rounded-xl border border-purple-200 dark:border-purple-800/40 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 dark:bg-[#1A1A2E]">
            <Lightbulb className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
            <span className="text-sm font-medium text-text-secondary">{t("chat.reasoning.thinking")}</span>
            <div className="flex gap-0.5 ml-1">
              <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce" />
              <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce [animation-delay:0.15s]" />
              <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce [animation-delay:0.3s]" />
            </div>
          </div>
          <div data-i18n-skip="true" className="px-3 py-2.5 text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap bg-slate-50 dark:bg-[#0F0F1A]">
            {parsed.reasoning || ""}
          </div>
        </div>
      )}
      <span data-i18n-skip="true" className="whitespace-pre-wrap break-words">{parsed.answer}</span>
      {!hasContent && !hasReason && <ThinkingDots />}
      {isStreaming && <StreamingCursor />}
    </Host>
  );
}
