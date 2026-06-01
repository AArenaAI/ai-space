"use client";

import { memo } from "react";
import type { ChatModel, Message } from "@/lib/chatTypes";
import type { InferredGroup } from "@/lib/groups";
import CompareColumnTurn from "./CompareColumnTurn";

type MarkdownRendererComponent = Parameters<typeof CompareColumnTurn>[0]["MarkdownRenderer"];

export type ChatCompareGroupRowProps = {
  group: InferredGroup;
  groupIndex: number;
  groupCount: number;
  compareModels: string[];
  resolveAssistant: (group: InferredGroup, colIndex: number, modelId: string) => Message | undefined;
  modelById: Map<string, ChatModel>;
  isLoading: boolean;
  isComplexTask: boolean;
  conversationId?: number;
  deepReasoningLabel: string;
  imageLoadFailedLabel: string;
  MarkdownRenderer: MarkdownRendererComponent;
  onCopy: (content: string) => void;
  onDelete: (id: string) => void;
  onRegenerate?: () => void;
  onShareSelectMode: (id: string) => void;
  onFavoriteSelectMode: (id: string) => void;
  isFavorited: (serverMessageId: number) => boolean;
  onForkCompare?: (messageId: number) => void;
};

function ChatCompareGroupRow({
  group,
  groupIndex,
  groupCount,
  compareModels,
  resolveAssistant,
  modelById,
  isLoading,
  isComplexTask,
  conversationId,
  deepReasoningLabel,
  imageLoadFailedLabel,
  MarkdownRenderer,
  onCopy,
  onDelete,
  onRegenerate,
  onShareSelectMode,
  onFavoriteSelectMode,
  isFavorited,
  onForkCompare,
}: ChatCompareGroupRowProps) {
  const isLastGroup = groupIndex === groupCount - 1;
  const isSingleChat = group.models.length <= 1;

  return (
    <div className="mx-auto max-w-[1440px]">
      <div className="flex items-stretch">
        {compareModels.map((modelId, colIndex) => {
          const assistant = resolveAssistant(group, colIndex, modelId);
          return (
            <div key={modelId || colIndex} className="flex min-w-[320px] flex-1 flex-col px-4 py-4">
              <CompareColumnTurn
                userMessage={group.userMessage}
                assistantMessage={assistant}
                model={modelById.get(assistant?.model || modelId || "")}
                isLastGroup={isLastGroup}
                isSingleChat={isSingleChat}
                isLoading={isLoading}
                isComplexTask={isComplexTask}
                conversationId={conversationId}
                deepReasoningLabel={deepReasoningLabel}
                imageLoadFailedLabel={imageLoadFailedLabel}
                MarkdownRenderer={MarkdownRenderer}
                onCopy={onCopy}
                onDelete={onDelete}
                onRegenerate={onRegenerate}
                onShareSelectMode={onShareSelectMode}
                onFavoriteSelectMode={onFavoriteSelectMode}
                isFavorited={isFavorited}
                onForkCompare={onForkCompare}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(ChatCompareGroupRow);
