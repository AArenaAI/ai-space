"use client";

import { memo } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { ChatModel } from "@/lib/chatTypes";
import ModelSelector from "./ModelSelector";

export type ChatCompareModelHeaderProps = {
  modelId: string;
  index: number;
  models: ChatModel[];
  selectedModel?: ChatModel;
  closeLabel: string;
  onModelChange?: (index: number, modelId: string) => void;
  onExitCompare?: () => void;
};

function ChatCompareModelHeader({
  modelId,
  index,
  models,
  selectedModel,
  closeLabel,
  onModelChange,
  onExitCompare,
}: ChatCompareModelHeaderProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <div className="flex-1 min-w-0">
        {selectedModel ? (
          <ModelSelector
            models={models}
            selected={selectedModel}
            onSelect={(nextModel) => onModelChange?.(index, nextModel.id)}
          />
        ) : (
          <div className="rounded-lg px-2 py-1 text-sm font-medium text-text-secondary">{modelId || t("model.comparePlaceholder").replace("{index}", String(index + 1))}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onExitCompare?.()}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary"
        aria-label={closeLabel}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default memo(ChatCompareModelHeader);
