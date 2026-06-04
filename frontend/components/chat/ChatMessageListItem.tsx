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
  group?: InferredGroup;
  model?: ChatModel;
  isLoading: boolean;
  selectMode: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
  historyPrependSettling: boolean;
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
  imageLoadFailedLabel: string;
  MarkdownRenderer: MessageRowProps["MarkdownRenderer"];
};

function ChatMessageListItem({
  index,
  message,
  visibleMessageCount,
  group,
  model,
  isLoading,
  selectMode,
  isSelected,
  isHighlighted,
  historyPrependSettling,
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
  imageLoadFailedLabel,
  MarkdownRenderer,
}: ChatMessageListItemProps) {
  return (
    <MessageRow
      message={message}
      group={group}
      model={model}
      isLast={index === visibleMessageCount - 1}
      isLoading={isLoading}
      selectMode={selectMode}
      isSelected={isSelected}
      isHighlighted={isHighlighted}
      historyPrependSettling={historyPrependSettling}
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
      imageLoadFailedLabel={imageLoadFailedLabel}
      MarkdownRenderer={MarkdownRenderer}
    />
  );
}

export default memo(ChatMessageListItem);
