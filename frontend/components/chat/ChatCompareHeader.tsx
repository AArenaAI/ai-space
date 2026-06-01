"use client";

import { memo } from "react";
import type { ChatModel } from "@/lib/chatTypes";
import ChatCompareModelHeader from "./ChatCompareModelHeader";

export type ChatCompareHeaderProps = {
  compareModels: string[];
  models: ChatModel[];
  modelById: Map<string, ChatModel>;
  closeLabel: string;
  onModelChange?: (index: number, modelId: string) => void;
  onExitCompare?: () => void;
};

function ChatCompareHeader({
  compareModels,
  models,
  modelById,
  closeLabel,
  onModelChange,
  onExitCompare,
}: ChatCompareHeaderProps) {
  return (
    <div className="flex w-full shrink-0">
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
  );
}

export default memo(ChatCompareHeader);
