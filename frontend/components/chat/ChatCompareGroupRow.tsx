"use client";

import { memo, useMemo, useState } from "react";
import type { ChatModel, Message } from "@/lib/chatTypes";
import type { InferredGroup } from "@/lib/groups";
import CompareColumnTurn from "./CompareColumnTurn";
import CompareSharedPromptBlock from "./CompareSharedPromptBlock";
import type { CompareActivityLayout } from "./ChatCompareActivityLayoutControl";

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
  onContinueGenerate?: () => void;
  onShareSelectMode: (id: string) => void;
  onFavoriteSelectMode: (id: string) => void;
  isFavorited: (serverMessageId: number) => boolean;
  onForkCompare?: (messageId: number) => void;
  onSaveToNote?: (content: string) => void;
  onAssistantViewed?: (messageId: string) => void;
  onOpenActivity?: (message: Message, layout: CompareActivityLayout) => void;
  activeActivityMessageIds?: Set<string>;
  activityLayout?: CompareActivityLayout;
  initialReadingAssistantIds?: Set<string>;
  viewedAssistantIds?: Set<string>;
  historyPrependSettling?: boolean;
  useContentVisibility?: boolean;
  deferRichTextHydration?: boolean;
  deferOffscreenRichTextHydration?: boolean;
  allowRichLiteFallback?: boolean;
  stabilizeInitialRichText?: boolean;
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
  onContinueGenerate,
  onShareSelectMode,
  onFavoriteSelectMode,
  isFavorited,
  onForkCompare,
  onSaveToNote,
  onAssistantViewed,
  onOpenActivity,
  activeActivityMessageIds,
  activityLayout = "inline",
  initialReadingAssistantIds,
  viewedAssistantIds,
  historyPrependSettling,
  useContentVisibility,
  deferRichTextHydration,
  deferOffscreenRichTextHydration,
  allowRichLiteFallback,
  stabilizeInitialRichText,
}: ChatCompareGroupRowProps) {
  const isLastGroup = groupIndex === groupCount - 1;
  const isSingleChat = group.models.length <= 1;
  const badgeGroup = aggregateGroup && aggregateGroup.assistantMessages.length > group.assistantMessages.length
    ? aggregateGroup
    : group;
  const [columnSelections, setColumnSelections] = useState<Record<number, string | undefined>>({});
  const columnModels = useMemo(() => compareModels.slice(0, 2), [compareModels]);

  return (
    <div
      className="mx-auto max-w-[1440px] px-4 py-4"
      data-chat-message-row="true"
      data-message-id={group.userMessage.id}
      data-message-role="user"
    >
      <div className="mb-4 pl-10 pr-0">
        <CompareSharedPromptBlock message={group.userMessage} imageLoadFailedLabel={imageLoadFailedLabel} />
      </div>
      <div className="flex items-stretch gap-4">
        {columnModels.map((modelId, colIndex) => {
          const defaultAssistant = resolveAssistant(group, colIndex, modelId);
          const selectedAssistantId = columnSelections[colIndex];
          const assistant = selectedAssistantId
            ? badgeGroup.assistantMessages.find((message) => message.id === selectedAssistantId) || defaultAssistant
            : defaultAssistant;

          return (
            <div key={modelId || colIndex} className="flex min-w-[320px] flex-1 flex-col py-1">
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
                onContinueGenerate={onContinueGenerate}
                onShareSelectMode={onShareSelectMode}
                onFavoriteSelectMode={onFavoriteSelectMode}
                isFavorited={isFavorited}
                onForkCompare={onForkCompare}
                onSaveToNote={onSaveToNote}
                onAssistantViewed={onAssistantViewed}
                onOpenActivity={onOpenActivity}
                isActivityOpen={Boolean(assistant && activeActivityMessageIds?.has(String(assistant.id)))}
                activityLayout={activityLayout}
                isInitialReadingAssistant={assistant ? initialReadingAssistantIds?.has(String(assistant.id)) : false}
                isViewedAssistant={assistant ? viewedAssistantIds?.has(String(assistant.id)) : false}
                historyPrependSettling={historyPrependSettling}
                useContentVisibility={useContentVisibility}
                deferRichTextHydration={deferRichTextHydration}
                deferOffscreenRichTextHydration={deferOffscreenRichTextHydration}
                allowRichLiteFallback={allowRichLiteFallback}
                stabilizeInitialRichText={stabilizeInitialRichText}
                suppressRowMarker
                showUserMessage={false}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(ChatCompareGroupRow);
