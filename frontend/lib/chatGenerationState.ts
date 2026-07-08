import { parseThinkContent } from "./chatContent";
import type { ChatMessageRuntimeState } from "./chatMessageRuntimeState";
import type { Message } from "./chatTypes";

export type AssistantGenerationPhase = "pending" | "reasoning" | "answering" | "source-only" | "completed" | "failed" | "empty";
export type AssistantGenerationLifecycle = "idle" | "pending" | "searching" | "reasoning" | "answering" | "finalizing" | "settling" | "completed" | "failed" | "stopped";
export type AssistantAnswerRenderState = "pending" | "streaming" | "settling" | "completed-stable" | "hydrated";

export type AssistantGenerationState = {
  lifecycle: AssistantGenerationLifecycle;
  visualPhase: AssistantGenerationPhase;
  isStreaming: boolean;
  isGenerating: boolean;
  isTerminal: boolean;
  canShowActions: boolean;
  shouldShowCursor: boolean;
  shouldShowPendingDot: boolean;
  shouldShowReasoningEntry: boolean;
  shouldShowAnswer: boolean;
  contentSource: "realtime" | "canonical";
};

export const ACTIVE_GENERATION_STATUS_SLOT_MIN_HEIGHT = "3rem";
export const ACTIVE_GENERATION_STATUS_SLOT_INNER_CLASS = "flex items-start pb-2";

export function isActiveGenerationPhase(phase: AssistantGenerationPhase) {
  return phase === "pending" || phase === "reasoning" || phase === "answering" || phase === "source-only";
}

export function shouldSubscribeAssistantRealtime({
  message,
  isLatestAssistant,
}: {
  message: Message;
  isLatestAssistant: boolean;
}) {
  return message.role === "assistant"
    && !(message.completedAt || message.stopped || message.errorCode || message.phase === "completed" || message.phase === "failed" || message.phase === "stopped")
    && (isLatestAssistant || Boolean(message.generationTaskId || message.backgroundTaskId || message.activityStatus));
}

export function isActiveRuntimePhase(phase?: string) {
  return phase === "waiting_provider"
    || phase === "starting"
    || phase === "searching"
    || phase === "reasoning"
    || phase === "thinking"
    || phase === "streaming_answer"
    || phase === "generating"
    || phase === "finalizing";
}

function hasActiveGenerationSignal(message: Message, runtimeState: ChatMessageRuntimeState) {
  return Boolean(
    message.generationTaskId
    || message.backgroundTaskId
    || message.useBackground
    || message.isComplexTask
    || message.serverGenerationStatus === "pending"
    || message.serverGenerationStatus === "running"
    || message.serverGenerationStatus === "streaming"
    || message.serverGenerationStatus === "polling"
    || message.activityStatus
    || runtimeState.activityStatus
    || runtimeState.searchStatus === "searching"
    || isActiveRuntimePhase(message.phase)
    || isActiveRuntimePhase(runtimeState.phase)
  );
}

function resolveLifecycle({
  runtimeState,
  visualPhase,
  isTerminal,
  isGenerating,
}: {
  runtimeState: ChatMessageRuntimeState;
  visualPhase: AssistantGenerationPhase;
  isTerminal: boolean;
  isGenerating: boolean;
}): AssistantGenerationLifecycle {
  if (runtimeState.phase === "failed" || runtimeState.errorCode) return "failed";
  if (runtimeState.phase === "stopped" || runtimeState.stopped) return "stopped";
  if (isTerminal) return "completed";
  if (!isGenerating) return "idle";
  if (runtimeState.phase === "finalizing") return "finalizing";
  if (runtimeState.searchStatus === "searching" || runtimeState.phase === "searching") return "searching";
  if (visualPhase === "answering") return "answering";
  if (visualPhase === "reasoning") return "reasoning";
  return "pending";
}

export function resolveAssistantGenerationState({
  message,
  runtimeState,
  isLoading,
  isLatestAssistant,
}: {
  message: Message;
  runtimeState: ChatMessageRuntimeState;
  isLoading: boolean;
  isLatestAssistant: boolean;
}): AssistantGenerationState {
  const isTerminal = runtimeState.terminal;
  const activeSignal = message.role === "assistant" && !isTerminal && (hasActiveGenerationSignal(message, runtimeState) || (isLatestAssistant && isLoading));
  const isStreaming = Boolean(isLoading && message.role === "assistant" && isLatestAssistant && activeSignal);
  const isGenerating = Boolean(message.role === "assistant" && !isTerminal && (isStreaming || activeSignal));
  const visualPhase = resolveRuntimeGenerationPhase({ generating: isGenerating, runtimeState });
  const hasReasoning = Boolean(runtimeState.reasoningContent?.trim() || parseThinkContent(runtimeState.content || "").reasoning?.trim());
  const hasAnswer = Boolean((runtimeState.answerContent || parseThinkContent(runtimeState.content || "").answer || "").trim());
  const lifecycle = resolveLifecycle({ runtimeState, visualPhase, isTerminal, isGenerating });

  return {
    lifecycle,
    visualPhase,
    isStreaming,
    isGenerating,
    isTerminal,
    canShowActions: !isStreaming && !isGenerating,
    shouldShowCursor: isStreaming && hasAnswer,
    shouldShowPendingDot: visualPhase === "pending" && isGenerating,
    shouldShowReasoningEntry: hasReasoning || visualPhase === "reasoning",
    shouldShowAnswer: hasAnswer || visualPhase === "answering" || isTerminal,
    contentSource: runtimeState.terminalSource === "message" ? "canonical" : "realtime",
  };
}

export function resolveAssistantAnswerRenderState({
  generationState,
  runtimeState,
  shouldRenderStreamingText,
}: {
  generationState: AssistantGenerationState;
  runtimeState: ChatMessageRuntimeState;
  shouldRenderStreamingText: boolean;
}): AssistantAnswerRenderState {
  if (generationState.isGenerating) return "streaming";
  if (shouldRenderStreamingText && runtimeState.terminal) return "settling";
  if (shouldRenderStreamingText) return runtimeState.content?.trim() ? "settling" : "pending";
  if (runtimeState.terminal) return "hydrated";
  return runtimeState.content?.trim() ? "completed-stable" : "pending";
}

export function resolveRuntimeGenerationPhase({
  generating,
  runtimeState,
}: {
  generating: boolean;
  runtimeState: ChatMessageRuntimeState;
}): AssistantGenerationPhase {
  const runningTimelineSteps = runtimeState.statusTimeline?.filter((step) => step.status === "running") || [];
  const hasRunningReasoning = runningTimelineSteps.some((step) => step.kind === "reasoning");
  const hasRunningAnswer = runningTimelineSteps.some((step) => step.kind === "streaming_answer");
  const parsedRuntimeContent = parseThinkContent(runtimeState.content || "");
  const hasReasoning = Boolean(runtimeState.reasoningContent?.trim() || parsedRuntimeContent.reasoning?.trim())
    || runtimeState.phase === "reasoning"
    || runtimeState.phase === "thinking"
    || hasRunningReasoning;
  const hasAnswerText = Boolean((runtimeState.answerContent || parsedRuntimeContent.answer || "").trim());
  const hasAnswer = hasAnswerText || runtimeState.phase === "streaming_answer" || (hasAnswerText && hasRunningAnswer);

  if (generating) {
    if (hasAnswer) return "answering";
    if (hasReasoning) return "reasoning";
    return "pending";
  }
  if (runtimeState.terminal || hasReasoning || hasAnswer) return "completed";
  return "empty";
}
