"use client";

import { useState } from "react";
import { ChevronDown, Lightbulb } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";
import { useMessageStream } from "@/hooks/useMessageStream";
import { useSmoothStreaming } from "@/hooks/useSmoothStreaming";
import StreamingMarkdownView from "./StreamingMarkdownView";

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
  const hasThinkTag = !hasSplitRealtime && effectiveText.includes("<think>");
  const fullParsed = hasSplitRealtime
    ? {
        reasoning: realtime?.reasoningContent ?? null,
        answer: realtime?.answerContent ?? effectiveText,
        isThinking: !!realtime?.isReasoning,
      }
    : parseThinkContent(effectiveText);
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
        <div className="mb-3 rounded-xl border border-purple-200 dark:border-purple-800/40 overflow-hidden">
          <button
            type="button"
            aria-expanded={reasoningExpanded}
            onClick={() => setReasoningExpanded((value) => !value)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors bg-purple-50 hover:bg-purple-100 dark:bg-[#1A1A2E] dark:hover:bg-[#252542]"
          >
            <Lightbulb className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
            <span className="text-sm font-medium text-text-secondary flex-1">{t("chat.reasoning.thinking")}</span>
            <div className="flex gap-0.5 ml-1">
              <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce" />
              <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce [animation-delay:0.15s]" />
              <div className="w-1 h-1 rounded-full bg-amber-500 dark:bg-amber-400 animate-bounce [animation-delay:0.3s]" />
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 text-text-tertiary shrink-0 transition-transform duration-300 ease-out ${reasoningExpanded ? "rotate-180" : "rotate-0"}`}
            />
          </button>
          <div
            aria-hidden={!reasoningExpanded}
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${reasoningExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
          >
            <div className="min-h-0 overflow-hidden">
              <div
                data-i18n-skip="true"
                className={`reasoning-markdown relative px-3 py-2.5 bg-slate-50 dark:bg-[#0F0F1A] transition-[transform,filter] duration-300 ease-out ${reasoningExpanded ? "translate-y-0 blur-0" : "-translate-y-1 blur-[1px]"}`}
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
      {!hasContent && !hasReason && <ThinkingDots />}
      {isStreaming && <StreamingCursor />}
    </Host>
  );
}
