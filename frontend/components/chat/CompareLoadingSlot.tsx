"use client";

import AssistantPendingShell from "./AssistantPendingShell";

export default function CompareLoadingSlot({ isComplexTask, deepReasoningLabel }: { isComplexTask: boolean; deepReasoningLabel: string }) {
  return (
    <AssistantPendingShell
      showAvatar
      compact
      label={isComplexTask ? deepReasoningLabel : "正在生成回答"}
      className="animate-message-appear"
    />
  );
}
