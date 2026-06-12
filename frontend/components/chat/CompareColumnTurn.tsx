"use client";

import { memo, useState, type CSSProperties } from "react";
import { Bot, Check } from "lucide-react";
import type { ChatModel, Message } from "@/lib/chatTypes";
import type { InferredGroup } from "@/lib/groups";
import { isMessageGenerating } from "@/lib/chatContent";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { ModelAvatar } from "./ModelAvatar";
import { getModelAvatarMeta } from "@/lib/models/modelAvatars";
import { AssistantMessageMeta } from "./AssistantMessageMeta";
import { AssistantMessageContent } from "./AssistantMessageContent";
import MessageActions from "./MessageActions";
import CompareEmptySlot from "./CompareEmptySlot";
import CompareLoadingSlot from "./CompareLoadingSlot";
import CompareUserMessageBubble from "./CompareUserMessageBubble";

type MarkdownRendererComponent = Parameters<typeof AssistantMessageContent>[0]["MarkdownRenderer"];

const COMPARE_COLUMN_CONTENT_VISIBILITY_STYLE: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 180px",
};

type CompareColumnTurnProps = {
  userMessage: Message;
  assistantMessage?: Message;
  model?: ChatModel;
  badgeGroup?: InferredGroup;
  activeAssistantId?: string;
  onSelectAssistant?: (assistantId: string) => void;
  modelById: Map<string, ChatModel>;
  isLastGroup: boolean;
  isSingleChat: boolean;
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

function CompareColumnTurn({
  userMessage,
  assistantMessage: msg,
  model,
  badgeGroup,
  activeAssistantId,
  onSelectAssistant,
  modelById,
  isLastGroup,
  isSingleChat,
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
  useContentVisibility = true,
  deferRichTextHydration = false,
  allowRichLiteFallback = false,
}: CompareColumnTurnProps) {
  const { t } = useI18n();
  const [openBadgeMenu, setOpenBadgeMenu] = useState(false);
  const showBadgeSwitcher = !!badgeGroup && badgeGroup.assistantMessages.length > 2 && !!onSelectAssistant;
  const hasLiveGenerationSignal = !!msg && !msg.completedAt && !msg.stopped && !!(
    msg.activityStatus ||
    msg.serverMessageId ||
    msg.generationTaskId ||
    msg.backgroundTaskId ||
    msg.useBackground ||
    msg.isComplexTask
  );
  const isStreaming = !!msg && isLastGroup && (isLoading || hasLiveGenerationSignal) && isMessageGenerating(msg, true);
  const isGenerating = !!msg && isMessageGenerating(msg, isStreaming);
  const canRegenerate = !!msg && isLastGroup && !isStreaming && !isGenerating;

  return (
    <div
      data-chat-message-row="true"
      data-message-id={userMessage.id}
      data-message-role="user"
      style={useContentVisibility ? COMPARE_COLUMN_CONTENT_VISIBILITY_STYLE : undefined}
      className="flex h-full flex-col gap-3"
    >
      <CompareUserMessageBubble message={userMessage} imageLoadFailedLabel={imageLoadFailedLabel} />
      <div className="flex flex-1 flex-col">
        {msg ? (
          <div className="group flex gap-3 animate-message-appear">
            <div className="mt-1 w-7 shrink-0">
              <div className="relative">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (showBadgeSwitcher) setOpenBadgeMenu((open) => !open);
                  }}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg border border-surface-border bg-surface-card",
                    showBadgeSwitcher && "cursor-pointer hover:bg-surface-elevated"
                  )}
                >
                  {model ? (
                    <ModelAvatar meta={getModelAvatarMeta(model)} size="lg" className="h-full w-full rounded-lg" />
                  ) : (
                    <Bot className="h-4 w-4 text-text-secondary" />
                  )}
                  {showBadgeSwitcher && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full border border-white bg-brand text-[8px] font-bold text-white dark:border-[#1F1F1F]">
                      {badgeGroup.assistantMessages.length}
                    </span>
                  )}
                </button>
                {showBadgeSwitcher && openBadgeMenu && (
                  <div className="absolute left-0 top-full z-50 mt-1.5 flex w-44 flex-col gap-0.5 rounded-xl border border-surface-border bg-surface-elevated px-1.5 py-1.5 shadow-xl">
                    {badgeGroup.assistantMessages.map((assistant, idx) => {
                      const avatarModel = assistant.model ? modelById.get(assistant.model) : undefined;
                      const avatarMeta = getModelAvatarMeta(avatarModel || assistant.model || "AI");
                      const isActive = activeAssistantId === assistant.id;
                      return (
                        <button
                          key={assistant.id}
                          type="button"
                          onClick={() => {
                            onSelectAssistant?.(assistant.id);
                            setOpenBadgeMenu(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                            isActive ? "bg-surface-card font-medium text-text-primary shadow-sm" : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
                          )}
                        >
                          <ModelAvatar meta={avatarMeta} size="xs" />
                          <span className="truncate text-xs">{avatarModel?.name || assistant.model || t("chat.model.fallback", { index: String(idx + 1) })}</span>
                          {isActive && <Check className="ml-auto h-3 w-3 shrink-0 text-text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="w-fit max-w-full rounded-2xl rounded-bl-sm bg-surface-elevated px-4 py-3">
                {model && <AssistantMessageMeta msg={msg} isStreaming={isStreaming} model={model} />}
                <AssistantMessageContent
                  message={msg}
                  isStreaming={isStreaming}
                  MarkdownRenderer={MarkdownRenderer}
                  recoverEmptyContent
                  shouldHydrateRichText={!deferRichTextHydration}
                  allowRichLiteFallback={allowRichLiteFallback}
                  compactRichLitePreview={false}
                />
              </div>
              {!isStreaming && (
                <div className="flex items-center gap-2 px-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <MessageActions
                    onCopy={() => onCopy(msg.content)}
                    onDelete={() => onDelete(msg.id)}
                    onRegenerate={onRegenerate}
                    onShareSelectMode={() => onShareSelectMode(msg.id)}
                    onFavoriteSelectMode={msg.serverMessageId && conversationId ? () => onFavoriteSelectMode(msg.id) : undefined}
                    isFavorited={msg.serverMessageId ? isFavorited(msg.serverMessageId) : false}
                    showRegenerate={canRegenerate}
                    align="left"
                    visible={isLastGroup}
                    createdAt={msg.createdAt}
                    completedAt={msg.completedAt}
                    onForkCompare={undefined}
                  />
                </div>
              )}
            </div>
          </div>
        ) : isLoading && isLastGroup ? (
          <CompareLoadingSlot isComplexTask={isComplexTask} deepReasoningLabel={deepReasoningLabel} />
        ) : (
          <CompareEmptySlot isSingleChat={isSingleChat} />
        )}
      </div>
    </div>
  );
}

export default memo(CompareColumnTurn);
