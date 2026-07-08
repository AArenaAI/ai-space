"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useMessageRealtime } from "@/hooks/useMessageRealtime";
import { useMessageStream } from "@/hooks/useMessageStream";
import { useSmoothStreaming } from "@/hooks/useSmoothStreaming";
import StreamingMarkdownView from "./StreamingMarkdownView";
import { formatElapsedTime } from "@/lib/chatGenerationPhase";
import AssistantGenerationFrame from "./AssistantGenerationFrame";
import { ACTIVE_GENERATION_STATUS_SLOT_INNER_CLASS, ACTIVE_GENERATION_STATUS_SLOT_MIN_HEIGHT, type AssistantGenerationPhase } from "@/lib/chatGenerationState";

function StreamingCursor() {
  return <span className="inline-block w-[2px] h-[1.2em] bg-brand ml-0.5 animate-cursor-blink align-middle" />;
}

function PendingStatusDot() {
  return (
    <span
      className="inline-flex h-3.5 w-3.5 shrink-0 animate-pulse rounded-full"
      style={{
        backgroundColor: "color-mix(in srgb, var(--text-secondary) 60%, var(--text-primary) 40%)",
        boxShadow: "0 0 12px color-mix(in srgb, var(--text-secondary) 38%, transparent)",
      }}
      data-chat-pending-shell="true"
      data-chat-pending-compact="true"
      data-chat-pending-dot-core="true"
      aria-label="正在生成"
    />
  );
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

function normalizeVisibleAnswer(content: string | undefined | null, reasoningContent?: string) {
  const parsed = parseThinkContent(buildCanonicalReasoningContent(content || "", reasoningContent));
  return parsed.answer.replace(/\s+/g, " ").trim();
}

function generationElapsedMs(realtime: ReturnType<typeof useMessageRealtime>) {
  const start = realtime?.generationStartedAt || realtime?.updatedAt;
  const end = realtime?.completedAt || Date.now();
  return start ? Math.max(0, end - start) : 0;
}

function nowMs() {
  return Date.now();
}

export function StreamingText({
  messageId,
  content,
  reasoningContent,
  isStreaming,
  preferCanonicalContent = false,
  className,
  as = "div",
  onOpenActivity,
  runtimePhase,
  isGenerating = isStreaming,
}: {
  messageId: string;
  content: string;
  reasoningContent?: string;
  isStreaming: boolean;
  preferCanonicalContent?: boolean;
  className?: string;
  as?: "div" | "span";
  onOpenActivity?: () => void;
  runtimePhase?: AssistantGenerationPhase;
  isGenerating?: boolean;
}) {
  const { t } = useI18n();
  const realtime = useMessageRealtime(messageId);
  const streamText = useMessageStream(messageId, isStreaming);
  const canonicalContent = buildCanonicalReasoningContent(content, reasoningContent);
  const canUseRealtime = !preferCanonicalContent && (isStreaming || !!realtime?.completedAt);
  const realtimeCandidate = streamText || realtime?.content || "";
  const realtimeMatchesCanonical = !!realtimeCandidate && normalizeVisibleAnswer(realtimeCandidate, realtime?.reasoningContent) === normalizeVisibleAnswer(canonicalContent);
  const effectiveText = preferCanonicalContent
    ? canonicalContent
    : canUseRealtime ? (realtimeCandidate || canonicalContent) : canonicalContent;
  const usingCanonicalContent = preferCanonicalContent;
  const answerContentSource = usingCanonicalContent ? "canonical" : canUseRealtime && realtimeCandidate ? "realtime" : "canonical";
  const hasSplitRealtime = !usingCanonicalContent && canUseRealtime && !!realtime && (realtime.answerContent !== undefined || realtime.reasoningContent !== undefined);
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
  const stableMarkdownStreamingMode = isStreaming;
  const displayedText = useSmoothStreaming(effectiveText, shouldAnimateText, `${messageId}:full`, { immediateWhenStopped: preferCanonicalContent });
  const displayedReasoning = useSmoothStreaming(fullParsed.reasoning || "", shouldAnimateSplit, `${messageId}:reasoning`, { immediateWhenStopped: preferCanonicalContent });
  const displayedAnswer = useSmoothStreaming(fullParsed.answer, shouldAnimateSplit, `${messageId}:answer`, { immediateWhenStopped: preferCanonicalContent });


  // 含 <think> 的消息必须用完整实时内容解析边界，不能先做整段打字机截断；
  // 否则 </think> 尚未显示时正文会被临时归入思考块。
  // 解析出 reasoning / answer 后分别做打字机，让思考块和正文都逐字显示。
  const parsed = hasThinkTag || hasSplitRealtime
    ? { ...fullParsed, reasoning: fullParsed.reasoning === null ? null : displayedReasoning, answer: displayedAnswer }
    : parseThinkContent(displayedText);
  const rawHasReason = !!(realtime?.reasoningContent?.trim() || fullParsed.reasoning?.trim());
  const rawHasContent = !!(realtime?.answerContent?.trim() || fullParsed.answer.trim());
  const hasReason = !!parsed.reasoning;
  const hasContent = !!parsed.answer.trim();
  const Host = as;
  const showInitialReasoningStatus = isGenerating && !rawHasContent && !rawHasReason;
  const generationPhase: AssistantGenerationPhase = runtimePhase && runtimePhase !== "empty"
    ? runtimePhase
    : (showInitialReasoningStatus
      ? "pending"
      : isGenerating && (rawHasContent || realtime?.phase === "streaming_answer")
        ? "answering"
        : isGenerating && (rawHasReason || realtime?.isReasoning || realtime?.phase === "reasoning" || realtime?.phase === "thinking")
          ? "reasoning"
          : rawHasContent || rawHasReason || hasContent || hasReason
            ? "completed"
            : "empty");
  const showReasoningStatus = hasReason || ((generationPhase === "reasoning" || generationPhase === "answering") && !hasContent);
  const showPendingStatus = !showReasoningStatus
    && (generationPhase === "pending" || (isGenerating && !hasContent && !hasReason && generationPhase !== "reasoning" && generationPhase !== "answering"))
    && !hasContent
    && !hasReason;
  const visiblePhaseRef = useRef<{ phase: AssistantGenerationPhase; startedAt: number }>({ phase: generationPhase, startedAt: nowMs() });
  if (visiblePhaseRef.current.phase !== generationPhase) {
    visiblePhaseRef.current = { phase: generationPhase, startedAt: nowMs() };
  }
  const [elapsedNow, setElapsedNow] = useState(() => nowMs());
  useEffect(() => {
    if (!showReasoningStatus || !isGenerating) return;
    const timer = window.setInterval(() => setElapsedNow(nowMs()), 250);
    return () => window.clearInterval(timer);
  }, [isGenerating, messageId, showReasoningStatus]);
  const visibleElapsedMs = Math.max(0, elapsedNow - visiblePhaseRef.current.startedAt);
  const elapsedLabel = showReasoningStatus
    ? isGenerating
      ? visibleElapsedMs >= 1000 ? formatElapsedTime(visibleElapsedMs, t) : ""
      : hasReason ? formatElapsedTime(generationElapsedMs(realtime), t) : ""
    : "";
  const reasoningLabel = isStreaming && (parsed.isThinking || generationPhase === "reasoning") ? "思考中" : "已思考";

  return (
    <Host className={className}>
      <AssistantGenerationFrame phase={generationPhase}>
        {showReasoningStatus && (
          <div className={ACTIVE_GENERATION_STATUS_SLOT_INNER_CLASS} style={{ minHeight: ACTIVE_GENERATION_STATUS_SLOT_MIN_HEIGHT }} data-chat-stream-reasoning-slot="true">
            <button
              type="button"
              aria-expanded={false}
              onClick={() => onOpenActivity?.()}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-text-tertiary transition-colors hover:bg-surface-card/45 hover:text-text-secondary"
            >
              <span className="text-xs font-medium">{reasoningLabel}{elapsedLabel ? ` · ${elapsedLabel}` : ""}</span>
              <ChevronDown
                className="h-3.5 w-3.5 -rotate-90 shrink-0 text-text-tertiary/80"
              />
            </button>

          </div>
        )}
        {hasContent && (
          <span
            data-i18n-skip="true"
            data-chat-answer-stable-layer="true"
            data-chat-stream-content-slot="true"
            data-chat-answer-content-source={answerContentSource}
            data-chat-answer-canonical-match={preferCanonicalContent ? String(realtimeMatchesCanonical) : undefined}
            className="streaming-answer-markdown block break-words"
          >
            <StreamingMarkdownView content={parsed.answer} idleTimeout={80} keepRenderedOnContentChange={!preferCanonicalContent} isStreaming={stableMarkdownStreamingMode} />
          </span>
        )}
        {showPendingStatus && (
          <div className={ACTIVE_GENERATION_STATUS_SLOT_INNER_CLASS} style={{ minHeight: ACTIVE_GENERATION_STATUS_SLOT_MIN_HEIGHT }} data-chat-initial-reasoning-status="true" data-chat-stream-reasoning-slot="true">
            <button
              type="button"
              aria-expanded={false}
              onClick={() => onOpenActivity?.()}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-text-tertiary transition-colors hover:bg-surface-card/45 hover:text-text-secondary"
            >
              <PendingStatusDot />
            </button>
          </div>
        )}
        {!hasContent && !hasReason && !showPendingStatus && !showReasoningStatus && (
          <span className="block h-0 overflow-hidden" data-chat-empty-streaming-placeholder="true" aria-hidden="true" />
        )}
      </AssistantGenerationFrame>
      {generationPhase === "answering" && hasContent && <StreamingCursor />}
    </Host>
  );
}
