import type { ChatStatusTimelineStep } from "./chatStatusTimeline";

export function chatActivityStepDuration(step: ChatStatusTimelineStep, now = Date.now()) {
  return Math.max(0, (step.endedAt || now) - step.startedAt);
}

export function isLowSignalCompletedActivityStep(step: ChatStatusTimelineStep, now = Date.now()) {
  const duration = chatActivityStepDuration(step, now);
  if (step.status === "completed" && (step.kind === "streaming_answer" || step.kind === "finalizing" || step.kind === "waiting_provider")) return true;
  if (duration >= 1000) return false;
  return step.kind === "waiting_provider" || step.kind === "finalizing";
}

export function ensureTerminalAnswerStep(options: {
  timeline: ChatStatusTimelineStep[];
  hasAnswer: boolean;
  completedAt?: number;
  generationStartedAt?: number;
}): ChatStatusTimelineStep[] {
  const { timeline, hasAnswer, completedAt, generationStartedAt } = options;
  if (!hasAnswer || !completedAt) return timeline;
  if (timeline.some((step) => step.kind === "streaming_answer")) return timeline;
  const previous = timeline[timeline.length - 1];
  const startedAt = previous?.endedAt || previous?.startedAt || generationStartedAt || completedAt;
  return [
    ...timeline,
    {
      id: "streaming_answer:completed",
      kind: "streaming_answer",
      status: "completed",
      startedAt,
      endedAt: Math.max(startedAt, completedAt),
    },
  ];
}
