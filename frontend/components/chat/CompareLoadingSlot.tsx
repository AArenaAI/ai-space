"use client";

import AssistantPendingShell from "./AssistantPendingShell";

export default function CompareLoadingSlot({ isComplexTask, deepReasoningLabel }: { isComplexTask: boolean; deepReasoningLabel: string }) {
  void isComplexTask;
  void deepReasoningLabel;
  return (
    <AssistantPendingShell
      showAvatar
      compact
      className="animate-message-appear"
    />
  );
}
