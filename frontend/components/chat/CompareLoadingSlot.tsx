"use client";

import AssistantPendingShell from "./AssistantPendingShell";

export default function CompareLoadingSlot({ isComplexTask, deepReasoningLabel }: { isComplexTask: boolean; deepReasoningLabel: string }) {
  return (
    <AssistantPendingShell
      showAvatar
      compact
      label={isComplexTask ? deepReasoningLabel : "正在生成回答"}
      detail="本列会保持稳定高度，另一列完成也不会挤动布局"
      className="animate-message-appear"
    />
  );
}
