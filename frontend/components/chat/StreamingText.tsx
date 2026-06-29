"use client";

import { useState } from "react";
import { ChevronDown, Lightbulb } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";
import { useMessageStream } from "@/hooks/useMessageStream";
import { useSmoothStreaming } from "@/hooks/useSmoothStreaming";
import StreamingMarkdownView from "./StreamingMarkdownView";

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

function buildCanonicalReasoningContent(content: string, reasoningContent?: string) {
  if (!reasoningContent?.trim()) return content;
  if (/<think>[\s\S]*?<\/think>/i.test(content || "")) return content;
  return `<think>${reasoningContent}</think>\n\n${content || ""}`.trim();
}

export function StreamingText({
  messageId,
  content,
  reasoningContent,
  isStreaming,
  className,
  as = "div",
}: {
  messageId: string;
  content: string;
  reasoningContent?: string;
  isStreaming: boolean;
  className?: string;
  as?: "div" | "span";
}) {
  const { t } = useI18n();
  const realtime = useMessageRealtime(messageId);
  const streamText = useMessageStream(messageId, isStreaming);
  const canonicalContent = buildCanonicalReasoningContent(content, reasoningContent);
  const canUseRealtime = isStreaming || !!realtime?.completedAt;
  const effectiveText = canUseRealtime ? (streamText || realtime?.content || canonicalContent) : canonicalContent;
  const hasSplitRealtime = canUseRealtime && !!realtime && (realtime.answerContent !== undefined || realtime.reasoningContent !== undefined);
  const legacyParsed = parseThinkContent(effectiveText);
  const splitAnswerParsed = parseThinkContent(realtime?.answerContent || "");
  const hasThinkTag = effectiveText.includes("<think>") || !!realtime?.answerContent?.includes("<think>");
  const fullParsed = hasSplitRealtime
    ? {
        reasoning: realtime?.reasoningContent?.trim() ? realtime.reasoningContent : (legacyParsed.reasoning || splitAnswerParsed.reasoning),
        answer: splitAnswerParsed.answer.trim() ? splitAnswerParsed.answer : legacyParsed.answer,
        isThinking: !!realtime?.isReasoning || legacyParsed.isThinking || splitAnswerParsed.isThinking,
      }
    : legacyParsed;
  const shouldAnimateText = isStreaming && !hasThinkTag && !hasSplitRealtime;
  const shouldAnimateSplit = isStreaming && (hasThinkTag || hasSplitRealtime);
  const isFinalizingRealtime = !isStreaming && !!realtime?.completedAt;
  const stableMarkdownStreamingMode = isStreaming || isFinalizingRealtime;
  const displayedText = useSmoothStreaming(effectiveText, shouldAnimateText, `${messageId}:full`);
  const displayedReasoning = useSmoothStreaming(fullParsed.reasoning || "", shouldAnimateSplit, `${messageId}:reasoning`);
  const displayedAnswer = useSmoothStreaming(fullParsed.answer, shouldAnimateSplit, `${messageId}:answer`);


  // 含 <think> 的消息必须用完整实时内容解析边界，不能先做整段打字机截断；
  // 否则 </think> 尚未显示时正文会被临时归入思考块。
  // 解析出 reasoning / answer 后分别做打字机，让思考块和正文都逐字显示。
  const parsed = hasThinkTag || hasSplitRealtime
    ? { ...fullParsed, reasoning: fullParsed.reasoning === null ? null : displayedReasoning, answer: displayedAnswer }
    : parseThinkContent(displayedText);
  const hasReason = !!parsed.reasoning;
  const hasContent = !!parsed.answer.trim();
  const Host = as;
  const [reasoningExpanded, setReasoningExpanded] = useState(true);

  return (
    <Host className={className}>
      {hasReason && (
        <div className="mb-2">
          <button
            type="button"
            aria-expanded={reasoningExpanded}
            onClick={() => setReasoningExpanded((value) => !value)}
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-text-tertiary transition-colors hover:bg-surface-card/45 hover:text-text-secondary"
          >
            <Lightbulb className="h-3 w-3 shrink-0 text-text-tertiary" />
            <span className="text-xs font-medium">{t("chat.reasoning.thinking")}</span>
            <div className="ml-0.5 flex gap-0.5">
              <div className="h-1 w-1 animate-bounce rounded-full bg-text-tertiary" />
              <div className="h-1 w-1 animate-bounce rounded-full bg-text-tertiary [animation-delay:0.15s]" />
              <div className="h-1 w-1 animate-bounce rounded-full bg-text-tertiary [animation-delay:0.3s]" />
            </div>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-text-tertiary/80 transition-transform duration-300 ease-out ${reasoningExpanded ? "rotate-180" : "rotate-0"}`}
            />
          </button>
          <div
            aria-hidden={!reasoningExpanded}
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${reasoningExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
          >
            <div className="min-h-0 overflow-hidden">
              <div
                data-i18n-skip="true"
                className={`reasoning-markdown relative ml-2 mt-1 border-l border-surface-border py-1.5 pl-3 pr-1 text-text-secondary transition-[transform,filter] duration-300 ease-out ${reasoningExpanded ? "translate-y-0 blur-0" : "-translate-y-1 blur-[1px]"}`}
              >
                <StreamingMarkdownView content={parsed.reasoning || ""} idleTimeout={80} keepRenderedOnContentChange isStreaming={stableMarkdownStreamingMode} />
              </div>
            </div>
          </div>
        </div>
      )}
      {hasContent && (
        <span data-i18n-skip="true" className="streaming-answer-markdown block break-words">
          <StreamingMarkdownView content={parsed.answer} idleTimeout={80} keepRenderedOnContentChange isStreaming={stableMarkdownStreamingMode} />
        </span>
      )}
      {!hasContent && !hasReason && (
        <span className="block h-0 overflow-hidden" data-chat-empty-streaming-placeholder="true" aria-hidden="true" />
      )}
      {isStreaming && (hasContent || hasReason) && <StreamingCursor />}
    </Host>
  );
}
