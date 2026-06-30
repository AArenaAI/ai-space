"use client";

import { memo } from "react";
import type { ChatModel } from "@/lib/chatTypes";
import ChatCompareModelHeader from "./ChatCompareModelHeader";
import ChatCompareActivityLayoutControl, { type CompareActivityLayout } from "./ChatCompareActivityLayoutControl";

export type ChatCompareHeaderProps = {
  compareModels: string[];
  models: ChatModel[];
  modelById: Map<string, ChatModel>;
  closeLabel: string;
  onModelChange?: (index: number, modelId: string) => void;
  onExitCompare?: () => void;
  activityLayout?: CompareActivityLayout;
  onActivityLayoutChange?: (layout: CompareActivityLayout) => void;
};

function ChatCompareHeader({
  compareModels,
  models,
  modelById,
  closeLabel,
  onModelChange,
  onExitCompare,
  activityLayout = "inline",
  onActivityLayoutChange,
}: ChatCompareHeaderProps) {
  return (
    <div className="flex w-full shrink-0 flex-col gap-2 border-b border-surface-border/45 bg-surface/80 px-4 py-2 backdrop-blur">
      <div className="flex items-center justify-end">
        {onActivityLayoutChange && (
          <ChatCompareActivityLayoutControl value={activityLayout} onChange={onActivityLayoutChange} />
        )}
      </div>
      <div className="flex w-full">
      {compareModels.map((modelId, colIndex) => (
        <div key={modelId || colIndex} className="flex min-w-[320px] flex-1 flex-col">
          <ChatCompareModelHeader
            modelId={modelId}
            index={colIndex}
            models={models}
            selectedModel={modelById.get(modelId)}
            closeLabel={closeLabel}
            onModelChange={onModelChange}
            onExitCompare={onExitCompare}
          />
        </div>
      ))}
      </div>
    </div>
  );
}

export default memo(ChatCompareHeader);
