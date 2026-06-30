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
