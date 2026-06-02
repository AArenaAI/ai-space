import type { RealtimeData, RuntimePhase } from "./streaming";

export type UserGenerationPhase = "waiting_provider" | "searching" | "reasoning" | "streaming_answer" | "finalizing";

export type GenerationPhaseLike = Pick<
  RealtimeData,
  | "phase"
  | "searchStatus"
  | "isReasoning"
  | "reasoningContent"
  | "answerContent"
  | "content"
  | "completedAt"
  | "activityStatus"
>;

export function normalizeRuntimePhase(phase?: RuntimePhase): UserGenerationPhase | undefined {
  if (phase === "waiting_provider" || phase === "searching" || phase === "reasoning" || phase === "streaming_answer" || phase === "finalizing") {
    return phase;
  }
  if (phase === "thinking") return "reasoning";
  if (phase === "generating") return "streaming_answer";
  if (phase === "starting") return "waiting_provider";
  return undefined;
}

export function deriveUserGenerationPhase(data?: GenerationPhaseLike | null, isStreaming = false): UserGenerationPhase | undefined {
  if (!data && !isStreaming) return undefined;
  if (data?.completedAt) return undefined;

  const explicit = normalizeRuntimePhase(data?.phase);
  if (explicit) return explicit;

  if (data?.searchStatus === "searching" || (data?.activityStatus?.kind === "web_search" && data.activityStatus.status !== "completed")) {
    return "searching";
  }

  if (data?.isReasoning || (data?.reasoningContent !== undefined && !data.answerContent?.trim())) {
    return "reasoning";
  }

  if (data?.answerContent?.trim() || data?.content?.trim()) {
    return "streaming_answer";
  }

  return isStreaming ? "waiting_provider" : undefined;
}

export function formatElapsedTime(
  elapsedMs: number,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return t("time.duration.seconds", { seconds: String(seconds) });
  return t("time.duration.minutesSeconds", {
    minutes: String(minutes),
    seconds: seconds.toString().padStart(2, "0"),
  });
}

export function getGenerationPhaseLabel(t: (key: string, params?: Record<string, string>) => string, phase: UserGenerationPhase): string {
  return t(`chat.phase.${phase}`);
}

export function getGenerationPhaseWithElapsedLabel(
  t: (key: string, params?: Record<string, string>) => string,
  phase: UserGenerationPhase,
  elapsedMs: number
): string {
  return t("chat.phase.withElapsed", {
    status: getGenerationPhaseLabel(t, phase),
    elapsed: formatElapsedTime(elapsedMs, t),
  });
}
