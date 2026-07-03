"use client";

import { memo } from "react";
import { X } from "lucide-react";
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
    <div className="relative z-[90] w-full shrink-0 bg-surface/80 px-4 py-1 backdrop-blur" data-testid="chat-compare-header">
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 items-center gap-5 lg:grid-cols-2 lg:gap-8 xl:gap-10">
        {compareModels.map((modelId, colIndex) => (
          <div key={modelId || colIndex} className="flex min-w-0">
            <ChatCompareModelHeader
              modelId={modelId}
              index={colIndex}
              models={models}
              selectedModel={modelById.get(modelId)}
              onModelChange={onModelChange}
            />
          </div>
        ))}
      </div>
      {onExitCompare && (
        <button
          type="button"
          onClick={() => onExitCompare()}
          className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
          aria-label={closeLabel}
          data-testid="chat-compare-exit-center"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {onActivityLayoutChange && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2">
          <ChatCompareActivityLayoutControl value={activityLayout} onChange={onActivityLayoutChange} />
        </div>
      )}
    </div>
  );
}

export default memo(ChatCompareHeader);
