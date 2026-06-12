"use client";

import { memo } from "react";
import type { ChatModel, Message } from "@/lib/chatTypes";
import type { InferredGroup } from "@/lib/groups";
import MessageRow from "./MessageRow";
import type { MessageRowProps } from "./MessageRow";

export type ChatMessageListItemProps = {
  index: number;
  message: Message;
  visibleMessageCount: number;
  latestAssistantMessageId?: string;
  initialReadingAssistantIds?: Set<string>;
  viewedAssistantIds?: Set<string>;
  group?: InferredGroup;
  model?: ChatModel;
  isLoading: boolean;
  selectMode: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
  historyPrependSettling: boolean;
  deferRichTextHydration: boolean;
  allowRichLiteFallback: boolean;
  conversationId?: number;
  groupViews?: Map<number, number>;
  modelById: Map<string, ChatModel>;
  openAvatarDropdownGroupId: number | null;
  setOpenAvatarDropdownGroupId: MessageRowProps["setOpenAvatarDropdownGroupId"];
  switchGroupModel?: (groupId: number, activeIndex: number) => void;
  toggleSelect: (id: string) => void;
  handleCopy: (content: string) => void;
  setDeleteTarget: (id: string) => void;
  enterSelectMode: (mode: "share" | "favorite", id: string) => void;
  isFavorited: (serverMessageId: number) => boolean;
  onRegenerate?: () => void;
  onContinueGenerate?: () => void;
  onForkCompare?: (messageId: number) => void;
  onAssistantViewed?: (messageId: string) => void;
  imageLoadFailedLabel: string;
  MarkdownRenderer: MessageRowProps["MarkdownRenderer"];
  useContentVisibility?: boolean;
};

function ChatMessageListItem({
  index,
  message,
  visibleMessageCount,
  latestAssistantMessageId,
  initialReadingAssistantIds,
  viewedAssistantIds,
  group,
  model,
  isLoading,
  selectMode,
  isSelected,
  isHighlighted,
  historyPrependSettling,
  deferRichTextHydration,
  allowRichLiteFallback,
  conversationId,
  groupViews,
  modelById,
  openAvatarDropdownGroupId,
  setOpenAvatarDropdownGroupId,
  switchGroupModel,
  toggleSelect,
  handleCopy,
  setDeleteTarget,
  enterSelectMode,
  isFavorited,
  onRegenerate,
  onContinueGenerate,
  onForkCompare,
  onAssistantViewed,
  imageLoadFailedLabel,
  MarkdownRenderer,
  useContentVisibility,
}: ChatMessageListItemProps) {
  return (
    <MessageRow
      message={message}
      group={group}
      model={model}
      isLast={index === visibleMessageCount - 1}
      isLatestAssistant={message.role === "assistant" && String(message.id) === latestAssistantMessageId}
      isInitialReadingAssistant={message.role === "assistant" && !!initialReadingAssistantIds?.has(String(message.id))}
      isViewedAssistant={message.role === "assistant" && !!viewedAssistantIds?.has(String(message.id))}
      isLoading={isLoading}
      selectMode={selectMode}
      isSelected={isSelected}
      isHighlighted={isHighlighted}
      historyPrependSettling={historyPrependSettling}
      deferRichTextHydration={deferRichTextHydration}
      allowRichLiteFallback={allowRichLiteFallback}
      conversationId={conversationId}
      groupViews={groupViews}
      modelById={modelById}
      openAvatarDropdownGroupId={openAvatarDropdownGroupId}
      setOpenAvatarDropdownGroupId={setOpenAvatarDropdownGroupId}
      switchGroupModel={switchGroupModel}
      toggleSelect={toggleSelect}
      handleCopy={handleCopy}
      setDeleteTarget={setDeleteTarget}
      enterSelectMode={enterSelectMode}
      isFavorited={isFavorited}
      onRegenerate={onRegenerate}
      onContinueGenerate={onContinueGenerate}
      onForkCompare={onForkCompare}
      onAssistantViewed={onAssistantViewed}
      imageLoadFailedLabel={imageLoadFailedLabel}
      MarkdownRenderer={MarkdownRenderer}
      useContentVisibility={useContentVisibility}
    />
  );
}

function getMessageRenderKey(message: Message) {
  const activity = message.activityStatus;
  return [
    message.id,
    message.role,
    message.content,
    message.reasoningContent || "",
    message.model || "",
    message.createdAt,
    message.completedAt || 0,
    message.generationStartedAt || 0,
    message.stopped ? "stopped" : "",
    message.search ? "search" : "",
    message.searchStatus || "",
    message.searchSourcesCount ?? message.searchSources?.length ?? 0,
    activity ? `${activity.kind}:${activity.status}:${activity.label}` : "",
    message.files?.map((file) => `${file.public_id}:${file.type}:${file.filename}`).join("|") || "",
    message.errorCode || "",
    message.retryable ? "retryable" : "",
    message.serverMessageId || "",
    message.backgroundTaskId || "",
    message.generationTaskId || "",
    message.isComplexTask ? "complex" : "",
    message.lastSequence || 0,
    message.groupId || "",
    message.groupIndex || "",
    message.groupModels?.join("|") || "",
  ].join("\u0001");
}

function getGroupRenderKey(group?: InferredGroup) {
  if (!group) return "";
  return `${group.id}:${group.assistantMessages.map((message) => message.id).join("|")}`;
}

function getGroupModelRenderKey(group: InferredGroup | undefined, modelById: Map<string, ChatModel>) {
  if (!group) return "";
  return group.assistantMessages.map((message) => {
    const model = message.model ? modelById.get(message.model) : undefined;
    return `${message.id}:${message.model || ""}:${model?.id || ""}:${model?.name || ""}:${model?.provider || ""}:${model?.color || ""}`;
  }).join("|");
}

function areChatMessageListItemPropsEqual(previous: ChatMessageListItemProps, next: ChatMessageListItemProps) {
  const previousIsLast = previous.index === previous.visibleMessageCount - 1;
  const nextIsLast = next.index === next.visibleMessageCount - 1;
  if (previousIsLast !== nextIsLast) return false;
  if ((previous.message.role === "assistant" && String(previous.message.id) === previous.latestAssistantMessageId) !== (next.message.role === "assistant" && String(next.message.id) === next.latestAssistantMessageId)) return false;
  if ((previous.message.role === "assistant" && !!previous.initialReadingAssistantIds?.has(String(previous.message.id))) !== (next.message.role === "assistant" && !!next.initialReadingAssistantIds?.has(String(next.message.id)))) return false;
  if ((previous.message.role === "assistant" && !!previous.viewedAssistantIds?.has(String(previous.message.id))) !== (next.message.role === "assistant" && !!next.viewedAssistantIds?.has(String(next.message.id)))) return false;
  if (previous.message !== next.message && getMessageRenderKey(previous.message) !== getMessageRenderKey(next.message)) return false;

  if (previous.isLoading !== next.isLoading && (previousIsLast || nextIsLast)) return false;
  if (previous.selectMode !== next.selectMode) return false;
  if (previous.isSelected !== next.isSelected) return false;
  if (previous.isHighlighted !== next.isHighlighted) return false;
  if (previous.historyPrependSettling !== next.historyPrependSettling) return false;
  if (previous.deferRichTextHydration !== next.deferRichTextHydration) return false;
  if (previous.allowRichLiteFallback !== next.allowRichLiteFallback) return false;
  if (previous.conversationId !== next.conversationId) return false;
  if (previous.imageLoadFailedLabel !== next.imageLoadFailedLabel) return false;
  if (previous.MarkdownRenderer !== next.MarkdownRenderer) return false;
  if (previous.useContentVisibility !== next.useContentVisibility) return false;
  if (getGroupRenderKey(previous.group) !== getGroupRenderKey(next.group)) return false;
  if (getGroupModelRenderKey(previous.group, previous.modelById) !== getGroupModelRenderKey(next.group, next.modelById)) return false;
  if (previous.model?.id !== next.model?.id || previous.model?.name !== next.model?.name || previous.model?.provider !== next.model?.provider || previous.model?.color !== next.model?.color) return false;

  const groupId = next.group?.id;
  if (groupId) {
    if ((previous.groupViews?.get(groupId) ?? 0) !== (next.groupViews?.get(groupId) ?? 0)) return false;
    if ((previous.openAvatarDropdownGroupId === groupId) !== (next.openAvatarDropdownGroupId === groupId)) return false;
  }

  const serverMessageId = next.message.serverMessageId;
  if (serverMessageId && previous.isFavorited(serverMessageId) !== next.isFavorited(serverMessageId)) return false;

  return true;
}

export default memo(ChatMessageListItem, areChatMessageListItemPropsEqual);
