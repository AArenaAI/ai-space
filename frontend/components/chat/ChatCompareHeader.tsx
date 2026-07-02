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
    <div className="relative z-[90] flex w-full shrink-0 items-center border-b border-surface-border/45 bg-surface/80 px-4 py-2 backdrop-blur">
      <div className="flex min-w-0 flex-1">
        {compareModels.map((modelId, colIndex) => (
          <div key={modelId || colIndex} className="flex min-w-[280px] flex-1 flex-col">
            <div className="px-3 pb-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-text-tertiary">下一轮模型</div>
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
      {onActivityLayoutChange && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2">
          <ChatCompareActivityLayoutControl value={activityLayout} onChange={onActivityLayoutChange} />
        </div>
      )}
    </div>
  );
}

export default memo(ChatCompareHeader);
