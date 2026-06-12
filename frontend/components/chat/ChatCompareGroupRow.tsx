"use client";

import { memo, useMemo, useState } from "react";
import type { ChatModel, Message } from "@/lib/chatTypes";
import type { InferredGroup } from "@/lib/groups";
import CompareColumnTurn from "./CompareColumnTurn";

type MarkdownRendererComponent = Parameters<typeof CompareColumnTurn>[0]["MarkdownRenderer"];

export type ChatCompareGroupRowProps = {
  group: InferredGroup;
  aggregateGroup?: InferredGroup;
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
  useContentVisibility?: boolean;
  deferRichTextHydration?: boolean;
  allowRichLiteFallback?: boolean;
};

function ChatCompareGroupRow({
  group,
  aggregateGroup,
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
  useContentVisibility,
  deferRichTextHydration,
  allowRichLiteFallback,
}: ChatCompareGroupRowProps) {
  const isLastGroup = groupIndex === groupCount - 1;
  const isSingleChat = group.models.length <= 1;
  const badgeGroup = aggregateGroup && aggregateGroup.assistantMessages.length > group.assistantMessages.length
    ? aggregateGroup
    : group;
  const [columnSelections, setColumnSelections] = useState<Record<number, string | undefined>>({});
  const columnModels = useMemo(() => compareModels.slice(0, 2), [compareModels]);

  return (
    <div className="mx-auto max-w-[1440px]">
      <div className="flex items-stretch">
        {columnModels.map((modelId, colIndex) => {
          const defaultAssistant = resolveAssistant(group, colIndex, modelId);
          const selectedAssistantId = columnSelections[colIndex];
          const assistant = selectedAssistantId
            ? badgeGroup.assistantMessages.find((message) => message.id === selectedAssistantId) || defaultAssistant
            : defaultAssistant;

          return (
            <div key={modelId || colIndex} className="flex min-w-[320px] flex-1 flex-col px-4 py-4">
              <CompareColumnTurn
                userMessage={group.userMessage}
                assistantMessage={assistant}
                model={modelById.get(assistant?.model || modelId || "")}
                badgeGroup={badgeGroup}
                activeAssistantId={assistant?.id}
                onSelectAssistant={(assistantId) => setColumnSelections((current) => ({ ...current, [colIndex]: assistantId }))}
                modelById={modelById}
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
                useContentVisibility={useContentVisibility}
                deferRichTextHydration={deferRichTextHydration}
                allowRichLiteFallback={allowRichLiteFallback}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(ChatCompareGroupRow);
