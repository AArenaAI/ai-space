"use client";

import { memo } from "react";
import { useI18n } from "@/lib/i18n";
import type { ChatModel } from "@/lib/chatTypes";
import ModelSelector from "./ModelSelector";

export type ChatCompareModelHeaderProps = {
  modelId: string;
  index: number;
  models: ChatModel[];
  selectedModel?: ChatModel;
  onModelChange?: (index: number, modelId: string) => void;
};

function ChatCompareModelHeader({
  modelId,
  index,
  models,
  selectedModel,
  onModelChange,
}: ChatCompareModelHeaderProps) {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 flex-1 items-center py-1">
      <div className="min-w-0 flex-1">
        {selectedModel ? (
          <ModelSelector
            models={models}
            selected={selectedModel}
            onSelect={(nextModel) => onModelChange?.(index, nextModel.id)}
            className="inline-block max-w-[220px] align-top sm:max-w-[240px]"
            triggerClassName="w-auto max-w-full gap-3 pl-0 pr-2 [&>span:first-child]:h-7 [&>span:first-child]:w-7"
          />
        ) : (
          <div className="inline-flex rounded-lg px-2 py-1 text-sm font-medium text-text-secondary">{modelId || t("model.comparePlaceholder").replace("{index}", String(index + 1))}</div>
        )}
      </div>

    </div>
  );
}

export default memo(ChatCompareModelHeader);
